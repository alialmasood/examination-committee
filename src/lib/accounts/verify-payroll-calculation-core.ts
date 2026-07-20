/**
 * تحقق قواعد محرك الاحتساب 9.A.2.3.1 عند وجود تشغيلات CALCULATED.
 */
import { isSupportedPayrollCurrency } from './payroll-calculation-formulas';
import { isPayrollSnapshotHash } from './payroll-snapshot-hash';
import { buildRunSnapshotHash } from './payroll-snapshot-builder';
import { moneyToMillisSigned, sumMoney } from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type CalcVerifyIssue = { kind: string; detail: string; entity_id?: string };

export type PayrollCalculationVerifyResult = {
  ok: boolean;
  strict: boolean;
  mismatches: CalcVerifyIssue[];
  warnings: CalcVerifyIssue[];
  summary: {
    calculated_runs: number;
    checked_people: number;
    checked_lines: number;
  };
};

/** مسبار Transaction + ROLLBACK عبر SAVEPOINT — بلا أثر دائم. */
async function probeTransactionRollback(client: TxClient): Promise<void> {
  await txQuery(client, `SAVEPOINT __payroll_calc_core_verify_probe`);
  try {
    await txQuery(client, `CREATE TEMP TABLE IF NOT EXISTS __payroll_calc_core_probe (n int)`);
    await txQuery(client, `INSERT INTO __payroll_calc_core_probe(n) VALUES (1)`);
  } finally {
    await txQuery(client, `ROLLBACK TO SAVEPOINT __payroll_calc_core_verify_probe`);
    await txQuery(client, `RELEASE SAVEPOINT __payroll_calc_core_verify_probe`);
  }
}

