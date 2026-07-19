/**
 * تحقق مخطط لقطة الاحتساب 9.A.2.2 — سلامة الجداول بلا محرك.
 */
import { isPayrollSnapshotHash } from './payroll-snapshot-hash';
import { PAYROLL_SNAPSHOT_ENUMS } from './payroll-snapshot-types';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type SnapshotVerifyIssue = { kind: string; detail: string; entity_id?: string };

export type PayrollSnapshotVerifyResult = {
  ok: boolean;
  strict: boolean;
  mismatches: SnapshotVerifyIssue[];
  warnings: SnapshotVerifyIssue[];
  unexplained: SnapshotVerifyIssue[];
  summary: {
    run_people: number;
    run_lines: number;
    run_issues: number;
  };
};

const IMPLEMENTED_QTY = new Set<string>(PAYROLL_SNAPSHOT_ENUMS.QUANTITY_SOURCE_IMPLEMENTED);
const RESERVED_QTY = new Set<string>(
  PAYROLL_SNAPSHOT_ENUMS.QUANTITY_SOURCE.filter((s) => !IMPLEMENTED_QTY.has(s))
);

export async function verifyPayrollSnapshotSchema(
  client: TxClient,
  options: { strict?: boolean } = {}
): Promise<PayrollSnapshotVerifyResult> {
  const strict = options.strict === true;
  const mismatches: SnapshotVerifyIssue[] = [];
  const warnings: SnapshotVerifyIssue[] = [];
  const unexplained: SnapshotVerifyIssue[] = [];
  const fail = (kind: string, detail: string, entity_id?: string) =>
    mismatches.push({ kind, detail, entity_id });
  const warn = (kind: string, detail: string, entity_id?: string) =>
    warnings.push({ kind, detail, entity_id });
  const unexp = (kind: string, detail: string, entity_id?: string) =>
    unexplained.push({ kind, detail, entity_id });

  const runs = await txQuery<{
    id: string; status: string; currency_code: string; payroll_period_id: string;
    gross_total: string; deduction_total: string; net_total: string; people_count: number;
  }>(
    client,
    `SELECT id, status, currency_code, payroll_period_id,
            gross_total::text, deduction_total::text, net_total::text, people_count
     FROM accounts.payroll_runs`
  );
  const runById = new Map(runs.rows.map((r) => [r.id, r]));

  const people = await txQuery<{
    id: string; payroll_run_id: string; payroll_person_id: string; payroll_contract_id: string | null;
    payroll_period_id: string; currency_code: string; calculation_status: string;
    basic_amount: string; gross_amount: string; deductions_amount: string;
    employer_contributions_amount: string; net_amount: string;
    warning_count: number; error_count: number; snapshot_hash: string; snapshot_json: unknown;
    version: number; superseded: boolean;
  }>(
    client,
    `SELECT id, payroll_run_id, payroll_person_id, payroll_contract_id, payroll_period_id,
            currency_code, calculation_status,
            basic_amount::text, gross_amount::text, deductions_amount::text,
            employer_contributions_amount::text, net_amount::text,
            warning_count, error_count, snapshot_hash, snapshot_json, version, superseded
     FROM accounts.payroll_run_people`
  );

  const personIds = new Set(
    (await txQuery<{ id: string }>(client, `SELECT id FROM accounts.payroll_people`)).rows.map((p) => p.id)
  );
  const contracts = await txQuery<{ id: string; payroll_person_id: string }>(
    client,
    `SELECT id, payroll_person_id FROM accounts.payroll_contracts`
  );
  const contractOwner = new Map(contracts.rows.map((c) => [c.id, c.payroll_person_id]));

  const peopleByRun = new Map<string, typeof people.rows>();
  for (const p of people.rows) {
    const list = peopleByRun.get(p.payroll_run_id) ?? [];
    list.push(p);
    peopleByRun.set(p.payroll_run_id, list);

    if (p.version < 1) fail('run_person_version', `version غير صالح (${p.version})`, p.id);
    if (!['PENDING', 'CALCULATED', 'ERROR', 'EXCLUDED'].includes(p.calculation_status)) {
      fail('run_person_status', `حالة احتساب غير صالحة (${p.calculation_status})`, p.id);
    }
    if (!isPayrollSnapshotHash(p.snapshot_hash)) {
      fail('run_person_hash', 'بصمة لقطة غير صالحة', p.id);
    }
    if (!personIds.has(p.payroll_person_id)) fail('run_person_person_orphan', 'شخص يتيم', p.id);
    const run = runById.get(p.payroll_run_id);
    if (!run) fail('run_person_run_orphan', 'تشغيل يتيم', p.id);
    else {
      if (p.currency_code !== run.currency_code) {
        fail('run_person_currency_mismatch', 'عملة الشخص تخالف التشغيل', p.id);
      }
      if (p.payroll_period_id !== run.payroll_period_id) {
        fail('run_person_period_mismatch', 'فترة الشخص تخالف فترة التشغيل', p.id);
      }
      if (run.status === 'DRAFT') {
        warn('draft_has_snapshot_artifacts', 'تشغيل DRAFT يحتوي لقطة احتساب (ليست ناتج محرك)', p.payroll_run_id);
      }
    }
    if (p.payroll_contract_id) {
      const owner = contractOwner.get(p.payroll_contract_id);
      if (!owner) fail('run_person_contract_orphan', 'عقد يتيم', p.id);
      else if (owner !== p.payroll_person_id) {
        fail('run_person_contract_mismatch', 'العقد لا يعود لنفس الشخص', p.id);
      }
    }
    if (Number(p.gross_amount) < 0 || Number(p.deductions_amount) < 0 || Number(p.basic_amount) < 0) {
      fail('run_person_negative_non_net', 'مبلغ غير صافٍ سالب', p.id);
    }
    if (p.calculation_status === 'CALCULATED' && !p.snapshot_hash) {
      fail('run_person_calculated_no_hash', 'CALCULATED بلا بصمة', p.id);
    }
    // مفاتيح حساسة محظورة في JSON
    const json = typeof p.snapshot_json === 'string' ? safeParse(p.snapshot_json) : p.snapshot_json;
    if (json && typeof json === 'object') {
      const sensitive = findSensitiveKeys(json as Record<string, unknown>);
      if (sensitive.length) {
        unexp('snapshot_sensitive_keys', `مفاتيح حسّاسة في اللقطة: ${sensitive.join(',')}`, p.id);
      }
    }
  }

  // تكرار شخص في نفس التشغيل (يجب أن يمنعه DB؛ كشف دفاعي)
  const dupPerson = await txQuery<{ payroll_run_id: string; payroll_person_id: string; n: number }>(
    client,
    `SELECT payroll_run_id, payroll_person_id, COUNT(*)::int n
     FROM accounts.payroll_run_people
     GROUP BY payroll_run_id, payroll_person_id HAVING COUNT(*)>1`
  );
  for (const row of dupPerson.rows) {
    fail('run_person_duplicate', `شخص مكرر في التشغيل (${row.n})`, row.payroll_run_id);
  }

  // حارس الفترة الحيّ
  const liveDup = await txQuery<{ payroll_period_id: string; payroll_person_id: string; n: number }>(
    client,
    `SELECT payroll_period_id, payroll_person_id, COUNT(*)::int n
     FROM accounts.payroll_run_people WHERE superseded=FALSE
     GROUP BY payroll_period_id, payroll_person_id HAVING COUNT(*)>1`
  );
  for (const row of liveDup.rows) {
    fail('run_person_live_period_dup', `شخص حيّ مكرر لنفس الفترة (${row.n})`, row.payroll_period_id);
  }

  // CALCULATED run بلا أشخاص
  for (const run of runs.rows) {
    if (run.status === 'CALCULATED' && !(peopleByRun.get(run.id)?.length)) {
      fail('calculated_run_no_people', 'تشغيل CALCULATED بلا أشخاص لقطة', run.id);
    }
  }

  // ── Lines ──────────────────────────────────────────────────
  const lines = await txQuery<{
    id: string; payroll_run_id: string; payroll_run_person_id: string; payroll_component_id: string;
    payroll_assignment_id: string | null; payroll_component_assignment_id: string | null;
    calculation_method: string; quantity_source: string | null; calculated_amount: string;
    source_effective_from: string; source_effective_to: string | null; sequence: number; version: number;
    component_code_snapshot: string; component_name_snapshot: string;
  }>(
    client,
    `SELECT id, payroll_run_id, payroll_run_person_id, payroll_component_id,
            payroll_assignment_id, payroll_component_assignment_id, calculation_method,
            quantity_source, calculated_amount::text,
            source_effective_from::text, source_effective_to::text, sequence, version,
            component_code_snapshot, component_name_snapshot
     FROM accounts.payroll_run_lines`
  );

  const peopleRowById = new Map(people.rows.map((p) => [p.id, p]));
  const componentIds = new Set(
    (await txQuery<{ id: string }>(client, `SELECT id FROM accounts.payroll_components`)).rows.map((c) => c.id)
  );
  const assignmentIds = new Set(
    (await txQuery<{ id: string }>(client, `SELECT id FROM accounts.payroll_assignments`)).rows.map((a) => a.id)
  );
  const pcaIds = new Set(
    (await txQuery<{ id: string }>(client, `SELECT id FROM accounts.payroll_component_assignments`)).rows.map((a) => a.id)
  );

  const lineTotalsByPerson = new Map<string, number>();
  for (const line of lines.rows) {
    if (line.version < 1) fail('run_line_version', `version غير صالح`, line.id);
    if (line.sequence < 1) fail('run_line_sequence', `sequence غير صالح`, line.id);
    if (line.calculation_method === 'CUSTOM_FORMULA') {
      fail('run_line_custom_formula', 'سطر CUSTOM_FORMULA', line.id);
    }
    if (line.quantity_source && RESERVED_QTY.has(line.quantity_source)) {
      fail('run_line_reserved_qty_source', `مصدر كمية محجوز (${line.quantity_source})`, line.id);
    }
    if (!componentIds.has(line.payroll_component_id)) fail('run_line_component_orphan', 'مكوّن يتيم', line.id);
    if (line.payroll_assignment_id && !assignmentIds.has(line.payroll_assignment_id)) {
      fail('run_line_assignment_orphan', 'تكليف يتيم', line.id);
    }
    if (line.payroll_component_assignment_id && !pcaIds.has(line.payroll_component_assignment_id)) {
      fail('run_line_pca_orphan', 'إسناد مكوّن يتيم', line.id);
    }
    const rp = peopleRowById.get(line.payroll_run_person_id);
    if (!rp) fail('run_line_person_orphan', 'شخص تشغيل يتيم', line.id);
    else if (rp.payroll_run_id !== line.payroll_run_id) {
      fail('run_line_run_mismatch', 'run_id للسطر يخالف شخص التشغيل', line.id);
    }
    if (line.source_effective_to && line.source_effective_to < line.source_effective_from) {
      fail('run_line_effective_range', 'نطاق سريان المصدر غير صالح', line.id);
    }
    if (!line.component_code_snapshot?.trim() || !line.component_name_snapshot?.trim()) {
      fail('run_line_empty_snapshot', 'لقطة المكوّن فارغة', line.id);
    }
    if (Number(line.calculated_amount) < 0) fail('run_line_negative_amount', 'مبلغ سالب', line.id);
    lineTotalsByPerson.set(
      line.payroll_run_person_id,
      (lineTotalsByPerson.get(line.payroll_run_person_id) ?? 0) + Number(line.calculated_amount)
    );
  }

  // تكرار هوية المصدر
  const dupLines = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM (
       SELECT 1 FROM accounts.payroll_run_lines
       GROUP BY payroll_run_person_id, payroll_component_id,
                COALESCE(payroll_assignment_id,'00000000-0000-0000-0000-000000000000'::uuid),
                COALESCE(payroll_component_assignment_id,'00000000-0000-0000-0000-000000000000'::uuid)
       HAVING COUNT(*)>1
     ) t`
  );
  if (Number(dupLines.rows[0]?.n ?? 0) > 0) {
    fail('run_line_source_dup', `هويات مصدر مكررة (${dupLines.rows[0].n})`);
  }

  // تطابق مجاميع الأسطر مع إجماليات الشخص (عند وجود أسطر)
  for (const [personId, sum] of lineTotalsByPerson) {
    const rp = peopleRowById.get(personId);
    if (!rp) continue;
    const personGross = Number(rp.gross_amount);
    // لا نفرض تطابقًا صارمًا بين gross والأسطر في Fixtures (قد تكون استقطاعات منفصلة)
    // لكن إن كان هناك أسطر وصافي/إجمالي صفر والشخص CALCULATED — تحذير
    if (rp.calculation_status === 'CALCULATED' && Math.abs(personGross - sum) > 0.001 && personGross !== 0) {
      warn(
        'run_person_line_total_drift',
        `مجموع الأسطر (${sum}) لا يطابق إجمالي_amount (${personGross}) — راجع Fixtures/محرك`,
        personId
      );
    }
  }

  // ── Issues ─────────────────────────────────────────────────
  const issues = await txQuery<{
    id: string; payroll_run_id: string; payroll_run_person_id: string | null;
    severity: string; issue_code: string; is_blocking: boolean; message_ar: string;
  }>(
    client,
    `SELECT id, payroll_run_id, payroll_run_person_id, severity, issue_code, is_blocking, message_ar
     FROM accounts.payroll_run_issues`
  );
  for (const iss of issues.rows) {
    if (!/^[A-Z][A-Z0-9_]{1,59}$/.test(iss.issue_code)) {
      fail('run_issue_code', `رمز غير صالح (${iss.issue_code})`, iss.id);
    }
    if (iss.severity === 'ERROR' && !iss.is_blocking) {
      fail('run_issue_error_not_blocking', 'ERROR بلا is_blocking', iss.id);
    }
    if (iss.severity === 'WARNING' && iss.is_blocking) {
      fail('run_issue_warning_blocking', 'WARNING مع is_blocking', iss.id);
    }
    if (!iss.message_ar?.trim()) fail('run_issue_empty_message', 'رسالة فارغة', iss.id);
    if (!runById.has(iss.payroll_run_id)) fail('run_issue_run_orphan', 'تشغيل يتيم', iss.id);
    if (iss.payroll_run_person_id) {
      const rp = peopleRowById.get(iss.payroll_run_person_id);
      if (!rp) fail('run_issue_person_orphan', 'شخص يتيم', iss.id);
      else if (rp.payroll_run_id !== iss.payroll_run_id) {
        fail('run_issue_run_mismatch', 'شخص المشكلة لا يعود لنفس التشغيل', iss.id);
      }
    }
  }

  const summary = {
    run_people: people.rows.length,
    run_lines: lines.rows.length,
    run_issues: issues.rows.length,
  };

  const ok =
    mismatches.length === 0 &&
    (!strict || (warnings.length === 0 && unexplained.length === 0));
  return { ok, strict, mismatches, warnings, unexplained, summary };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function findSensitiveKeys(obj: Record<string, unknown>, path = ''): string[] {
  const hit: string[] = [];
  const banned = /bank|iban|account_number|password|secret|ssn|national_id|card_number/i;
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (banned.test(k)) hit.push(p);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      hit.push(...findSensitiveKeys(v as Record<string, unknown>, p));
    }
  }
  return hit;
}
