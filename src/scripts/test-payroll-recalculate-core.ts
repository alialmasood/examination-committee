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
import { createPayrollPerson, setPayrollPersonStatus } from '../lib/accounts/payroll-people';
import { createPayrollPeriod } from '../lib/accounts/payroll-periods';
import {
  cancelPayrollRun,
  createPayrollRun,
  loadPayrollRun,
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
      (SELECT COUNT(*)::int FROM accounts.payroll_people WHERE id=ANY($4::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_components WHERE id=ANY($5::uuid[])) +
      (SELECT COUNT(*)::int FROM student_affairs.colleges WHERE id=ANY($6::uuid[])) +
      (SELECT COUNT(*)::int FROM student_affairs.departments WHERE id=ANY($7::uuid[])) AS n`,
    [
      owned.calendarIds,
      owned.periodIds,
      owned.runIds,
      owned.personIds,
      owned.componentIds,
      owned.collegeIds,
      owned.departmentIds,
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

  await it('PERSON_LIST عضو غير مؤهل → EXCLUDED بعد Recalculate', async () => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    const contract = await mkContract(person.id);
    const fix = await mkFixedComponent('84000');
    await mkPca(person.id, fix.id, { payroll_contract_id: contract.id, amount: '84000' });
    const runDraft = await mkRunWithPerson(period.id, person.id);
    const calculated = await calc(runDraft);
    const personRow = await query(
      `SELECT version, updated_at FROM accounts.payroll_people WHERE id=$1::uuid`,
      [person.id]
    );
    await withTransaction((c) =>
      setPayrollPersonStatus(c, {
        id: person.id,
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
    assert(result.summary.excluded_people >= 1 || result.summary.error_people >= 1, 'excluded/error');
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
    await it(`ذرّية failpoint ${fp} → CALCULATED السابق سليم`, async () => {
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
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(after.status === 'CALCULATED', `status ${after.status}`);
      assert(after.snapshot_hash === before.snapshot_hash, 'hash preserved');
      assert(String(after.gross_total) === String(before.gross_total), 'gross preserved');
      const artsAfter = await withTransaction((c) =>
        loadRunCalculationArtifacts(c, seeded.run.id)
      );
      assert(artsAfter.people.length === artsBefore.people.length, 'people preserved');
      assert(artsAfter.lines.length === artsBefore.lines.length, 'lines preserved');
      assert(
        (await auditCount(seeded.run.id, 'payroll_run.recalculated')) === auditsBefore,
        'no success audit'
      );
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
  await it('verify recalculate core + calculation regression', async () => {
    const v = await withTransaction((c) => verifyPayrollRecalculateCore(c, { strict: false }));
    assert(v.ok, `recalc verify: ${JSON.stringify(v.mismatches.slice(0, 3))}`);
    const c = await withTransaction((c2) => verifyPayrollCalculationCore(c2, { strict: false }));
    assert(c.ok, `calc verify: ${JSON.stringify(c.mismatches.slice(0, 3))}`);
  });

  // —— Cleanup ——
  await it('تنظيف الملكية = 0', async () => {
    await cleanupOwned();
    assert((await countOwned()) === 0, 'cleanup zero');
  });

  console.log(`\n—— النتيجة: ${passCount} نجاح / ${failCount} فشل ——`);
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