export async function verifyPayrollCalculationCore(
  client: TxClient,
  options: { strict?: boolean } = {}
): Promise<PayrollCalculationVerifyResult> {
  const strict = options.strict === true;
  const mismatches: CalcVerifyIssue[] = [];
  const warnings: CalcVerifyIssue[] = [];
  const fail = (kind: string, detail: string, entity_id?: string) =>
    mismatches.push({ kind, detail, entity_id });

  try {
    await probeTransactionRollback(client);
  } catch (e) {
    fail(
      'tx_rollback_probe',
      `فشل مسبار Transaction/ROLLBACK: ${e instanceof Error ? e.message.slice(0, 80) : 'unknown'}`
    );
  }

  // تشغيلات بعملة غير IQD ومعها آثار احتساب — سياسة الإصدار الحالي
  const nonIqdRuns = await txQuery<{
    id: string;
    status: string;
    currency_code: string;
    snapshot_hash: string | null;
    people_n: number;
    lines_n: number;
    issues_n: number;
  }>(
    client,
    `SELECT r.id, r.status, r.currency_code, r.snapshot_hash,
            (SELECT COUNT(*)::int FROM accounts.payroll_run_people p WHERE p.payroll_run_id = r.id) AS people_n,
            (SELECT COUNT(*)::int FROM accounts.payroll_run_lines l WHERE l.payroll_run_id = r.id) AS lines_n,
            (SELECT COUNT(*)::int FROM accounts.payroll_run_issues i WHERE i.payroll_run_id = r.id) AS issues_n
     FROM accounts.payroll_runs r
     WHERE UPPER(TRIM(r.currency_code)) <> 'IQD'`
  );
  for (const r of nonIqdRuns.rows) {
    const hasArtifacts = r.people_n > 0 || r.lines_n > 0 || r.issues_n > 0;
    const calculatedWithSnapshot =
      r.status === 'CALCULATED' && r.snapshot_hash != null && String(r.snapshot_hash).length > 0;
    if (hasArtifacts || calculatedWithSnapshot) {
      fail(
        'unsupported_currency_artifacts',
        `تشغيل بعملة غير مدعومة مع آثار احتساب: people=${r.people_n} lines=${r.lines_n} issues=${r.issues_n} status=${r.status}`,
        r.id
      );
    }
  }

  const runs = await txQuery<{
    id: string;
    status: string;
    currency_code: string;
    people_count: number;
    warning_count: number;
    error_count: number;
    gross_total: string;
    deduction_total: string;
    employer_contribution_total: string;
    net_total: string;
    snapshot_hash: string | null;
    calculation_attempt_number: number;
    calculated_at: Date | string | null;
    calculation_request_id: string | null;
    last_calculation_request_id: string | null;
  }>(
    client,
    `SELECT id, status, currency_code, people_count, warning_count, error_count,
            gross_total::text, deduction_total::text, employer_contribution_total::text, net_total::text,
            snapshot_hash, calculation_attempt_number, calculated_at,
            calculation_request_id, last_calculation_request_id
     FROM accounts.payroll_runs
     WHERE status = 'CALCULATED'`
  );

  let checkedPeople = 0;
  let checkedLines = 0;

  for (const run of runs.rows) {
    if (!isSupportedPayrollCurrency(run.currency_code)) {
      fail(
        'calculated_unsupported_currency',
        `تشغيل CALCULATED بعملة غير مدعومة`,
        run.id
      );
    }
    if (run.calculation_attempt_number < 1) {
      fail('calc_attempt', 'calculation_attempt_number < 1 بعد CALCULATED', run.id);
    }
    if (run.calculated_at == null) {
      fail('calculated_at_missing', 'تشغيل CALCULATED بلا calculated_at', run.id);
    }
    if (run.last_calculation_request_id != null && run.calculation_request_id != null) {
      if (
        String(run.last_calculation_request_id).toLowerCase() !==
        String(run.calculation_request_id).toLowerCase()
      ) {
        fail(
          'calc_request_id_mismatch',
          'last_calculation_request_id لا يطابق calculation_request_id',
          run.id
        );
      }
    } else if (run.last_calculation_request_id == null) {
      fail('last_calc_request_missing', 'CALCULATED بلا last_calculation_request_id', run.id);
    }
    if (run.snapshot_hash && !isPayrollSnapshotHash(run.snapshot_hash)) {
      fail('run_snapshot_hash', 'بصمة تشغيل غير صالحة', run.id);
    }

    const people = await txQuery<{
      id: string;
      payroll_person_id: string;
      payroll_contract_id: string | null;
      calculation_status: string;
      currency_code: string;
      basic_amount: string;
      gross_amount: string;
      deductions_amount: string;
      employer_contributions_amount: string;
      net_amount: string;
      snapshot_hash: string;
      person_code_snapshot: string;
    }>(
      client,
      `SELECT id, payroll_person_id, payroll_contract_id, calculation_status, currency_code,
              basic_amount::text, gross_amount::text, deductions_amount::text,
              employer_contributions_amount::text, net_amount::text, snapshot_hash,
              person_code_snapshot
       FROM accounts.payroll_run_people
       WHERE payroll_run_id=$1::uuid
       ORDER BY person_code_snapshot ASC, id ASC`,
      [run.id]
    );
    checkedPeople += people.rows.length;

    if (people.rows.length !== Number(run.people_count)) {
      fail(
        'people_count_mismatch',
        `people_count=${run.people_count} vs صفوف=${people.rows.length}`,
        run.id
      );
    }

    const pending = people.rows.filter((p) => p.calculation_status === 'PENDING');
    if (pending.length) {
      fail('pending_after_calculated', `يوجد ${pending.length} شخص PENDING`, run.id);
    }

    let errorPeople = 0;
    const grossParts: string[] = [];
    const dedParts: string[] = [];
    const empParts: string[] = [];
    const netParts: string[] = [];
    const hashes: string[] = [];

    for (const p of people.rows) {
      hashes.push(p.snapshot_hash);
      if (!isSupportedPayrollCurrency(p.currency_code)) {
        fail(
          'person_unsupported_currency',
          `لقطة شخص بعملة غير مدعومة status=${p.calculation_status}`,
          p.id
        );
      }
      if (p.calculation_status === 'ERROR') {
        errorPeople += 1;
        if (
          Number(p.gross_amount) !== 0 ||
          Number(p.deductions_amount) !== 0 ||
          Number(p.employer_contributions_amount) !== 0 ||
          Number(p.net_amount) !== 0
        ) {
          fail('error_person_nonzero_totals', 'شخص ERROR بإجماليات غير صفرية', p.id);
        }
        const lines = await txQuery<{ n: number }>(
          client,
          `SELECT COUNT(*)::int n FROM accounts.payroll_run_lines WHERE payroll_run_person_id=$1::uuid`,
          [p.id]
        );
        if ((lines.rows[0]?.n ?? 0) > 0) {
          fail('error_person_has_lines', 'شخص ERROR بأسطر مالية', p.id);
        }
        const errIssues = await txQuery<{ n: number }>(
          client,
          `SELECT COUNT(*)::int n FROM accounts.payroll_run_issues
           WHERE payroll_run_person_id=$1::uuid AND severity='ERROR'`,
          [p.id]
        );
        if ((errIssues.rows[0]?.n ?? 0) === 0) {
          fail(
            'error_person_without_error_issue',
            'شخص ERROR بلا issue بشدة ERROR مرتبط',
            p.id
          );
        }
        continue;
      }
      if (p.calculation_status === 'EXCLUDED') {
        continue;
      }
      if (p.calculation_status === 'CALCULATED') {
        if (!p.payroll_contract_id) {
          fail('calculated_no_contract', 'CALCULATED بلا عقد', p.id);
        }
        const blocking = await txQuery<{ n: number }>(
          client,
          `SELECT COUNT(*)::int n FROM accounts.payroll_run_issues
           WHERE payroll_run_person_id=$1::uuid AND is_blocking=TRUE`,
          [p.id]
        );
        if ((blocking.rows[0]?.n ?? 0) > 0) {
          fail('calculated_with_blocking', 'شخص CALCULATED مع Issues حاجبة', p.id);
        }

        const lines = await txQuery<{
          id: string;
          component_type: string;
          calculated_amount: string;
          sequence: number;
        }>(
          client,
          `SELECT id, component_type, calculated_amount::text, sequence
           FROM accounts.payroll_run_lines
           WHERE payroll_run_person_id=$1::uuid
           ORDER BY sequence ASC, id ASC`,
          [p.id]
        );
        checkedLines += lines.rows.length;
        for (let i = 0; i < lines.rows.length; i++) {
          if (lines.rows[i]!.sequence !== i + 1) {
            fail('line_sequence_gap', `فجوة sequence عند ${lines.rows[i]!.sequence}`, p.id);
            break;
          }
        }
        const earn = lines.rows
          .filter((l) => l.component_type === 'EARNING')
          .map((l) => l.calculated_amount);
        const ded = lines.rows
          .filter((l) => l.component_type === 'DEDUCTION')
          .map((l) => l.calculated_amount);
        const emp = lines.rows
          .filter((l) => l.component_type === 'EMPLOYER_CONTRIBUTION')
          .map((l) => l.calculated_amount);
        const g = sumMoney(earn);
        const d = sumMoney(ded);
        const e = sumMoney(emp);
        if (g !== p.gross_amount) {
          fail('person_gross_vs_lines', `gross ${p.gross_amount} ≠ Σ EARNING ${g}`, p.id);
        }
        if (d !== p.deductions_amount) {
          fail('person_ded_vs_lines', `ded ${p.deductions_amount} ≠ Σ DED ${d}`, p.id);
        }
        if (e !== p.employer_contributions_amount) {
          fail('person_emp_vs_lines', `emp ${p.employer_contributions_amount} ≠ Σ EMP ${e}`, p.id);
        }
        grossParts.push(p.gross_amount);
        dedParts.push(p.deductions_amount);
        empParts.push(p.employer_contributions_amount);
        netParts.push(p.net_amount);
      }
    }

    if (errorPeople !== Number(run.error_count)) {
      fail(
        'error_count_vs_people',
        `error_count=${run.error_count} vs ERROR people=${errorPeople}`,
        run.id
      );
    }

    const expectGross = sumMoney(grossParts);
    const expectDed = sumMoney(dedParts);
    const expectEmp = sumMoney(empParts);
    const expectNetMillis = netParts.reduce((a, v) => a + moneyToMillisSigned(v), BigInt(0));
    if (expectGross !== run.gross_total) {
      fail('run_gross_sum', `gross_total ${run.gross_total} ≠ Σ ${expectGross}`, run.id);
    }
    if (expectDed !== run.deduction_total) {
      fail('run_ded_sum', `deduction_total ${run.deduction_total} ≠ Σ ${expectDed}`, run.id);
    }
    if (expectEmp !== run.employer_contribution_total) {
      fail(
        'run_emp_sum',
        `employer_contribution_total ${run.employer_contribution_total} ≠ Σ ${expectEmp}`,
        run.id
      );
    }
    if (moneyToMillisSigned(run.net_total) !== expectNetMillis) {
      fail('run_net_sum', `net_total لا يطابق مجموع الأشخاص`, run.id);
    }

    if (run.snapshot_hash) {
      const expected = buildRunSnapshotHash({
        person_snapshot_hashes: hashes,
        people_count: Number(run.people_count),
        gross_total: run.gross_total,
        deduction_total: run.deduction_total,
        employer_contribution_total: run.employer_contribution_total,
        net_total: run.net_total,
        warning_count: Number(run.warning_count),
        error_count: Number(run.error_count),
      });
      if (expected !== run.snapshot_hash) {
        fail('run_snapshot_hash_recompute', 'بصمة التشغيل لا تطابق إعادة الحساب', run.id);
      }
    }
  }

  const cancelledArtifacts = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n
     FROM accounts.payroll_run_people rp
     JOIN accounts.payroll_runs r ON r.id = rp.payroll_run_id
     WHERE r.status = 'CANCELLED' AND rp.superseded = FALSE`
  );
  if ((cancelledArtifacts.rows[0]?.n ?? 0) > 0) {
    fail(
      'cancelled_live_artifacts',
      `آثار غير superseded تحت CANCELLED (${cancelledArtifacts.rows[0]?.n})`
    );
  }

  const ok = mismatches.length === 0 && (!strict || warnings.length === 0);
  return {
    ok,
    strict,
    mismatches,
    warnings,
    summary: {
      calculated_runs: runs.rows.length,
      checked_people: checkedPeople,
      checked_lines: checkedLines,
    },
  };
}
