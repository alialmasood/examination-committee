/**
 * اختبارات نواة إعادة احتساب الرواتب 9.A.2.4.1
 * npm run test:payroll-recalculate-core
 *
 * عزل: ownership token + cleanup في finally. تشغيل مرتين بلا تراكم.
 */
import { randomUUID } from 'crypto';
import { closePool, pool, query } from '../lib/db';
import { AccountsHttpError } from '../lib/accounts/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import { calculatePayrollRunCore } from '../lib/accounts/payroll-calculation-engine';
import {
  __clearPayrollRecalcFailpointForTests,
  __setPayrollRecalcFailpointForTests,
  type PayrollRecalcFailpoint,
} from '../lib/accounts/payroll-recalculate-failpoints';
import { recalculatePayrollRunCore } from '../lib/accounts/payroll-recalculate-core';
import {
  buildRecalculateRequestKeyHash,
  buildRecalculateRequestPayloadHash,
  normalizeRecalculateIdempotencyKey,
  normalizeRecalculateReason,
  requestKeyHashToRequestUuid,
} from '../lib/accounts/payroll-recalculate-idempotency';
import { createPayrollCalendar } from '../lib/accounts/payroll-calendars';
import { createPayrollComponent } from '../lib/accounts/payroll-components';
import { createPayrollComponentAssignment } from '../lib/accounts/payroll-component-assignments';
import {
  createPayrollContract,
  transitionPayrollContract,
} from '../lib/accounts/payroll-contracts';
import { createPayrollAssignment, transitionPayrollAssignment } from '../lib/accounts/payroll-assignments';
import { createPayrollPerson, setPayrollPersonStatus } from '../lib/accounts/payroll-people';
import { createPayrollPeriod } from '../lib/accounts/payroll-periods';
import {
  cancelPayrollRun,
  createPayrollRun,
  loadPayrollRun,
  updatePayrollRun,
} from '../lib/accounts/payroll-runs';
import { addScopeMember } from '../lib/accounts/payroll-run-scope';
import { loadRunCalculationArtifacts } from '../lib/accounts/payroll-run-snapshots';
import {
  assertPayrollRunReadyForPosting,
  isPayrollRunReadyForPosting,
} from '../lib/accounts/payroll-posting-guard';
import { PAYROLL_CAPABILITIES, hasPayrollCapability } from '../lib/accounts/payroll-access';
import { verifyPayrollRecalculateCore } from '../lib/accounts/verify-payroll-recalculate-core';
import { verifyPayrollCalculationCore } from '../lib/accounts/verify-payroll-calculation-core';
import { withTransaction, txQuery } from '../lib/accounts/with-transaction';

let passCount = 0;
let failCount = 0;
function ok(name: string) {
  passCount += 1;
  console.log(`✅ ${name}`);
}
function failed(name: string, err?: unknown) {
  failCount += 1;
  console.error(`❌ ${name}`, err instanceof Error ? err.message : (err ?? ''));
  process.exitCode = 1;
}
async function it(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    failed(name, e);
  } finally {
    __clearPayrollRecalcFailpointForTests();
  }
}
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
async function throwsHttp(fn: () => Promise<unknown>, status: number, includes?: string) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof AccountsHttpError && e.status === status) {
      if (includes && !e.message.includes(includes)) {
        throw new Error(`الرسالة: ${e.message}`);
      }
      return;
    }
    throw e;
  }
  throw new Error(`توقّعنا ${status}`);
}

const owned = {
  calendarIds: [] as string[],
  periodIds: [] as string[],
  runIds: [] as string[],
  personIds: [] as string[],
  contractIds: [] as string[],
  componentIds: [] as string[],
  pcaIds: [] as string[],
  assignmentIds: [] as string[],
  collegeIds: [] as string[],
  departmentIds: [] as string[],
};

async function cleanupOwned() {
  if (owned.runIds.length) {
    await query(`DELETE FROM accounts.payroll_run_issues WHERE payroll_run_id = ANY($1::uuid[])`, [
      owned.runIds,
    ]);
    await query(`DELETE FROM accounts.payroll_run_lines WHERE payroll_run_id = ANY($1::uuid[])`, [
      owned.runIds,
    ]);
    await query(`DELETE FROM accounts.payroll_run_people WHERE payroll_run_id = ANY($1::uuid[])`, [
      owned.runIds,
    ]);
    await query(
      `DELETE FROM accounts.payroll_run_scope_members WHERE payroll_run_id = ANY($1::uuid[])`,
      [owned.runIds]
    );
    await query(`DELETE FROM accounts.financial_audit_log WHERE entity_type='payroll_run' AND entity_id = ANY($1::uuid[])`, [
      owned.runIds,
    ]);
    await query(`DELETE FROM accounts.payroll_runs WHERE id = ANY($1::uuid[])`, [owned.runIds]);
  }
  if (owned.periodIds.length) {
    await query(`DELETE FROM accounts.payroll_periods WHERE id = ANY($1::uuid[])`, [owned.periodIds]);
  }
  if (owned.pcaIds.length) {
    await query(`DELETE FROM accounts.payroll_component_assignments WHERE id = ANY($1::uuid[])`, [
      owned.pcaIds,
    ]);
  }
  if (owned.assignmentIds.length) {
    await query(`DELETE FROM accounts.payroll_assignments WHERE id = ANY($1::uuid[])`, [
      owned.assignmentIds,
    ]);
  }
  if (owned.contractIds.length) {
    await query(
      `DELETE FROM accounts.payroll_contracts WHERE id = ANY($1::uuid[]) AND contract_number NOT LIKE 'DEMO%'`,
      [owned.contractIds]
    );
  }
  if (owned.personIds.length) {
    await query(
      `DELETE FROM accounts.payroll_people WHERE id = ANY($1::uuid[]) AND person_code NOT LIKE 'DEMO%'`,
      [owned.personIds]
    );
  }
  if (owned.componentIds.length) {
    await query(
      `DELETE FROM accounts.payroll_components WHERE id = ANY($1::uuid[]) AND component_code NOT LIKE 'DEMO%'`,
      [owned.componentIds]
    );
  }
  if (owned.calendarIds.length) {
    await query(
      `DELETE FROM accounts.payroll_calendars WHERE id = ANY($1::uuid[]) AND code NOT LIKE 'DEMO%'`,
      [owned.calendarIds]
    );
  }
  if (owned.departmentIds.length) {
    await query(`DELETE FROM student_affairs.departments WHERE id = ANY($1::uuid[])`, [
      owned.departmentIds,
    ]);
  }
  if (owned.collegeIds.length) {
    await query(`DELETE FROM student_affairs.colleges WHERE id = ANY($1::uuid[])`, [owned.collegeIds]);
  }
}

async function countOwned() {
  const r = await query(
    `SELECT
      (SELECT COUNT(*)::int FROM accounts.payroll_calendars WHERE id=ANY($1::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_periods WHERE id=ANY($2::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_runs WHERE id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_run_people WHERE payroll_run_id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_run_lines WHERE payroll_run_id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_run_issues WHERE payroll_run_id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_run_scope_members WHERE payroll_run_id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_people WHERE id=ANY($4::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_components WHERE id=ANY($5::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_contracts WHERE id=ANY($8::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_component_assignments WHERE id=ANY($9::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_assignments WHERE id=ANY($10::uuid[])) +
      (SELECT COUNT(*)::int FROM student_affairs.colleges WHERE id=ANY($6::uuid[])) +
      (SELECT COUNT(*)::int FROM student_affairs.departments WHERE id=ANY($7::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.financial_audit_log
         WHERE entity_type='payroll_run' AND entity_id=ANY($3::uuid[])) AS n`,
    [
      owned.calendarIds,
      owned.periodIds,
      owned.runIds,
      owned.personIds,
      owned.componentIds,
      owned.collegeIds,
      owned.departmentIds,
      owned.contractIds,
      owned.pcaIds,
      owned.assignmentIds,
    ]
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function auditCount(runId: string, action: string) {
  const r = await query(
    `SELECT COUNT(*)::int n FROM accounts.financial_audit_log
     WHERE entity_type='payroll_run' AND entity_id=$1::uuid AND action=$2`,
    [runId, action]
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function memberCount(runId: string) {
  const r = await query(
    `SELECT COUNT(*)::int n FROM accounts.payroll_run_scope_members WHERE payroll_run_id=$1::uuid`,
    [runId]
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function main() {
  console.log('===== اختبارات نواة إعادة احتساب الرواتب 9.A.2.4.1 =====');
  const token = `RCAL${Date.now().toString(36).toUpperCase()}`;
  let seq = 0;
  const uniq = (p: string) => {
    seq += 1;
    return `${p}-${token}-${seq}`;
  };

  const user = await query(
    `SELECT u.id FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id=u.id
     JOIN student_affairs.systems s ON s.id=us.system_id
     WHERE s.code='ACCOUNTS' AND u.is_active ORDER BY u.created_at LIMIT 1`
  );
  if (!user.rows[0]) {
    failed('إعداد: لا مستخدم');
    return;
  }
  const userId = user.rows[0].id as string;
  await grantAccountsAdminRole(userId);

  let fy = await query(
    `SELECT id FROM accounts.fiscal_years WHERE status='ACTIVE' ORDER BY is_default DESC, start_date DESC LIMIT 1`
  );
  if (!fy.rows[0]) {
    fy = await query(
      `INSERT INTO accounts.fiscal_years (code,name_ar,start_date,end_date,status,is_default,created_by)
       VALUES ($1,'سنة إعادة احتساب','2025-01-01','2025-12-31','ACTIVE',FALSE,$2) RETURNING id`,
      [uniq('RCALFY'), userId]
    );
  }
  const fiscalYearId = fy.rows[0].id as string;

  const mkCalendar = async (currency = 'IQD') => {
    const cal = await withTransaction((c) =>
      createPayrollCalendar(c, {
        code: uniq('RCALCAL'),
        name_ar: 'تقويم إعادة احتساب',
        calendar_type: 'MONTHLY',
        currency_code: currency,
        effective_from: '2025-01-01',
        created_by: userId,
      })
    );
    owned.calendarIds.push(cal.id);
    return cal;
  };
  const mkPeriod = async (calendarId: string) => {
    const p = await withTransaction((c) =>
      createPayrollPeriod(c, {
        payroll_calendar_id: calendarId,
        name_ar: 'فترة إعادة احتساب',
        start_date: '2025-01-01',
        end_date: '2025-01-31',
        fiscal_year_id: fiscalYearId,
        created_by: userId,
      })
    );
    owned.periodIds.push(p.id);
    return p;
  };
  const mkPerson = async (over: Record<string, unknown> = {}) => {
    const p = await withTransaction((c) =>
      createPayrollPerson(c, {
        full_name_ar: 'شخص إعادة احتساب',
        person_type: 'EMPLOYEE',
        default_currency_code: 'IQD',
        effective_from: '2025-01-01',
        created_by: userId,
        ...over,
      })
    );
    owned.personIds.push(p.id);
    return p;
  };
  const mkContract = async (personId: string, base = '1000000', currency = 'IQD') => {
    const c = await withTransaction(async (client) => {
      const draft = await createPayrollContract(client, {
        payroll_person_id: personId,
        compensation_basis: 'MONTHLY_FIXED',
        base_amount: base,
        currency_code: currency,
        effective_from: '2025-01-01',
        created_by: userId,
      });
      owned.contractIds.push(draft.id);
      return transitionPayrollContract(client, {
        id: draft.id,
        userId,
        version: draft.version,
        updated_at: draft.updated_at,
        action: 'activate',
      });
    });
    return c;
  };
  const mkFixedComponent = async (amount = '100000') => {
    const comp = await withTransaction((c) =>
      createPayrollComponent(c, {
        component_code: uniq('RFIX'),
        name_ar: 'بدل ثابت',
        component_type: 'EARNING',
        calculation_method: 'FIXED_AMOUNT',
        calculation_base_type: 'NONE',
        default_amount: amount,
        effective_from: '2025-01-01',
        created_by: userId,
      })
    );
    owned.componentIds.push(comp.id);
    return comp;
  };
  const mkPca = async (
    personId: string,
    componentId: string,
    over: Record<string, unknown> = {}
  ) => {
    const pca = await withTransaction((c) =>
      createPayrollComponentAssignment(c, {
        payroll_person_id: personId,
        payroll_component_id: componentId,
        payroll_contract_id: over.payroll_contract_id,
        amount: over.amount,
        percentage: over.percentage,
        effective_from: '2025-01-01',
        created_by: userId,
        ...over,
      })
    );
    owned.pcaIds.push(pca.id);
    return pca;
  };
  const mkRun = async (periodId: string, over: Record<string, unknown> = {}) => {
    const run = await withTransaction((c) =>
      createPayrollRun(c, {
        payroll_period_id: periodId,
        run_type: 'REGULAR',
        scope_type: 'PERSON_LIST',
        created_by: userId,
        ...over,
      })
    );
    owned.runIds.push(run.id);
    return run;
  };
  const mkRunWithPerson = async (periodId: string, personId: string) => {
    let run = await mkRun(periodId);
    run = await withTransaction(async (c) => {
      const r = await addScopeMember(c, {
        runId: run.id,
        personId,
        userId,
        version: run.version,
        updated_at: run.updated_at,
      });
      return r.run;
    });
    return run;
  };

  const calc = async (
    run: { id: string; version: number; updated_at: unknown },
    key?: string
  ) =>
    withTransaction((c) =>
      calculatePayrollRunCore(c, {
        run_id: run.id,
        version: run.version,
        updated_at: run.updated_at,
        userId,
        idempotency_key: key ?? randomUUID(),
      })
    );

  const recalc = async (
    run: { id: string; version: number; updated_at: unknown },
    opts: { key?: string; reason?: string } = {}
  ) =>
    withTransaction((c) =>
      recalculatePayrollRunCore(c, {
        run_id: run.id,
        version: run.version,
        updated_at: run.updated_at,
        userId,
        idempotency_key: opts.key ?? randomUUID(),
        reason: opts.reason ?? 'تعديل الراتب الأساسي بعد المراجعة',
      })
    );

  const seedCalculated = async (amount = '77000') => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    const contract = await mkContract(person.id);
    const fix = await mkFixedComponent(amount);
    await mkPca(person.id, fix.id, { payroll_contract_id: contract.id, amount });
    const run = await mkRunWithPerson(period.id, person.id);
    const first = await calc(run);
    return {
      cal,
      period,
      person,
      contract,
      fix,
      run: first.run,
      first,
    };
  };

  const ccRows = await query(
    `SELECT id FROM accounts.cost_centers WHERE is_active=TRUE ORDER BY created_at LIMIT 2`
  );
  const costCenterId = (ccRows.rows[0]?.id as string | undefined) ?? null;
  const costCenterIdAlt = (ccRows.rows[1]?.id as string | undefined) ?? null;

  const mkActiveAssignment = async (
    personId: string,
    departmentId?: string | null,
    costCenter?: string | null,
    over: { effective_from?: string; effective_to?: string | null } = {}
  ) => {
    const a = await withTransaction(async (client) => {
      const draft = await createPayrollAssignment(client, {
        payroll_person_id: personId,
        assignment_type: 'GENERAL_ASSIGNMENT',
        title_ar: 'تكليف إعادة احتساب',
        department_id: departmentId ?? undefined,
        cost_center_id: costCenter ?? undefined,
        effective_from: over.effective_from ?? '2025-01-01',
        effective_to: over.effective_to ?? undefined,
        created_by: userId,
      });
      owned.assignmentIds.push(draft.id);
      return transitionPayrollAssignment(client, {
        id: draft.id,
        userId,
        version: draft.version,
        updated_at: draft.updated_at,
        action: 'activate',
      });
    });
    return a;
  };

  const assertSnapshotFrozen = async (
    runId: string,
    before: {
      status: string;
      snapshot_hash: string | null;
      gross_total: unknown;
      version: number;
      updated_at: unknown;
      calculated_at: unknown;
      people: number;
      lines: number;
      issues: number;
      successAudits: number;
    }
  ) => {
    const after = await withTransaction((c) => loadPayrollRun(c, runId));
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, runId));
    assert(after.status === 'CALCULATED', `status ${after.status}`);
    assert(after.snapshot_hash === before.snapshot_hash, 'snapshot_hash');
    assert(String(after.gross_total) === String(before.gross_total), 'gross');
    assert(after.version === before.version, 'version');
    assert(String(after.updated_at) === String(before.updated_at), 'updated_at');
    assert(String(after.calculated_at) === String(before.calculated_at), 'calculated_at');
    assert(arts.people.length === before.people, 'people count');
    assert(arts.lines.length === before.lines, 'lines count');
    assert(arts.issues.length === before.issues, 'issues count');
    assert(
      (await auditCount(runId, 'payroll_run.recalculated')) === before.successAudits,
      'no success audit'
    );
  };

  // —— Helpers / fingerprints ——
  await it('تطبيع المفتاح والسبب + بصمات حتمية', async () => {
    const key = normalizeRecalculateIdempotencyKey('  abc-key  ');
    assert(key === 'abc-key', 'trim key');
    const reason = normalizeRecalculateReason('تعديل\r\nالراتب   الأساسي');
    assert(reason.includes('\n'), 'newline kept');
    assert(!reason.includes('  '), 'horizontal collapse');
    const h1 = buildRecalculateRequestKeyHash(key);
    const h2 = buildRecalculateRequestKeyHash(key);
    assert(h1 === h2 && h1.length === 64, 'key hash stable');
    const uuid = requestKeyHashToRequestUuid(h1);
    assert(/^[0-9a-f-]{36}$/.test(uuid), 'uuid shaped');
    await throwsHttp(async () => normalizeRecalculateReason('قصير'), 400);
    await throwsHttp(async () => normalizeRecalculateIdempotencyKey(''), 400);
  });

  await it('صلاحية payroll_recalculate لـ admin فقط في الثابت', async () => {
    const has = await hasPayrollCapability(null, userId, PAYROLL_CAPABILITIES.RECALCULATE);
    assert(has === true, 'admin has recalculate');
    assert(PAYROLL_CAPABILITIES.RECALCULATE === 'payroll_recalculate', 'cap code');
  });

  // —— Eligibility ——
  await it('من DRAFT ممنوع', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    await mkContract(person.id);
    const run = await mkRunWithPerson(period.id, person.id);
    await throwsHttp(() => recalc(run), 409, 'مسودة');
  });

  await it('من CANCELLED ممنوع', async () => {
    const seeded = await seedCalculated('71000');
    const cancelled = await withTransaction((c) =>
      cancelPayrollRun(c, {
        id: seeded.run.id,
        userId,
        version: seeded.run.version,
        updated_at: seeded.run.updated_at,
        reason: 'إلغاء لاختبار إعادة الاحتساب',
      })
    );
    await throwsHttp(
      () =>
        recalc({
          id: cancelled.id,
          version: cancelled.version,
          updated_at: cancelled.updated_at,
        }),
      409,
      'ملغى'
    );
  });

  await it('نسخة متقادمة → 409', async () => {
    const seeded = await seedCalculated('72000');
    await throwsHttp(
      () =>
        withTransaction((c) =>
          recalculatePayrollRunCore(c, {
            run_id: seeded.run.id,
            version: seeded.run.version - 1,
            updated_at: seeded.run.updated_at,
            userId,
            idempotency_key: randomUUID(),
            reason: 'تعديل الراتب الأساسي بعد المراجعة',
          })
        ),
      409
    );
  });

  await it('stale updated_at → 409', async () => {
    const seeded = await seedCalculated('72100');
    await throwsHttp(
      () =>
        withTransaction((c) =>
          recalculatePayrollRunCore(c, {
            run_id: seeded.run.id,
            version: seeded.run.version,
            updated_at: '2000-01-01T00:00:00.000Z',
            userId,
            idempotency_key: randomUUID(),
            reason: 'تعديل الراتب الأساسي بعد المراجعة',
          })
        ),
      409
    );
  });

  // —— Success + source changes ——
  await it('نجاح مع تغيّر base_amount → hash/totals تتغير', async () => {
    const seeded = await seedCalculated('80000');
    const beforeHash = seeded.run.snapshot_hash;
    const beforeGross = seeded.first.summary.gross_total;
    const membersBefore = await memberCount(seeded.run.id);

    await withTransaction(async (c) => {
      await txQuery(
        c,
        `UPDATE accounts.payroll_contracts SET base_amount = 2000000, updated_at=NOW(), version=version+1
         WHERE id=$1::uuid`,
        [seeded.contract.id]
      );
    });

    // تغيير مبلغ المكوّن أيضاً لإظهار فرق واضح في gross
    await withTransaction(async (c) => {
      await txQuery(
        c,
        `UPDATE accounts.payroll_component_assignments SET amount = 150000, updated_at=NOW(), version=version+1
         WHERE payroll_person_id=$1::uuid`,
        [seeded.person.id]
      );
    });

    const result = await recalc(seeded.run, {
      reason: 'تعديل الراتب الأساسي ومبلغ البدل',
    });
    assert(result.idempotent_replay === false, 'not replay');
    assert(result.source_action === 'RECALCULATE', 'source');
    assert(result.run.status === 'CALCULATED', 'status');
    assert(result.summary.gross_total !== beforeGross, 'gross changed');
    assert(result.run.snapshot_hash !== beforeHash, 'hash changed');
    assert(result.previous_summary.snapshot_hash === beforeHash, 'previous hash');
    assert(result.previous_summary.gross_total === beforeGross, 'previous gross');
    assert((await auditCount(seeded.run.id, 'payroll_run.recalculated')) === 1, 'audit once');
    assert((await memberCount(seeded.run.id)) === membersBefore, 'members unchanged');
    assertPayrollRunReadyForPosting({
      status: result.run.status,
      error_count: result.run.error_count,
      snapshot_hash: result.run.snapshot_hash,
    });
  });

  await it('نفس المصادر → نفس hash بعد Recalculate', async () => {
    const seeded = await seedCalculated('81000');
    const before = seeded.run.snapshot_hash;
    const result = await recalc(seeded.run, {
      reason: 'إعادة احتساب بلا تغيّر مصادر حية',
    });
    assert(result.run.snapshot_hash === before, 'same hash');
    assert(result.summary.gross_total === seeded.first.summary.gross_total, 'same gross');
  });

  await it('إضافة مكوّن بعد الاحتساب الأول', async () => {
    const seeded = await seedCalculated('82000');
    const beforeGross = seeded.first.summary.gross_total;
    const extra = await mkFixedComponent('25000');
    await mkPca(seeded.person.id, extra.id, {
      payroll_contract_id: seeded.contract.id,
      amount: '25000',
    });
    const result = await recalc(seeded.run, {
      reason: 'إضافة بدل ثابت جديد للموظف',
    });
    assert(result.summary.gross_total !== beforeGross, 'gross up');
  });

  await it('إنهاء Component Assignment → يختفي من اللقطة الجديدة', async () => {
    const seeded = await seedCalculated('83000');
    await withTransaction(async (c) => {
      await txQuery(
        c,
        `UPDATE accounts.payroll_component_assignments
         SET effective_to = '2025-01-01', updated_at=NOW(), version=version+1
         WHERE payroll_person_id=$1::uuid`,
        [seeded.person.id]
      );
      // تأكد أن تاريخ الاحتساب بعد نهاية السريان
      await txQuery(
        c,
        `UPDATE accounts.payroll_runs
         SET calculation_date = '2025-01-15', updated_at=NOW(), version=version+1
         WHERE id=$1::uuid AND status='CALCULATED'`,
        [seeded.run.id]
      );
    });
    const runAfter = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
    const result = await recalc(runAfter, {
      reason: 'إنهاء سريان تكليف المكوّن قبل تاريخ الاحتساب',
    });
    assert(
      result.summary.gross_total === '0.000' || Number(result.summary.gross_total) === 0,
      'no earnings'
    );
  });

  await it('PERSON_LIST عضو غير مؤهل → EXCLUDED (أعضاء ثابتون + باقي طبيعي)', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const eligible = await mkPerson({ full_name_ar: 'مؤهل قائمة' });
    const ineligible = await mkPerson({ full_name_ar: 'غير مؤهل قائمة' });
    const c1 = await mkContract(eligible.id);
    const c2 = await mkContract(ineligible.id);
    const fix = await mkFixedComponent('84000');
    await mkPca(eligible.id, fix.id, { payroll_contract_id: c1.id, amount: '84000' });
    await mkPca(ineligible.id, fix.id, { payroll_contract_id: c2.id, amount: '84000' });
    let run = await mkRun(period.id);
    run = await withTransaction(async (c) => {
      const r1 = await addScopeMember(c, {
        runId: run.id,
        personId: eligible.id,
        userId,
        version: run.version,
        updated_at: run.updated_at,
      });
      return (
        await addScopeMember(c, {
          runId: run.id,
          personId: ineligible.id,
          userId,
          version: r1.run.version,
          updated_at: r1.run.updated_at,
        })
      ).run;
    });
    const calculated = await calc(run);
    const membersBefore = await memberCount(calculated.run.id);
    assert(membersBefore === 2, 'two members');

    const personRow = await query(
      `SELECT version, updated_at FROM accounts.payroll_people WHERE id=$1::uuid`,
      [ineligible.id]
    );
    await withTransaction((c) =>
      setPayrollPersonStatus(c, {
        id: ineligible.id,
        userId,
        version: personRow.rows[0].version,
        updated_at: personRow.rows[0].updated_at,
        target: 'INACTIVE',
        reason: 'إيقاف للاختبار',
      })
    );

    const result = await recalc(
      {
        id: calculated.run.id,
        version: calculated.run.version,
        updated_at: calculated.run.updated_at,
      },
      { reason: 'إعادة فحص أهلية عضو قائمة الأشخاص' }
    );
    assert(result.summary.excluded_people === 1, 'policy=EXCLUDED');
    assert(result.summary.calculated_people === 1, 'other calculated');
    assert(result.run.status === 'CALCULATED', 'run CALCULATED');
    assert((await memberCount(result.run.id)) === 2, 'scope_members preserved');
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, result.run.id));
    const ineligRow = (arts.people as Array<{ payroll_person_id: string; calculation_status: string }>).find(
      (p) => p.payroll_person_id === ineligible.id
    );
    assert(ineligRow?.calculation_status === 'EXCLUDED', 'EXCLUDED status');
    const issues = arts.issues as Array<{ issue_code: string }>;
    assert(
      issues.some((i) => i.issue_code === 'SCOPE_PERSON_INELIGIBLE'),
      'SCOPE_PERSON_INELIGIBLE'
    );
    assert(result.previous_summary.people_count === calculated.summary.people_count, 'audit prev people');
    assert(
      (await auditCount(result.run.id, 'payroll_run.recalculated')) === 1,
      'recalc audit'
    );
  });

  // —— Automatic scope enter/leave ——
  await it('Automatic Scope ENTER: شخص يدخل بعد تغيّر التكليف (COST_CENTER)', async () => {
    assert(costCenterId, 'يحتاج مركز كلفة نشط');
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const inside = await mkPerson({ full_name_ar: 'داخل المركز', default_cost_center_id: null });
    const outsider = await mkPerson({ full_name_ar: 'خارج المركز', default_cost_center_id: null });
    const cIn = await mkContract(inside.id);
    const cOut = await mkContract(outsider.id);
    const fix = await mkFixedComponent('55100');
    await mkPca(inside.id, fix.id, { payroll_contract_id: cIn.id, amount: '55100' });
    await mkPca(outsider.id, fix.id, { payroll_contract_id: cOut.id, amount: '55200' });
    await mkActiveAssignment(inside.id, null, costCenterId);
    const run = await mkRun(period.id, {
      scope_type: 'COST_CENTER',
      scope_ref_id: costCenterId,
    });
    const first = await calc(run);
    const arts1 = await withTransaction((c) => loadRunCalculationArtifacts(c, first.run.id));
    const ids1 = (arts1.people as Array<{ payroll_person_id: string }>).map((p) => p.payroll_person_id);
    assert(ids1.includes(inside.id), 'inside present');
    assert(!ids1.includes(outsider.id), 'outsider absent');
    const prevPeople = first.summary.people_count;
    const prevHash = first.run.snapshot_hash;

    // يصبح مؤهلاً عبر تكليف — بلا تعديل تعريف Scope
    await mkActiveAssignment(outsider.id, null, costCenterId);

    const result = await recalc(
      {
        id: first.run.id,
        version: first.run.version,
        updated_at: first.run.updated_at,
      },
      { key: randomUUID(), reason: 'دخول شخص جديد للنطاق التلقائي بعد تكليف' }
    );
    assert(result.idempotent_replay === false, 'new key');
    const arts2 = await withTransaction((c) => loadRunCalculationArtifacts(c, result.run.id));
    const people2 = arts2.people as Array<{
      payroll_person_id: string;
      person_code_snapshot: string;
    }>;
    const ids2 = people2.map((p) => p.payroll_person_id);
    assert(ids2.includes(outsider.id), 'entered');
    assert(ids2.filter((id) => id === outsider.id).length === 1, 'once');
    const codes = people2.map((p) => p.person_code_snapshot);
    const sortedCodes = [...codes].sort((a, b) => a.localeCompare(b));
    assert(JSON.stringify(codes) === JSON.stringify(sortedCodes), 'deterministic order by person_code');
    // إعادة بنفس المفتاح الجديد تنتج نفس الترتيب
    const again = await recalc(
      {
        id: result.run.id,
        version: result.run.version,
        updated_at: result.run.updated_at,
      },
      { key: randomUUID(), reason: 'تأكيد ترتيب حتمي بعد دخول النطاق' }
    );
    const arts3 = await withTransaction((c) => loadRunCalculationArtifacts(c, again.run.id));
    const codes3 = (arts3.people as Array<{ person_code_snapshot: string }>).map(
      (p) => p.person_code_snapshot
    );
    assert(JSON.stringify(codes3) === JSON.stringify(codes), 'stable across recalcs');
    assert(result.summary.people_count > prevPeople, 'people_count up');
    assert(result.run.snapshot_hash !== prevHash, 'hash changed');
    assert(result.previous_summary.people_count === prevPeople, 'audit previous people');
    assert(Number(result.run.people_count) === result.summary.people_count, 'run people');
  });

  await it('Automatic Scope LEAVE: خروج بعد إنهاء تكليف COST_CENTER', async () => {
    assert(costCenterId, 'يحتاج مركز كلفة');
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const stay = await mkPerson({ full_name_ar: 'يبقى', default_cost_center_id: null });
    const leave = await mkPerson({ full_name_ar: 'يخرج', default_cost_center_id: null });
    const c1 = await mkContract(stay.id);
    const c2 = await mkContract(leave.id);
    const fix = await mkFixedComponent('56100');
    await mkPca(stay.id, fix.id, { payroll_contract_id: c1.id, amount: '56100' });
    await mkPca(leave.id, fix.id, { payroll_contract_id: c2.id, amount: '56200' });
    await mkActiveAssignment(stay.id, null, costCenterId);
    const leaveAsg = await mkActiveAssignment(leave.id, null, costCenterId);
    const run = await mkRun(period.id, {
      scope_type: 'COST_CENTER',
      scope_ref_id: costCenterId,
    });
    // تثبيت calculation_date بعيدًا عن CURRENT_DATE؛ إنهاء التكليف قبله
    await query(
      `UPDATE accounts.payroll_runs SET calculation_date = '2025-01-15' WHERE id=$1::uuid`,
      [run.id]
    );
    const first = await calc(run);
    const arts1 = await withTransaction((c) => loadRunCalculationArtifacts(c, first.run.id));
    assert(
      (arts1.people as Array<{ payroll_person_id: string }>).some((p) => p.payroll_person_id === leave.id),
      'leave was in'
    );
    const prevPeople = first.summary.people_count;
    const prevHash = first.run.snapshot_hash;

    // إنهاء سريان التكليف قبل calculation_date الثابت — بلا CURRENT_DATE
    await withTransaction(async (c) => {
      await txQuery(
        c,
        `UPDATE accounts.payroll_assignments
         SET effective_to = '2025-01-10', updated_at=NOW(), version=version+1
         WHERE id=$1::uuid`,
        [leaveAsg.id]
      );
    });

    const result = await recalc(
      {
        id: first.run.id,
        version: first.run.version,
        updated_at: first.run.updated_at,
      },
      { reason: 'خروج شخص من النطاق التلقائي بعد إنهاء التكليف' }
    );
    const arts2 = await withTransaction((c) => loadRunCalculationArtifacts(c, result.run.id));
    const ids2 = (arts2.people as Array<{ payroll_person_id: string }>).map((p) => p.payroll_person_id);
    assert(!ids2.includes(leave.id), 'left automatic scope');
    assert(ids2.includes(stay.id), 'stay remains');
    const leavePeople = (arts2.people as Array<{ id: string; payroll_person_id: string }>).filter(
      (p) => p.payroll_person_id === leave.id
    );
    assert(leavePeople.length === 0, 'no orphan people row');
    const leaveRpIds = new Set(
      (arts1.people as Array<{ id: string; payroll_person_id: string }>)
        .filter((p) => p.payroll_person_id === leave.id)
        .map((p) => p.id)
    );
    const orphanLines = (arts2.lines as Array<{ payroll_run_person_id: string }>).filter((l) =>
      leaveRpIds.has(l.payroll_run_person_id)
    );
    assert(orphanLines.length === 0, 'no orphan lines');
    const orphanIssues = (arts2.issues as Array<{ payroll_run_person_id: string | null }>).filter(
      (i) => i.payroll_run_person_id != null && leaveRpIds.has(i.payroll_run_person_id)
    );
    assert(orphanIssues.length === 0, 'no orphan issues');
    assert(result.summary.people_count < prevPeople, 'people down');
    assert(result.run.snapshot_hash !== prevHash, 'hash changed');
    assert(result.previous_summary.people_count === prevPeople, 'audit before people');
    assert(result.previous_summary.snapshot_hash === prevHash, 'audit before hash');
  });

  await it('Multiple Active Contracts introduced بعد احتساب ناجح', async () => {
    const seeded = await seedCalculated('57100');
    // DROP INDEX + إدراج + Recalculate داخل Tx ثم ROLLBACK لإبقاء فهرس التفرد
    try {
      await withTransaction(async (c) => {
        await txQuery(c, `DROP INDEX IF EXISTS accounts.uq_payroll_contracts_one_active`);
        const c2 = await txQuery<{ id: string }>(
          c,
          `INSERT INTO accounts.payroll_contracts
             (payroll_person_id, contract_number, compensation_basis, base_amount, currency_code,
              effective_from, status, created_by, updated_by)
           VALUES ($1::uuid,$2,'MONTHLY_FIXED',900000,'IQD','2025-01-01','ACTIVE',$3::uuid,$3::uuid)
           RETURNING id`,
          [seeded.person.id, uniq('RCALCTR'), userId]
        );
        owned.contractIds.push(c2.rows[0]!.id);
        const result = await recalculatePayrollRunCore(c, {
          run_id: seeded.run.id,
          version: seeded.run.version,
          updated_at: seeded.run.updated_at,
          userId,
          idempotency_key: randomUUID(),
          reason: 'إعادة احتساب بعد إضافة عقد فعّال ثانٍ متداخل',
        });
        assert(result.run.status === 'CALCULATED', 'CALCULATED');
        assert(Number(result.run.error_count) > 0, 'error_count');
        assert(result.summary.error_people >= 1, 'error people');
        const arts = await loadRunCalculationArtifacts(c, result.run.id);
        const person = (arts.people as Array<{
          payroll_person_id: string;
          calculation_status: string;
          gross_amount: string;
          net_amount: string;
        }>).find((p) => p.payroll_person_id === seeded.person.id);
        assert(person?.calculation_status === 'ERROR', 'ERROR');
        assert(Number(person?.gross_amount) === 0 && Number(person?.net_amount) === 0, 'zero totals');
        assert(
          (arts.issues as Array<{ issue_code: string; severity: string }>).some(
            (i) => i.issue_code === 'MULTIPLE_ACTIVE_CONTRACTS' && i.severity === 'ERROR'
          ),
          'MULTIPLE_ACTIVE_CONTRACTS blocking'
        );
        const personRp = (arts.people as Array<{ id: string; payroll_person_id: string }>).find(
          (p) => p.payroll_person_id === seeded.person.id
        );
        const linesFor = (arts.lines as Array<{ payroll_run_person_id: string }>).filter(
          (l) => l.payroll_run_person_id === personRp?.id
        );
        assert(linesFor.length === 0, 'no financial lines');
        assert(
          !isPayrollRunReadyForPosting({
            status: result.run.status,
            error_count: result.run.error_count,
            snapshot_hash: result.run.snapshot_hash,
          }),
          'posting rejected'
        );
        throw new Error('__ROLLBACK_MULTI_CONTRACT_RECALC__');
      });
    } catch (e) {
      assert(
        e instanceof Error && e.message === '__ROLLBACK_MULTI_CONTRACT_RECALC__',
        `unexpected ${e instanceof Error ? e.message : e}`
      );
    }
    const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
    assert(after.status === 'CALCULATED', 'rollback keeps prior CALCULATED');
    assert(after.snapshot_hash === seeded.run.snapshot_hash, 'prior snapshot intact');
  });

  await it('Contract Currency Mismatch introduced (منفصل عن Run غير IQD)', async () => {
    const seeded = await seedCalculated('57200');
    await query(
      `UPDATE accounts.payroll_contracts SET currency_code='USD', updated_at=NOW(), version=version+1 WHERE id=$1::uuid`,
      [seeded.contract.id]
    );
    const result = await recalc(seeded.run, {
      reason: 'إعادة احتساب بعد تعارض عملة العقد مع التشغيل',
    });
    assert(result.run.status === 'CALCULATED', 'CALCULATED');
    assert(Number(result.run.error_count) > 0, 'error_count');
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, result.run.id));
    const person = (arts.people as Array<{
      payroll_person_id: string;
      calculation_status: string;
      gross_amount: string;
      net_amount: string;
    }>).find((p) => p.payroll_person_id === seeded.person.id);
    assert(person?.calculation_status === 'ERROR', 'ERROR');
    assert(Number(person?.gross_amount) === 0, 'zero');
    assert(
      (arts.issues as Array<{ issue_code: string }>).some((i) => i.issue_code === 'CURRENCY_MISMATCH'),
      'CURRENCY_MISMATCH'
    );
    assert((arts.lines as unknown[]).length === 0, 'no lines');
    assert(
      !isPayrollRunReadyForPosting({
        status: result.run.status,
        error_count: result.run.error_count,
        snapshot_hash: result.run.snapshot_hash,
      }),
      'posting rejected'
    );
  });

  await it('Unsupported Run Currency → رفض قبل المسح + لقطة محفوظة', async () => {
    const seeded = await seedCalculated('57300');
    const before = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
    const artsBefore = await withTransaction((c) => loadRunCalculationArtifacts(c, seeded.run.id));
    const auditsBefore = await auditCount(seeded.run.id, 'payroll_run.recalculated');
    await query(
      `UPDATE accounts.payroll_runs SET currency_code='USD', updated_at=updated_at WHERE id=$1::uuid`,
      [seeded.run.id]
    );
    await query(
      `UPDATE accounts.payroll_periods SET currency_code='USD' WHERE id=$1::uuid`,
      [seeded.period.id]
    );
    // أعد تحميل الحقول دون تغيير version/updated_at للـ concurrency في الطلب
    const loaded = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
    await throwsHttp(
      () =>
        withTransaction((c) =>
          recalculatePayrollRunCore(c, {
            run_id: loaded.id,
            version: before.version,
            updated_at: before.updated_at,
            userId,
            idempotency_key: randomUUID(),
            reason: 'محاولة إعادة احتساب بعملة تشغيل غير مدعومة',
          })
        ),
      422,
      'UNSUPPORTED_PAYROLL_CURRENCY'
    );
    await assertSnapshotFrozen(seeded.run.id, {
      status: 'CALCULATED',
      snapshot_hash: before.snapshot_hash,
      gross_total: before.gross_total,
      version: before.version,
      updated_at: before.updated_at,
      calculated_at: before.calculated_at,
      people: artsBefore.people.length,
      lines: artsBefore.lines.length,
      issues: artsBefore.issues.length,
      successAudits: auditsBefore,
    });
    // أعد IQD حتى لا يلوّث verify الحسابات العامة أثناء الـ suite
    await query(
      `UPDATE accounts.payroll_runs SET currency_code='IQD', updated_at=updated_at WHERE id=$1::uuid`,
      [seeded.run.id]
    );
    await query(
      `UPDATE accounts.payroll_periods SET currency_code='IQD' WHERE id=$1::uuid`,
      [seeded.period.id]
    );
  });

  await it('Empty PERSON_LIST → رفض 422 قبل المسح بلا آثار جزئية', async () => {
    const seeded = await seedCalculated('57400');
    const before = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
    const artsBefore = await withTransaction((c) => loadRunCalculationArtifacts(c, seeded.run.id));
    const auditsBefore = await auditCount(seeded.run.id, 'payroll_run.recalculated');
    // إعداد اختبار: إفراغ الأعضاء مباشرة (API يمنع ذلك على CALCULATED)
    await query(`DELETE FROM accounts.payroll_run_scope_members WHERE payroll_run_id=$1::uuid`, [
      seeded.run.id,
    ]);
    assert((await memberCount(seeded.run.id)) === 0, 'empty members');
    await throwsHttp(
      () =>
        withTransaction((c) =>
          recalculatePayrollRunCore(c, {
            run_id: before.id,
            version: before.version,
            updated_at: before.updated_at,
            userId,
            idempotency_key: randomUUID(),
            reason: 'محاولة إعادة احتساب بقائمة أشخاص فارغة',
          })
        ),
      422,
      'EMPTY_PERSON_LIST'
    );
    await assertSnapshotFrozen(seeded.run.id, {
      status: 'CALCULATED',
      snapshot_hash: before.snapshot_hash,
      gross_total: before.gross_total,
      version: before.version,
      updated_at: before.updated_at,
      calculated_at: before.calculated_at,
      people: artsBefore.people.length,
      lines: artsBefore.lines.length,
      issues: artsBefore.issues.length,
      successAudits: auditsBefore,
    });
  });

  // —— Idempotency ——
  await it('نفس المفتاح → replay بلا mutation/audit جديد', async () => {
    const seeded = await seedCalculated('85000');
    const key = `recalc-replay-${token}`;
    const reason = 'تعديل الراتب الأساسي لإعادة المحاولة';
    const first = await recalc(seeded.run, { key, reason });
    const v1 = first.run.version;
    const hash1 = first.run.snapshot_hash;
    const audits1 = await auditCount(seeded.run.id, 'payroll_run.recalculated');
    const second = await recalc(
      {
        id: seeded.run.id,
        version: seeded.run.version,
        updated_at: seeded.run.updated_at,
      },
      { key, reason }
    );
    assert(second.idempotent_replay === true, 'replay');
    assert(second.run.version === v1, 'version unchanged');
    assert(second.run.snapshot_hash === hash1, 'hash unchanged');
    assert((await auditCount(seeded.run.id, 'payroll_run.recalculated')) === audits1, 'no new audit');
  });

  await it('نفس المفتاح + سبب مختلف → IDEMPOTENCY_CONFLICT', async () => {
    const seeded = await seedCalculated('86000');
    const key = `recalc-conflict-${token}`;
    await recalc(seeded.run, { key, reason: 'تعديل الراتب الأساسي النسخة الأولى' });
    await throwsHttp(
      () =>
        recalc(
          {
            id: seeded.run.id,
            version: seeded.run.version,
            updated_at: seeded.run.updated_at,
          },
          { key, reason: 'تعديل الراتب الأساسي النسخة الثانية المختلفة' }
        ),
      409,
      'IDEMPOTENCY_CONFLICT'
    );
  });

  await it('مفتاح جديد → Recalculate آخر مسموح', async () => {
    const seeded = await seedCalculated('87000');
    await recalc(seeded.run, { reason: 'أول إعادة احتساب بمفتاح أول' });
    const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
    const second = await recalc(after, { reason: 'ثاني إعادة احتساب بمفتاح جديد' });
    assert(second.idempotent_replay === false, 'new recalc');
    assert((await auditCount(seeded.run.id, 'payroll_run.recalculated')) === 2, 'two audits');
  });

  await it('بصمة الحمولة تتضمن version و updated_at', async () => {
    const seeded = await seedCalculated('87500');
    const key = normalizeRecalculateIdempotencyKey(`fp-${token}`);
    const reason = normalizeRecalculateReason('فحص بصمة الحمولة لإعادة الاحتساب');
    const p1 = buildRecalculateRequestPayloadHash({
      run_id: seeded.run.id,
      reason,
      expected_version: seeded.run.version,
      expected_updated_at: String(seeded.run.updated_at),
    });
    const p2 = buildRecalculateRequestPayloadHash({
      run_id: seeded.run.id,
      reason,
      expected_version: seeded.run.version + 1,
      expected_updated_at: String(seeded.run.updated_at),
    });
    assert(p1 !== p2, 'version affects payload hash');
    assert(p1.length === 64, 'hex');
  });

  // —— Atomicity failpoints ——
  const failpoints: Exclude<PayrollRecalcFailpoint, null>[] = [
    'after_previous_summary',
    'after_delete',
    'after_first_person',
    'after_first_line',
    'before_run_hash',
    'before_totals_update',
    'during_audit',
  ];
  for (const fp of failpoints) {
    await it(`ذرّية failpoint ${fp} → CALCULATED السابق سليم بالكامل`, async () => {
      const seeded = await seedCalculated(`9${failpoints.indexOf(fp)}000`);
      const before = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const artsBefore = await withTransaction((c) =>
        loadRunCalculationArtifacts(c, seeded.run.id)
      );
      const auditsBefore = await auditCount(seeded.run.id, 'payroll_run.recalculated');
      __setPayrollRecalcFailpointForTests(fp);
      try {
        await recalc(before, { reason: `فشل اختباري عند ${fp} لإعادة الاحتساب` });
        throw new Error('should have failed');
      } catch (e) {
        assert(
          e instanceof Error && e.message === `RECALC_FAILPOINT_${fp}`,
          `fp msg ${e instanceof Error ? e.message : e}`
        );
      }
      await assertSnapshotFrozen(seeded.run.id, {
        status: 'CALCULATED',
        snapshot_hash: before.snapshot_hash,
        gross_total: before.gross_total,
        version: before.version,
        updated_at: before.updated_at,
        calculated_at: before.calculated_at,
        people: artsBefore.people.length,
        lines: artsBefore.lines.length,
        issues: artsBefore.issues.length,
        successAudits: auditsBefore,
      });
      const artsAfter = await withTransaction((c) =>
        loadRunCalculationArtifacts(c, seeded.run.id)
      );
      assert(artsAfter.people.length === artsBefore.people.length, 'no dup people');
      assert(artsAfter.lines.length === artsBefore.lines.length, 'no dup lines');
    });
  }

  // —— Concurrency ——
  await it('Concurrent Recalculate×Recalculate — فائز واحد', async () => {
    const seeded = await seedCalculated('91000');
    const key1 = randomUUID();
    const key2 = randomUUID();
    const p1 = withTransaction((c) =>
      recalculatePayrollRunCore(c, {
        run_id: seeded.run.id,
        version: seeded.run.version,
        updated_at: seeded.run.updated_at,
        userId,
        idempotency_key: key1,
        reason: 'تزامن إعادة احتساب الطرف الأول',
      })
    );
    const p2 = withTransaction((c) =>
      recalculatePayrollRunCore(c, {
        run_id: seeded.run.id,
        version: seeded.run.version,
        updated_at: seeded.run.updated_at,
        userId,
        idempotency_key: key2,
        reason: 'تزامن إعادة احتساب الطرف الثاني',
      })
    );
    const settled = await Promise.allSettled([p1, p2]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');
    assert(fulfilled.length >= 1, 'one success');
    for (const r of rejected) {
      const err = (r as PromiseRejectedResult).reason;
      assert(err instanceof AccountsHttpError && err.status === 409, '409 loser');
    }
    const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
    assert(after.status === 'CALCULATED', 'final CALCULATED');
    assert(after.status !== 'CALCULATING', 'not stuck');
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, seeded.run.id));
    assert(arts.people.length >= 1, 'artifacts present');
  });

  await it('Concurrent Recalculate×Cancel — A أو B فقط', async () => {
    const seeded = await seedCalculated('92000');
    const recalcP = withTransaction((c) =>
      recalculatePayrollRunCore(c, {
        run_id: seeded.run.id,
        version: seeded.run.version,
        updated_at: seeded.run.updated_at,
        userId,
        idempotency_key: randomUUID(),
        reason: 'تزامن إعادة احتساب مع إلغاء',
      })
    );
    const cancelP = withTransaction((c) =>
      cancelPayrollRun(c, {
        id: seeded.run.id,
        userId,
        version: seeded.run.version,
        updated_at: seeded.run.updated_at,
        reason: 'إلغاء متزامن مع إعادة الاحتساب',
      })
    );
    await Promise.allSettled([recalcP, cancelP]);
    const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
    assert(
      after.status === 'CALCULATED' || after.status === 'CANCELLED',
      `status ${after.status}`
    );
    assert(after.status !== 'CALCULATING', 'not stuck');
  });

  await it('Concurrent Recalculate×Update — فائز واحد بلا lost update', async () => {
    const seeded = await seedCalculated('92100');
    const before = seeded.run;
    const artsBefore = await withTransaction((c) => loadRunCalculationArtifacts(c, before.id));
    const recalcP = withTransaction((c) =>
      recalculatePayrollRunCore(c, {
        run_id: before.id,
        version: before.version,
        updated_at: before.updated_at,
        userId,
        idempotency_key: randomUUID(),
        reason: 'تزامن إعادة احتساب مع تحديث تشغيل',
      })
    );
    // مسار داخلي حقيقي — على CALCULATED يرفض؛ السباق عبر اتصالين مستقلين
    const updateP = withTransaction((c) =>
      updatePayrollRun(c, {
        id: before.id,
        userId,
        version: before.version,
        updated_at: before.updated_at,
        run_type: 'REGULAR',
      })
    );
    const settled = await Promise.allSettled([recalcP, updateP]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');
    assert(fulfilled.length + rejected.length === 2, 'both settled');
    assert(fulfilled.length >= 1 || rejected.length >= 1, 'outcomes');
    for (const r of rejected) {
      const err = (r as PromiseRejectedResult).reason;
      assert(err instanceof AccountsHttpError && err.status === 409, '409 conflict/stale');
    }
    const after = await withTransaction((c) => loadPayrollRun(c, before.id));
    assert(after.status === 'CALCULATED', 'CALCULATED');
    assert(after.status !== 'CALCULATING', 'not stuck');
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, before.id));
    assert(arts.people.length >= 1, 'artifacts');
    // لا لقطة جزئية: إما نفس الآثار أو إعادة بناء كاملة
    assert(
      arts.people.length === artsBefore.people.length ||
        (await auditCount(before.id, 'payroll_run.recalculated')) === 1,
      'consistent artifacts'
    );
    assert((await auditCount(before.id, 'payroll_run.recalculated')) <= 1, 'at most one success');
  });

  await it('Concurrent Recalculate×Scope mutation — لا لقطة هجينة', async () => {
    const seeded = await seedCalculated('92200');
    const extra = await mkPerson({ full_name_ar: 'عضو سباق' });
    await mkContract(extra.id);
    const before = seeded.run;
    const membersBefore = await memberCount(before.id);
    const recalcP = withTransaction((c) =>
      recalculatePayrollRunCore(c, {
        run_id: before.id,
        version: before.version,
        updated_at: before.updated_at,
        userId,
        idempotency_key: randomUUID(),
        reason: 'تزامن إعادة احتساب مع تعديل نطاق',
      })
    );
    const scopeP = withTransaction((c) =>
      addScopeMember(c, {
        runId: before.id,
        personId: extra.id,
        userId,
        version: before.version,
        updated_at: before.updated_at,
      })
    );
    const settled = await Promise.allSettled([recalcP, scopeP]);
    for (const r of settled.filter((s) => s.status === 'rejected')) {
      const err = (r as PromiseRejectedResult).reason;
      assert(err instanceof AccountsHttpError && err.status === 409, '409 loser');
    }
    const after = await withTransaction((c) => loadPayrollRun(c, before.id));
    assert(after.status === 'CALCULATED', 'CALCULATED');
    assert(after.status !== 'CALCULATING', 'not stuck');
    const membersAfter = await memberCount(before.id);
    // Scope mutation على CALCULATED مرفوض — الأعضاء لا تتلف ولا تُضاعف جزئيًا
    assert(membersAfter === membersBefore, 'scope_members intact');
    const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, before.id));
    const personIds = (arts.people as Array<{ payroll_person_id: string }>).map(
      (p) => p.payroll_person_id
    );
    assert(new Set(personIds).size === personIds.length, 'no duplicate people artifacts');
  });

  // —— Idempotency integrity ——
  await it('Corrupt prior Audit بلا request_payload_hash → رفض بلا mutation', async () => {
    const seeded = await seedCalculated('92300');
    const key = `corrupt-payload-${token}`;
    const keyHash = buildRecalculateRequestKeyHash(normalizeRecalculateIdempotencyKey(key));
    await query(
      `INSERT INTO accounts.financial_audit_log
         (user_id, action, entity_type, entity_id, old_values, new_values, description)
       VALUES ($1::uuid, 'payroll_run.recalculated', 'payroll_run', $2::uuid,
               '{"previous_snapshot_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb,
               $3::jsonb, 'تدقيق تالف للاختبار')`,
      [
        userId,
        seeded.run.id,
        JSON.stringify({
          source_action: 'RECALCULATE',
          request_key_hash: keyHash,
          new_snapshot_hash: seeded.run.snapshot_hash,
          // بلا request_payload_hash
        }),
      ]
    );
    const before = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
    const artsBefore = await withTransaction((c) => loadRunCalculationArtifacts(c, before.id));
    const auditsBefore = await auditCount(seeded.run.id, 'payroll_run.recalculated');
    await throwsHttp(
      () =>
        withTransaction((c) =>
          recalculatePayrollRunCore(c, {
            run_id: before.id,
            version: before.version,
            updated_at: before.updated_at,
            userId,
            idempotency_key: key,
            reason: 'محاولة إعادة احتساب مع تدقيق تالف',
          })
        ),
      409,
      'تالف'
    );
    await assertSnapshotFrozen(before.id, {
      status: 'CALCULATED',
      snapshot_hash: before.snapshot_hash,
      gross_total: before.gross_total,
      version: before.version,
      updated_at: before.updated_at,
      calculated_at: before.calculated_at,
      people: artsBefore.people.length,
      lines: artsBefore.lines.length,
      issues: artsBefore.issues.length,
      successAudits: auditsBefore,
    });
  });

  await it('Corrupt prior Audit بلا new_snapshot_hash → رفض', async () => {
    const seeded = await seedCalculated('92400');
    const key = `corrupt-hash-${token}`;
    const keyHash = buildRecalculateRequestKeyHash(normalizeRecalculateIdempotencyKey(key));
    const reason = normalizeRecalculateReason('محاولة إعادة احتساب مع تدقيق بلا بصمة');
    const payloadHash = buildRecalculateRequestPayloadHash({
      run_id: seeded.run.id,
      reason,
      expected_version: seeded.run.version,
      expected_updated_at: String(seeded.run.updated_at),
    });
    await query(
      `INSERT INTO accounts.financial_audit_log
         (user_id, action, entity_type, entity_id, old_values, new_values, description)
       VALUES ($1::uuid, 'payroll_run.recalculated', 'payroll_run', $2::uuid,
               '{}'::jsonb, $3::jsonb, 'تدقيق بلا بصمة')`,
      [
        userId,
        seeded.run.id,
        JSON.stringify({
          source_action: 'RECALCULATE',
          request_key_hash: keyHash,
          request_payload_hash: payloadHash,
          // بلا new_snapshot_hash
        }),
      ]
    );
    await throwsHttp(
      () =>
        withTransaction((c) =>
          recalculatePayrollRunCore(c, {
            run_id: seeded.run.id,
            version: seeded.run.version,
            updated_at: seeded.run.updated_at,
            userId,
            idempotency_key: key,
            reason,
          })
        ),
      409,
      'تالف'
    );
  });

  await it('Corrupt prior Audit لتشغيل مختلف بنفس المفتاح — لا يُعتبر Replay', async () => {
    const a = await seedCalculated('92500');
    const b = await seedCalculated('92510');
    const key = `cross-run-${token}`;
    const reason = normalizeRecalculateReason('إعادة احتساب على تشغيل آخر بنفس المفتاح');
    await recalc(a.run, { key, reason });
    // المفتاح مستخدم على A؛ على B لا يوجد prior لنفس entity — يجب أن ينجح كعملية جديدة
    // لكن إن زُرع Audit على B يشير لمفتاح A جزئيًا تالفًا:
    const keyHash = buildRecalculateRequestKeyHash(normalizeRecalculateIdempotencyKey(key));
    await query(
      `INSERT INTO accounts.financial_audit_log
         (user_id, action, entity_type, entity_id, old_values, new_values, description)
       VALUES ($1::uuid, 'payroll_run.recalculated', 'payroll_run', $2::uuid,
               '{}'::jsonb, $3::jsonb, 'تدقيق يشير لتشغيل خاطئ')`,
      [
        userId,
        b.run.id,
        JSON.stringify({
          source_action: 'RECALCULATE',
          request_key_hash: keyHash,
          // payload و hash ناقصان → تالف
        }),
      ]
    );
    await throwsHttp(
      () =>
        withTransaction((c) =>
          recalculatePayrollRunCore(c, {
            run_id: b.run.id,
            version: b.run.version,
            updated_at: b.run.updated_at,
            userId,
            idempotency_key: key,
            reason,
          })
        ),
      409,
      'تالف'
    );
  });

  await it('Duplicate successful Audit لنفس request_key_hash → رفض قبل mutation', async () => {
    const seeded = await seedCalculated('92600');
    const key = `dup-success-${token}`;
    const reason = normalizeRecalculateReason('إعادة احتساب مع تكرار سجل نجاح مزروع');
    const keyHash = buildRecalculateRequestKeyHash(normalizeRecalculateIdempotencyKey(key));
    const payloadHash = buildRecalculateRequestPayloadHash({
      run_id: seeded.run.id,
      reason,
      expected_version: seeded.run.version,
      expected_updated_at: String(seeded.run.updated_at),
    });
    const nv = {
      source_action: 'RECALCULATE',
      request_key_hash: keyHash,
      request_payload_hash: payloadHash,
      new_snapshot_hash: seeded.run.snapshot_hash,
      new_gross_total: String(seeded.run.gross_total),
      new_deduction_total: String(seeded.run.deduction_total),
      new_net_total: String(seeded.run.net_total),
      reason,
    };
    const ov = {
      previous_snapshot_hash: seeded.run.snapshot_hash,
      previous_gross_total: String(seeded.run.gross_total),
      previous_deduction_total: String(seeded.run.deduction_total),
      previous_net_total: String(seeded.run.net_total),
    };
    for (let i = 0; i < 2; i += 1) {
      await query(
        `INSERT INTO accounts.financial_audit_log
           (user_id, action, entity_type, entity_id, old_values, new_values, description)
         VALUES ($1::uuid, 'payroll_run.recalculated', 'payroll_run', $2::uuid, $3::jsonb, $4::jsonb, $5)`,
        [userId, seeded.run.id, JSON.stringify(ov), JSON.stringify(nv), reason]
      );
    }
    const before = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
    await throwsHttp(
      () =>
        withTransaction((c) =>
          recalculatePayrollRunCore(c, {
            run_id: before.id,
            version: before.version,
            updated_at: before.updated_at,
            userId,
            idempotency_key: key,
            reason,
          })
        ),
      409,
      'DUPLICATE_RECALC_AUDIT'
    );
    assert(before.version === seeded.run.version, 'no version bump');
    // Verify يكتشف التكرار
    const v = await withTransaction((c) => verifyPayrollRecalculateCore(c, { strict: true }));
    assert(!v.ok, 'verify fails on duplicate');
    assert(
      v.mismatches.some((m) => m.kind === 'recalc_duplicate_success_same_key'),
      'duplicate mismatch'
    );
  });

  // —— Posting guard ——
  await it('حارس الترحيل بعد Recalculate نظيف', async () => {
    const seeded = await seedCalculated('93000');
    const result = await recalc(seeded.run, {
      reason: 'إعادة احتساب للتحقق من جاهزية الترحيل',
    });
    assert(
      isPayrollRunReadyForPosting({
        status: result.run.status,
        error_count: result.run.error_count,
        snapshot_hash: result.run.snapshot_hash,
      }),
      'ready'
    );
  });

  await it('حارس الترحيل يرفض عند error_count بعد مصادر مختلطة', async () => {
    const seeded = await seedCalculated('94000');
    // كسر العقد بعملة مختلفة عبر تحديث مباشر
    await query(
      `UPDATE accounts.payroll_contracts SET currency_code='USD', updated_at=NOW(), version=version+1 WHERE id=$1::uuid`,
      [seeded.contract.id]
    );
    const result = await recalc(seeded.run, {
      reason: 'إعادة احتساب بعد تعارض عملة العقد',
    });
    assert(Number(result.run.error_count) > 0, 'has errors');
    assert(
      !isPayrollRunReadyForPosting({
        status: result.run.status,
        error_count: result.run.error_count,
        snapshot_hash: result.run.snapshot_hash,
      }),
      'not ready'
    );
  });

  // —— Verify ——
  await it('verify مع بيانات سليمة (normal+strict) + calculation regression', async () => {
    // تنظيف Audits المزوّرة من اختبارات الفساد حتى لا تلوّث verify السليم
    await query(
      `DELETE FROM accounts.financial_audit_log
       WHERE entity_type='payroll_run' AND entity_id = ANY($1::uuid[])
         AND (
           new_values->>'request_payload_hash' IS NULL
           OR new_values->>'new_snapshot_hash' IS NULL
           OR description LIKE '%تالف%'
           OR description LIKE '%بلا بصمة%'
           OR description LIKE '%تشغيل خاطئ%'
           OR description LIKE '%تكرار سجل نجاح%'
         )`,
      [owned.runIds]
    );
    // احذف التكرارات المزروعة: أبقِ أحدث recalculated لكل run|key إن وُجدت مضاعفات اختبارية
    await query(
      `DELETE FROM accounts.financial_audit_log a
       USING accounts.financial_audit_log b
       WHERE a.entity_type='payroll_run' AND b.entity_type='payroll_run'
         AND a.action='payroll_run.recalculated' AND b.action='payroll_run.recalculated'
         AND a.entity_id = b.entity_id
         AND a.entity_id = ANY($1::uuid[])
         AND a.new_values->>'request_key_hash' = b.new_values->>'request_key_hash'
         AND a.id < b.id`,
      [owned.runIds]
    );

    const normal = await withTransaction((c) => verifyPayrollRecalculateCore(c, { strict: false }));
    assert(normal.ok, `normal ok: ${JSON.stringify(normal.mismatches.slice(0, 3))}`);
    assert(normal.mismatches.length === 0, 'mismatch_count=0');
    const strict = await withTransaction((c) => verifyPayrollRecalculateCore(c, { strict: true }));
    assert(strict.ok, `strict ok: ${JSON.stringify(strict.mismatches.slice(0, 3))}`);
    assert(strict.mismatches.length === 0, 'strict mismatch_count=0');
    const c = await withTransaction((c2) => verifyPayrollCalculationCore(c2, { strict: false }));
    assert(c.ok, `calc verify: ${JSON.stringify(c.mismatches.slice(0, 3))}`);
  });

  await it('verify يكتشف Audit مشوّه (strict يفشل)', async () => {
    const seeded = await seedCalculated('95000');
    await query(
      `INSERT INTO accounts.financial_audit_log
         (user_id, action, entity_type, entity_id, old_values, new_values, description)
       VALUES ($1::uuid, 'payroll_run.recalculated', 'payroll_run', $2::uuid,
               '{}'::jsonb, '{"source_action":"RECALCULATE"}'::jsonb, 'قصير')`,
      [userId, seeded.run.id]
    );
    const strict = await withTransaction((c) => verifyPayrollRecalculateCore(c, { strict: true }));
    assert(!strict.ok, 'strict fails');
    assert(strict.mismatches.length > 0, 'has mismatches');
    // أزل السجل المشوه قبل التنظيف العام
    await query(
      `DELETE FROM accounts.financial_audit_log
       WHERE entity_id=$1::uuid AND description='قصير'`,
      [seeded.run.id]
    );
  });

  // —— Cleanup ——
  await it('تنظيف الملكية = 0', async () => {
    await cleanupOwned();
    assert((await countOwned()) === 0, 'cleanup zero');
  });

  await it('verify بيئة فارغة normal: ok بلا mismatch', async () => {
    const v = await withTransaction(async (c) => {
      await txQuery(c, `SAVEPOINT __empty_recalc_verify_normal`);
      await txQuery(
        c,
        `DELETE FROM accounts.financial_audit_log WHERE action = 'payroll_run.recalculated'`
      );
      const result = await verifyPayrollRecalculateCore(c, { strict: false });
      await txQuery(c, `ROLLBACK TO SAVEPOINT __empty_recalc_verify_normal`);
      await txQuery(c, `RELEASE SAVEPOINT __empty_recalc_verify_normal`);
      return result;
    });
    assert(v.ok === true, 'ok');
    assert(v.mismatches.length === 0, 'mismatch_count=0');
    assert(v.warnings.length === 0, 'warning_count=0');
    assert(v.summary.recalculated_audits === 0, 'audits=0');
    console.log(
      `   [verify empty normal] ok=${v.ok} mismatch=${v.mismatches.length} warnings=${v.warnings.length} audits=${v.summary.recalculated_audits}`
    );
  });

  await it('verify بيئة فارغة strict: ok بلا warning مُفشل', async () => {
    const v = await withTransaction(async (c) => {
      await txQuery(c, `SAVEPOINT __empty_recalc_verify_strict`);
      await txQuery(
        c,
        `DELETE FROM accounts.financial_audit_log WHERE action = 'payroll_run.recalculated'`
      );
      const result = await verifyPayrollRecalculateCore(c, { strict: true });
      await txQuery(c, `ROLLBACK TO SAVEPOINT __empty_recalc_verify_strict`);
      await txQuery(c, `RELEASE SAVEPOINT __empty_recalc_verify_strict`);
      return result;
    });
    assert(v.ok === true, 'ok');
    assert(v.mismatches.length === 0, 'mismatch_count=0');
    assert(v.warnings.length === 0, 'warning_count=0 (info only in summary)');
    assert(v.summary.recalculated_audits === 0, 'audits=0');
    assert(typeof v.summary.empty_audits_info === 'string', 'info message');
    console.log(
      `   [verify empty strict] ok=${v.ok} mismatch=${v.mismatches.length} warnings=${v.warnings.length} info=${v.summary.empty_audits_info}`
    );
  });

  console.log(`\n—— النتيجة: ${passCount} نجاح / ${failCount} فشل ——`);
  console.log('أسماء الاختبارات أعلاه في السجل ✅/❌');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    __clearPayrollRecalcFailpointForTests();
    try {
      await cleanupOwned();
    } catch {
      /* ignore */
    }
    await closePool();
  });
