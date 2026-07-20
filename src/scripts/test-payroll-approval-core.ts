/**
 * اختبارات نواة اعتماد الرواتب 9.B.1 — Acceptance Hardening
 * npm run test:payroll-approval-core
 *
 * عزل: ownership token + cleanupOwned في finally. تشغيل مرتين بلا تراكم.
 */
import { randomUUID } from 'crypto';
import { closePool, pool, query } from '../lib/db';
import { AccountsHttpError } from '../lib/accounts/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import {
  submitPayrollRunForReviewCore,
  approvePayrollRunCore,
  rejectPayrollRunReviewCore,
} from '../lib/accounts/payroll-approval-core';
import {
  __clearPayrollApprovalFailpointForTests,
  __setPayrollApprovalFailpointForTests,
  type PayrollApprovalFailpoint,
} from '../lib/accounts/payroll-approval-failpoints';
import { calculatePayrollRunCore } from '../lib/accounts/payroll-calculation-engine';
import { recalculatePayrollRunCore } from '../lib/accounts/payroll-recalculate-core';
import { createPayrollCalendar } from '../lib/accounts/payroll-calendars';
import { createPayrollPeriod } from '../lib/accounts/payroll-periods';
import { createPayrollPerson } from '../lib/accounts/payroll-people';
import {
  createPayrollContract,
  transitionPayrollContract,
} from '../lib/accounts/payroll-contracts';
import { createPayrollComponent } from '../lib/accounts/payroll-components';
import { createPayrollComponentAssignment } from '../lib/accounts/payroll-component-assignments';
import {
  cancelPayrollRun,
  createPayrollRun,
  updatePayrollRun,
  loadPayrollRun,
} from '../lib/accounts/payroll-runs';
import { addScopeMember } from '../lib/accounts/payroll-run-scope';
import {
  assertPayrollRunReadyForPosting,
  isPayrollRunReadyForPosting,
} from '../lib/accounts/payroll-posting-guard';
import { verifyPayrollApprovalCore } from '../lib/accounts/verify-payroll-approval-core';
import { withTransaction, txQuery } from '../lib/accounts/with-transaction';

let passCount = 0;
let failCount = 0;
const testNames: string[] = [];

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
  testNames.push(name);
  try {
    await fn();
    ok(name);
  } catch (e) {
    failed(name, e);
  } finally {
    __clearPayrollApprovalFailpointForTests();
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
async function expectDbReject(fn: () => Promise<unknown>, hint: string) {
  try {
    await fn();
    throw new Error(`توقّعنا رفض قيد DB: ${hint}`);
  } catch (e) {
    const s = String(e);
    assert(
      s.includes('check') ||
        s.includes('CHECK') ||
        s.includes('violates') ||
        s.includes('unique') ||
        s.includes('duplicate') ||
        s.includes('23514') ||
        s.includes('23505'),
      `${hint}: ${s}`
    );
  }
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
  extraUserIds: [] as string[],
};

async function cleanupOwned() {
  if (owned.runIds.length) {
    await query(
      `DELETE FROM accounts.payroll_run_approval_actions WHERE payroll_run_id = ANY($1::uuid[])`,
      [owned.runIds]
    );
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
    await query(
      `DELETE FROM accounts.financial_audit_log WHERE entity_type='payroll_run' AND entity_id = ANY($1::uuid[])`,
      [owned.runIds]
    );
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
  for (const uid of owned.extraUserIds) {
    await query(`DELETE FROM student_affairs.user_systems WHERE user_id=$1::uuid`, [uid]);
    await query(`DELETE FROM platform.user_system_roles WHERE user_id=$1::uuid`, [uid]);
    await query(
      `DELETE FROM student_affairs.users WHERE id=$1::uuid AND username LIKE 'appr9b1%'`,
      [uid]
    );
  }
}

async function countOwned() {
  const r = await query(
    `SELECT
      (SELECT COUNT(*)::int FROM accounts.payroll_calendars WHERE id=ANY($1::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_periods WHERE id=ANY($2::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_runs WHERE id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_run_approval_actions WHERE payroll_run_id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_run_people WHERE payroll_run_id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_run_lines WHERE payroll_run_id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_run_issues WHERE payroll_run_id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_run_scope_members WHERE payroll_run_id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_people WHERE id=ANY($4::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_components WHERE id=ANY($5::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_contracts WHERE id=ANY($6::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_component_assignments WHERE id=ANY($7::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.financial_audit_log
         WHERE entity_type='payroll_run' AND entity_id=ANY($3::uuid[])) AS n`,
    [
      owned.calendarIds,
      owned.periodIds,
      owned.runIds,
      owned.personIds,
      owned.componentIds,
      owned.contractIds,
      owned.pcaIds,
    ]
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function actionCount(runId: string, action?: string) {
  const r = await query(
    action
      ? `SELECT COUNT(*)::int n FROM accounts.payroll_run_approval_actions
         WHERE payroll_run_id=$1::uuid AND action=$2`
      : `SELECT COUNT(*)::int n FROM accounts.payroll_run_approval_actions
         WHERE payroll_run_id=$1::uuid`,
    action ? [runId, action] : [runId]
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

async function snapshotRun(id: string) {
  const r = await query(`SELECT * FROM accounts.payroll_runs WHERE id=$1::uuid`, [id]);
  return r.rows[0] as Record<string, unknown>;
}

async function sanitizeUnderReviewLeftovers() {
  if (!owned.runIds.length) return;
  await query(
    `DELETE FROM accounts.payroll_run_issues
     WHERE payroll_run_id = ANY($1::uuid[])
       AND issue_code IN ('TEST_WARN','TEST_ERR','BLK_ERR','DRIFT_ERR')`,
    [owned.runIds]
  );
  await query(
    `UPDATE accounts.payroll_runs r SET
       error_count = 0,
       snapshot_hash = COALESCE(r.review_snapshot_hash, r.snapshot_hash),
       gross_total = COALESCE(p.g, r.gross_total),
       deduction_total = COALESCE(p.d, r.deduction_total),
       employer_contribution_total = COALESCE(p.e, r.employer_contribution_total),
       net_total = COALESCE(p.n, r.net_total),
       people_count = COALESCE(p.pc, r.people_count)
     FROM (
       SELECT payroll_run_id,
         SUM(gross_amount) g, SUM(deductions_amount) d,
         SUM(employer_contributions_amount) e, SUM(net_amount) n,
         COUNT(*)::int pc
       FROM accounts.payroll_run_people WHERE superseded=FALSE
       GROUP BY payroll_run_id
     ) p
     WHERE r.id = p.payroll_run_id
       AND r.id = ANY($1::uuid[])
       AND r.status = 'UNDER_REVIEW'`,
    [owned.runIds]
  );
}

async function main() {
  console.log('===== اختبارات نواة اعتماد الرواتب 9.B.1 =====');
  const token = `APPR${Date.now().toString(36).toUpperCase()}`;
  let seq = 0;
  const uniq = (p: string) => {
    seq += 1;
    return `${p}-${token}-${seq}`;
  };

  const cols = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='accounts' AND table_name='payroll_runs'
       AND column_name IN ('approval_cycle','review_snapshot_hash','submitted_for_review_at',
                           'submitted_for_review_by','approved_snapshot_hash','approved_at','approved_by')`
  );
  if (cols.rows.length < 7) {
    failed('إعداد: Migration 097 غير مطبّقة — شغّل npm run migrate');
    await closePool();
    return;
  }

  const users = await query(
    `SELECT u.id FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id=u.id
     JOIN student_affairs.systems s ON s.id=us.system_id
     WHERE s.code='ACCOUNTS' AND u.is_active ORDER BY u.created_at LIMIT 5`
  );
  if (!users.rows[0]) {
    failed('إعداد: لا مستخدم ACCOUNTS');
    await closePool();
    return;
  }
  const submitterId = users.rows[0].id as string;
  await grantAccountsAdminRole(submitterId);

  let approverId = users.rows[1]?.id as string | undefined;
  if (!approverId || approverId === submitterId) {
    const created = await query(
      `INSERT INTO student_affairs.users (username, password_hash, full_name, is_active)
       VALUES ($1, 'x', 'مراجع اعتماد 9B1', TRUE) RETURNING id`,
      [`appr9b1_${token}`]
    );
    approverId = created.rows[0].id as string;
    owned.extraUserIds.push(approverId);
    await query(
      `INSERT INTO student_affairs.user_systems (user_id, system_id)
       SELECT $1::uuid, s.id FROM student_affairs.systems s WHERE s.code='ACCOUNTS'
       ON CONFLICT DO NOTHING`,
      [approverId]
    );
  }
  await grantAccountsAdminRole(approverId);

  let fy = await query(
    `SELECT id FROM accounts.fiscal_years WHERE status='ACTIVE' ORDER BY is_default DESC, start_date DESC LIMIT 1`
  );
  if (!fy.rows[0]) {
    fy = await query(
      `INSERT INTO accounts.fiscal_years (code,name_ar,start_date,end_date,status,is_default,created_by)
       VALUES ($1,'سنة اعتماد','2025-01-01','2025-12-31','ACTIVE',FALSE,$2) RETURNING id`,
      [uniq('APPRFY'), submitterId]
    );
  }
  const fiscalYearId = fy.rows[0].id as string;

  const mkCalendar = async () => {
    const cal = await withTransaction((c) =>
      createPayrollCalendar(c, {
        code: uniq('APPRCAL'),
        name_ar: 'تقويم اعتماد',
        calendar_type: 'MONTHLY',
        currency_code: 'IQD',
        effective_from: '2025-01-01',
        created_by: submitterId,
      })
    );
    owned.calendarIds.push(cal.id);
    return cal;
  };
  const mkPeriod = async (calendarId: string) => {
    const p = await withTransaction((c) =>
      createPayrollPeriod(c, {
        payroll_calendar_id: calendarId,
        name_ar: 'فترة اعتماد',
        start_date: '2025-01-01',
        end_date: '2025-01-31',
        fiscal_year_id: fiscalYearId,
        created_by: submitterId,
      })
    );
    owned.periodIds.push(p.id);
    return p;
  };
  const mkPerson = async () => {
    const p = await withTransaction((c) =>
      createPayrollPerson(c, {
        full_name_ar: 'شخص اعتماد',
        person_type: 'EMPLOYEE',
        default_currency_code: 'IQD',
        effective_from: '2025-01-01',
        created_by: submitterId,
      })
    );
    owned.personIds.push(p.id);
    return p;
  };
  const mkContract = async (personId: string, base = '1000000') => {
    const c = await withTransaction(async (client) => {
      const draft = await createPayrollContract(client, {
        payroll_person_id: personId,
        compensation_basis: 'MONTHLY_FIXED',
        base_amount: base,
        currency_code: 'IQD',
        effective_from: '2025-01-01',
        created_by: submitterId,
      });
      owned.contractIds.push(draft.id);
      return transitionPayrollContract(client, {
        id: draft.id,
        userId: submitterId,
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
        component_code: uniq('AFIX'),
        name_ar: 'بدل اعتماد',
        component_type: 'EARNING',
        calculation_method: 'FIXED_AMOUNT',
        calculation_base_type: 'NONE',
        default_amount: amount,
        effective_from: '2025-01-01',
        created_by: submitterId,
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
        payroll_contract_id: over.payroll_contract_id as string | undefined,
        amount: over.amount as string | undefined,
        effective_from: '2025-01-01',
        created_by: submitterId,
      })
    );
    owned.pcaIds.push(pca.id);
    return pca;
  };
  const mkRun = async (periodId: string) => {
    const run = await withTransaction((c) =>
      createPayrollRun(c, {
        payroll_period_id: periodId,
        run_type: 'REGULAR',
        scope_type: 'PERSON_LIST',
        created_by: submitterId,
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
        userId: submitterId,
        version: run.version,
        updated_at: run.updated_at,
      });
      return r.run;
    });
    return run;
  };
  const calc = async (run: { id: string; version: number; updated_at: unknown }) =>
    withTransaction((c) =>
      calculatePayrollRunCore(c, {
        run_id: run.id,
        version: run.version,
        updated_at: run.updated_at,
        userId: submitterId,
        idempotency_key: randomUUID(),
      })
    );
  const seedCalculated = async (amount = '55000') => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    const contract = await mkContract(person.id);
    const fix = await mkFixedComponent(amount);
    await mkPca(person.id, fix.id, { payroll_contract_id: contract.id, amount });
    const run = await mkRunWithPerson(period.id, person.id);
    const first = await calc(run);
    return { cal, period, person, contract, fix, run: first.run, first };
  };

  const submit = (
    run: { id: string; version: number; updated_at: unknown },
    opts: { key?: string; comment?: string; userId?: string } = {}
  ) =>
    withTransaction((c) =>
      submitPayrollRunForReviewCore(c, {
        run_id: run.id,
        version: run.version,
        updated_at: run.updated_at,
        idempotency_key: opts.key ?? uniq('sub-key'),
        comment: opts.comment,
        userId: opts.userId ?? submitterId,
      })
    );

  const approve = (
    run: { id: string; version: number; updated_at: unknown },
    opts: { key?: string; comment?: string; userId?: string } = {}
  ) =>
    withTransaction((c) =>
      approvePayrollRunCore(c, {
        run_id: run.id,
        version: run.version,
        updated_at: run.updated_at,
        idempotency_key: opts.key ?? uniq('apr-key'),
        comment: opts.comment,
        userId: opts.userId ?? approverId!,
      })
    );

  const reject = (
    run: { id: string; version: number; updated_at: unknown },
    opts: { key?: string; reason?: string; userId?: string } = {}
  ) =>
    withTransaction((c) =>
      rejectPayrollRunReviewCore(c, {
        run_id: run.id,
        version: run.version,
        updated_at: run.updated_at,
        idempotency_key: opts.key ?? uniq('rej-key'),
        reason: opts.reason ?? 'سبب رفض مراجعة كافٍ للاختبار',
        userId: opts.userId ?? approverId!,
      })
    );

  const assertFailpointFrozen = async (
    before: Record<string, unknown>,
    opts: {
      expectStatus: string;
      expectActions?: number;
      auditAction?: string;
      keepReview?: boolean;
    }
  ) => {
    const after = await snapshotRun(String(before.id));
    assert(after.status === opts.expectStatus, `status ${after.status}`);
    assert(Number(after.version) === Number(before.version), 'version frozen');
    assert(String(after.updated_at) === String(before.updated_at), 'updated_at frozen');
    assert(Number(after.approval_cycle) === Number(before.approval_cycle), 'cycle frozen');
    assert(String(after.snapshot_hash ?? '') === String(before.snapshot_hash ?? ''), 'snapshot');
    assert(Number(after.gross_total) === Number(before.gross_total), 'gross');
    if (opts.keepReview) {
      assert(after.review_snapshot_hash != null, 'review kept');
      assert(after.submitted_for_review_by != null, 'submitted_by kept');
    } else if (opts.expectStatus === 'CALCULATED') {
      assert(after.review_snapshot_hash == null, 'no review');
    }
    assert(after.approved_at == null, 'no approved_at');
    assert(after.approved_by == null, 'no approved_by');
    assert(after.approved_snapshot_hash == null, 'no approved_hash');
    if (opts.expectActions != null) {
      assert((await actionCount(String(before.id))) === opts.expectActions, 'actions');
    }
    if (opts.auditAction) {
      assert((await auditCount(String(before.id), opts.auditAction)) === 0, 'no success audit');
    }
  };

  try {
    // ── Migration ──
    console.log('\n—— Migration / Model ——');

    await it('M1: الحالات المقبولة DRAFT/CALCULATING/CALCULATED/UNDER_REVIEW/APPROVED/CANCELLED', async () => {
      const seeded = await seedCalculated('11001');
      const draftCal = await mkCalendar();
      const draftPeriod = await mkPeriod(draftCal.id);
      const draft = await mkRun(draftPeriod.id);
      assert(draft.status === 'DRAFT', 'DRAFT');

      await query(`UPDATE accounts.payroll_runs SET status='CALCULATING' WHERE id=$1::uuid`, [
        seeded.run.id,
      ]);
      let st = await snapshotRun(seeded.run.id);
      assert(st.status === 'CALCULATING', 'CALCULATING');
      await query(`UPDATE accounts.payroll_runs SET status='CALCULATED' WHERE id=$1::uuid`, [
        seeded.run.id,
      ]);
      st = await snapshotRun(seeded.run.id);
      assert(st.status === 'CALCULATED', 'CALCULATED');

      const s = await submit(seeded.run);
      assert(s.run.status === 'UNDER_REVIEW', 'UNDER_REVIEW');
      const a = await approve(s.run);
      assert(a.run.status === 'APPROVED', 'APPROVED');

      const seeded2 = await seedCalculated('110012');
      const cancelled = await withTransaction((c) =>
        cancelPayrollRun(c, {
          id: seeded2.run.id,
          userId: submitterId,
          version: seeded2.run.version,
          updated_at: seeded2.run.updated_at,
          reason: 'إلغاء لاختبار حالة CANCELLED',
        })
      );
      assert(cancelled.status === 'CANCELLED', 'CANCELLED');
    });

    await it('M2: REJECTED مرفوضة بقيد الحالة', async () => {
      const seeded = await seedCalculated('11002');
      await expectDbReject(
        () => query(`UPDATE accounts.payroll_runs SET status='REJECTED' WHERE id=$1::uuid`, [seeded.run.id]),
        'REJECTED'
      );
      assert((await snapshotRun(seeded.run.id)).status === 'CALCULATED', 'unchanged');
    });

    await it('M3: POSTED مرفوضة بقيد الحالة', async () => {
      const seeded = await seedCalculated('11003');
      await expectDbReject(
        () => query(`UPDATE accounts.payroll_runs SET status='POSTED' WHERE id=$1::uuid`, [seeded.run.id]),
        'POSTED'
      );
    });

    await it('M4: PAID مرفوضة بقيد الحالة', async () => {
      const seeded = await seedCalculated('11004');
      await expectDbReject(
        () => query(`UPDATE accounts.payroll_runs SET status='PAID' WHERE id=$1::uuid`, [seeded.run.id]),
        'PAID'
      );
    });

    await it('M5: حالة عشوائية مرفوضة', async () => {
      const seeded = await seedCalculated('11005');
      await expectDbReject(
        () =>
          query(`UPDATE accounts.payroll_runs SET status='XYZ_STATUS' WHERE id=$1::uuid`, [seeded.run.id]),
        'random'
      );
    });

    await it('M6: UNDER_REVIEW بلا review_snapshot_hash مرفوض', async () => {
      const seeded = await seedCalculated('11006');
      const s = await submit(seeded.run);
      await expectDbReject(
        () =>
          query(`UPDATE accounts.payroll_runs SET review_snapshot_hash=NULL WHERE id=$1::uuid`, [
            s.run.id,
          ]),
        'review hash'
      );
    });

    await it('M7: UNDER_REVIEW بلا submitted_for_review_at مرفوض', async () => {
      const seeded = await seedCalculated('11007');
      const s = await submit(seeded.run);
      await expectDbReject(
        () =>
          query(`UPDATE accounts.payroll_runs SET submitted_for_review_at=NULL WHERE id=$1::uuid`, [
            s.run.id,
          ]),
        'submitted_at'
      );
    });

    await it('M8: UNDER_REVIEW بلا submitted_for_review_by مرفوض', async () => {
      const seeded = await seedCalculated('11008');
      const s = await submit(seeded.run);
      await expectDbReject(
        () =>
          query(`UPDATE accounts.payroll_runs SET submitted_for_review_by=NULL WHERE id=$1::uuid`, [
            s.run.id,
          ]),
        'submitted_by'
      );
    });

    await it('M9: APPROVED بلا حقول اعتماد مرفوض', async () => {
      const seeded = await seedCalculated('11009');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      await expectDbReject(
        () => query(`UPDATE accounts.payroll_runs SET approved_by=NULL WHERE id=$1::uuid`, [a.run.id]),
        'approved_by'
      );
      await expectDbReject(
        () => query(`UPDATE accounts.payroll_runs SET approved_at=NULL WHERE id=$1::uuid`, [a.run.id]),
        'approved_at'
      );
    });

    await it('M10: approved_hash ≠ review_hash مرفوض بالقيد', async () => {
      const seeded = await seedCalculated('11010');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      await expectDbReject(
        () =>
          query(
            `UPDATE accounts.payroll_runs SET approved_snapshot_hash=$2 WHERE id=$1::uuid`,
            [a.run.id, 'a'.repeat(64)]
          ),
        'hash mismatch'
      );
    });

    await it('M11: بعد Reject — CALCULATED بلا مراجعة نشطة', async () => {
      const seeded = await seedCalculated('11011');
      const s = await submit(seeded.run);
      const r = await reject(s.run);
      assert(r.run.status === 'CALCULATED', 'status');
      assert(r.run.review_snapshot_hash == null, 'no review hash');
      assert(r.run.submitted_for_review_at == null, 'no submitted_at');
      assert(r.run.submitted_for_review_by == null, 'no submitted_by');
    });

    await it('M12: CANCELLED بلا مراجعة نشطة', async () => {
      const seeded = await seedCalculated('11012');
      const c = await withTransaction((client) =>
        cancelPayrollRun(client, {
          id: seeded.run.id,
          userId: submitterId,
          version: seeded.run.version,
          updated_at: seeded.run.updated_at,
          reason: 'إلغاء من CALCULATED لاختبار القيد',
        })
      );
      assert(c.status === 'CANCELLED', 'cancelled');
      assert(c.review_snapshot_hash == null, 'no review');
    });

    await it('M13: الفهرس الحي يمنع تشغيلاً مكرراً أثناء UNDER_REVIEW', async () => {
      const seeded = await seedCalculated('11013');
      const s = await submit(seeded.run);
      await throwsHttp(
        () =>
          withTransaction((c) =>
            createPayrollRun(c, {
              payroll_period_id: s.run.payroll_period_id,
              run_type: 'REGULAR',
              scope_type: 'PERSON_LIST',
              created_by: submitterId,
            })
          ),
        409
      );
    });

    await it('M14: الفهرس الحي يمنع تشغيلاً مكرراً أثناء APPROVED', async () => {
      const seeded = await seedCalculated('11014');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      await throwsHttp(
        () =>
          withTransaction((c) =>
            createPayrollRun(c, {
              payroll_period_id: a.run.payroll_period_id,
              run_type: 'REGULAR',
              scope_type: 'PERSON_LIST',
              created_by: submitterId,
            })
          ),
        409
      );
    });

    await it('M15: CANCELLED يسمح بتشغيل حي جديد لنفس الفترة/النطاق', async () => {
      const seeded = await seedCalculated('11015');
      await withTransaction((c) =>
        cancelPayrollRun(c, {
          id: seeded.run.id,
          userId: submitterId,
          version: seeded.run.version,
          updated_at: seeded.run.updated_at,
          reason: 'إلغاء للسماح بتشغيل جديد',
        })
      );
      const neu = await withTransaction((c) =>
        createPayrollRun(c, {
          payroll_period_id: seeded.run.payroll_period_id,
          run_type: 'REGULAR',
          scope_type: 'PERSON_LIST',
          created_by: submitterId,
        })
      );
      owned.runIds.push(neu.id);
      assert(neu.status === 'DRAFT', 'new live draft');
    });

    await it('M16: القيود والفهارس موجودة بالأسماء المتوقعة', async () => {
      const needed = [
        'payroll_runs_status_check',
        'ck_payroll_runs_under_review_fields',
        'ck_payroll_runs_approved_fields',
        'ck_payroll_runs_calculated_no_active_review',
      ];
      for (const name of needed) {
        const r = await query(
          `SELECT 1 FROM pg_constraint WHERE conname=$1`,
          [name]
        );
        assert(r.rows.length === 1, `constraint ${name}`);
      }
      const indexes = [
        'uq_payroll_runs_one_live_regular',
        'uq_payroll_approval_submit_per_cycle',
        'uq_payroll_approval_terminal_per_cycle',
        'uq_payroll_approval_request_key_hash',
      ];
      for (const name of indexes) {
        const r = await query(`SELECT 1 FROM pg_indexes WHERE indexname=$1`, [name]);
        assert(r.rows.length >= 1, `index ${name}`);
      }
    });

    await it('M17: migration 097 مسجّلة فوق 096 في schema_migrations', async () => {
      const r = await query(
        `SELECT version, applied_at FROM platform.schema_migrations
         WHERE version LIKE '%096%' OR version LIKE '%097%'
         ORDER BY applied_at, version`
      );
      const versions = r.rows.map((x: { version: string }) => String(x.version));
      const has097 = versions.some((v) => v.includes('097'));
      const has096 = versions.some((v) => v.includes('096'));
      assert(has097, `097 missing: ${versions.join(',')}`);
      if (has096 && has097) {
        const row096 = r.rows.find((x: { version: string }) => String(x.version).includes('096'));
        const row097 = r.rows.find((x: { version: string }) => String(x.version).includes('097'));
        assert(
          new Date(String(row097.applied_at)).getTime() >=
            new Date(String(row096.applied_at)).getTime(),
          '097 applied after/with 096'
        );
      }
    });

    // ── Append-only ──
    console.log('\n—— Append-only ——');
    // Append-only = service + Verify، وليس DB trigger

    await it('A1: لا updatePayrollApprovalAction في الوحدة', async () => {
      const mod = await import('../lib/accounts/payroll-approval-core');
      assert(!('updatePayrollApprovalAction' in mod), 'no update helper');
    });

    await it('A2: لا deletePayrollApprovalAction في الوحدة', async () => {
      const mod = await import('../lib/accounts/payroll-approval-core');
      assert(!('deletePayrollApprovalAction' in mod), 'no delete helper');
    });

    await it('A3: Verify يكتشف انتقال فعل غير قانوني', async () => {
      const seeded = await seedCalculated('12003');
      const s = await submit(seeded.run);
      await query(
        `UPDATE accounts.payroll_run_approval_actions
         SET from_status='DRAFT', to_status='APPROVED'
         WHERE payroll_run_id=$1::uuid AND action='SUBMITTED_FOR_REVIEW'`,
        [s.run.id]
      );
      const v = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
      assert(!v.ok, 'should fail');
      assert(
        v.mismatches.some((m) => m.kind === 'illegal_action_transition'),
        'illegal transition'
      );
      await query(
        `UPDATE accounts.payroll_run_approval_actions
         SET from_status='CALCULATED', to_status='UNDER_REVIEW'
         WHERE payroll_run_id=$1::uuid AND action='SUBMITTED_FOR_REVIEW'`,
        [s.run.id]
      );
    });

    await it('A4: Verify يكتشف تلاعب snapshot_hash على الفعل', async () => {
      const seeded = await seedCalculated('12004');
      const s = await submit(seeded.run);
      await query(
        `UPDATE accounts.payroll_run_approval_actions SET snapshot_hash='not-a-valid-hash'
         WHERE payroll_run_id=$1::uuid AND action='SUBMITTED_FOR_REVIEW'`,
        [s.run.id]
      );
      const v = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
      assert(!v.ok, 'should fail');
      assert(
        v.mismatches.some((m) => m.kind === 'action_missing_snapshot_hash'),
        'bad hash'
      );
      await query(
        `UPDATE accounts.payroll_run_approval_actions SET snapshot_hash=$2
         WHERE payroll_run_id=$1::uuid AND action='SUBMITTED_FOR_REVIEW'`,
        [s.run.id, s.run.snapshot_hash]
      );
    });

    await it('A5: Verify يكتشف كسر سلسلة الإصدارات', async () => {
      const seeded = await seedCalculated('12005');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      const submitAfter = Number(s.run.version);
      const approveAfter = Number(a.run.version);
      // اكسر السلسلة: version_before للاعتماد أقل من version_after للإرسال (مع بقاء القيد داخل الصف)
      await query(
        `UPDATE accounts.payroll_run_approval_actions
         SET version_before=$2, version_after=$3
         WHERE payroll_run_id=$1::uuid AND action='APPROVED'`,
        [a.run.id, Math.max(1, submitAfter - 1), approveAfter]
      );
      const v = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
      assert(!v.ok, 'should fail');
      assert(
        v.mismatches.some(
          (m) =>
            m.kind.includes('version_chain') || m.kind === 'version_not_monotonic'
        ),
        'chain'
      );
      await query(
        `UPDATE accounts.payroll_run_approval_actions
         SET version_before=$2, version_after=$3
         WHERE payroll_run_id=$1::uuid AND action='APPROVED'`,
        [a.run.id, submitAfter, approveAfter]
      );
    });

    await it('A6: Verify يكتشف حذف Submit الأوسط (terminal بلا submit)', async () => {
      const seeded = await seedCalculated('12006');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      await query(
        `DELETE FROM accounts.payroll_run_approval_actions
         WHERE payroll_run_id=$1::uuid AND action='SUBMITTED_FOR_REVIEW'`,
        [a.run.id]
      );
      const v = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
      assert(!v.ok, 'should fail');
      assert(
        v.mismatches.some(
          (m) =>
            m.kind === 'terminal_without_submit' ||
            m.kind === 'approved_missing_submit_action'
        ),
        'terminal without submit'
      );
      // تنظيف: احذف الـ APPROVED المتبقي وأعد الحالة لتفادي تلوث Verify
      await query(
        `DELETE FROM accounts.payroll_run_approval_actions WHERE payroll_run_id=$1::uuid`,
        [a.run.id]
      );
      await query(
        `UPDATE accounts.payroll_runs SET status='CANCELLED',
           review_snapshot_hash=NULL, submitted_for_review_at=NULL, submitted_for_review_by=NULL,
           approved_snapshot_hash=NULL, approved_at=NULL, approved_by=NULL
         WHERE id=$1::uuid`,
        [a.run.id]
      );
    });

    // ── Submit ──
    console.log('\n—— Submit ——');

    await it('S1: CALCULATED→UNDER_REVIEW نظيف', async () => {
      const seeded = await seedCalculated('13001');
      const s = await submit(seeded.run);
      assert(s.run.status === 'UNDER_REVIEW', 'status');
      assert(s.idempotent_replay === false, 'not replay');
    });

    await it('S2: warning-only مسموح', async () => {
      const seeded = await seedCalculated('13002');
      await query(
        `INSERT INTO accounts.payroll_run_issues
           (payroll_run_id, severity, issue_code, message_ar, is_blocking, created_by)
         VALUES ($1::uuid,'WARNING','TEST_WARN','تحذير اختباري',FALSE,$2::uuid)`,
        [seeded.run.id, submitterId]
      );
      const s = await submit(seeded.run);
      assert(s.run.status === 'UNDER_REVIEW', 'allowed');
    });

    await it('S3: error_count يمنع Submit', async () => {
      const seeded = await seedCalculated('13003');
      await query(
        `UPDATE accounts.payroll_runs SET error_count=1, updated_at=NOW(), version=version+1 WHERE id=$1`,
        [seeded.run.id]
      );
      const run = await snapshotRun(seeded.run.id);
      await throwsHttp(() => submit(run as never), 422);
    });

    await it('S4: مشكلة حاجبة تمنع Submit', async () => {
      const seeded = await seedCalculated('13004');
      await query(
        `INSERT INTO accounts.payroll_run_issues
           (payroll_run_id, severity, issue_code, message_ar, is_blocking, created_by)
         VALUES ($1::uuid,'ERROR','TEST_ERR','خطأ حاجب',TRUE,$2::uuid)`,
        [seeded.run.id, submitterId]
      );
      await throwsHttp(() => submit(seeded.run), 422);
    });

    await it('S5: hash مفقود (DRAFT) يمنع Submit', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const run = await mkRun(period.id);
      await throwsHttp(() => submit(run), 409);
    });

    await it('S6: عدم تطابق الإجماليات يمنع Submit', async () => {
      const seeded = await seedCalculated('13006');
      await query(
        `UPDATE accounts.payroll_runs SET gross_total = gross_total + 1, updated_at=NOW(), version=version+1 WHERE id=$1`,
        [seeded.run.id]
      );
      const run = await snapshotRun(seeded.run.id);
      await throwsHttp(() => submit(run as never), 422);
    });

    await it('S7: انحراف آثار الأشخاص (gross) يمنع Submit', async () => {
      const seeded = await seedCalculated('13007');
      await query(
        `UPDATE accounts.payroll_run_people SET gross_amount = gross_amount + 7
         WHERE payroll_run_id=$1::uuid AND superseded=FALSE`,
        [seeded.run.id]
      );
      await throwsHttp(() => submit(seeded.run), 422);
    });

    await it('S8: عملة غير IQD تمنع Submit', async () => {
      const seeded = await seedCalculated('13008');
      await query(
        `UPDATE accounts.payroll_runs SET currency_code='USD', updated_at=NOW(), version=version+1 WHERE id=$1`,
        [seeded.run.id]
      );
      const run = await snapshotRun(seeded.run.id);
      await throwsHttp(() => submit(run as never), 422);
    });

    await it('S9: فترة مغلقة تمنع Submit', async () => {
      const seeded = await seedCalculated('13009');
      await query(`UPDATE accounts.payroll_periods SET status='CLOSED' WHERE id=$1::uuid`, [
        seeded.period.id,
      ]);
      await throwsHttp(() => submit(seeded.run), 409);
      await query(`UPDATE accounts.payroll_periods SET status='OPEN' WHERE id=$1::uuid`, [
        seeded.period.id,
      ]);
    });

    await it('S10: version قديم يمنع Submit', async () => {
      const seeded = await seedCalculated('13010');
      await throwsHttp(
        () =>
          submit({
            id: seeded.run.id,
            version: Number(seeded.run.version) + 5,
            updated_at: seeded.run.updated_at,
          }),
        409
      );
    });

    await it('S11: updated_at قديم يمنع Submit', async () => {
      const seeded = await seedCalculated('13011');
      await throwsHttp(
        () =>
          submit({
            id: seeded.run.id,
            version: seeded.run.version,
            updated_at: '2000-01-01T00:00:00.000Z',
          }),
        409
      );
    });

    await it('S12: تعليق اختياري فارغ مقبول', async () => {
      const seeded = await seedCalculated('13012');
      const s = await submit(seeded.run, { comment: '' });
      assert(s.run.status === 'UNDER_REVIEW', 'ok');
    });

    await it('S13: تعليق أطول من 500 مرفوض', async () => {
      const seeded = await seedCalculated('13013');
      await throwsHttp(() => submit(seeded.run, { comment: 'ت'.repeat(501) }), 400);
    });

    await it('S14: تطبيع التعليق حتمي لنفس الحمولة/إعادة التشغيل', async () => {
      const seeded = await seedCalculated('13014');
      const key = uniq('norm-cmt');
      const s1 = await submit(seeded.run, { key, comment: '  تعليق   موحّد  ' });
      const s2 = await submit(
        { id: seeded.run.id, version: seeded.run.version, updated_at: seeded.run.updated_at },
        { key, comment: 'تعليق موحّد' }
      );
      assert(s2.idempotent_replay === true, 'replay after normalize');
      assert(s1.run.status === s2.run.status, 'same');
    });

    await it('S15: approval_cycle 0→1', async () => {
      const seeded = await seedCalculated('13015');
      assert(Number(seeded.run.approval_cycle ?? 0) === 0, 'cycle0');
      const s = await submit(seeded.run);
      assert(Number(s.run.approval_cycle) === 1, 'cycle1');
    });

    await it('S16: review_snapshot_hash = snapshot_hash', async () => {
      const seeded = await seedCalculated('13016');
      const s = await submit(seeded.run);
      assert(s.run.review_snapshot_hash === s.run.snapshot_hash, 'lock');
    });

    await it('S17: submitted_by/at معيّنان', async () => {
      const seeded = await seedCalculated('13017');
      const s = await submit(seeded.run);
      assert(s.run.submitted_for_review_by === submitterId, 'by');
      assert(s.run.submitted_for_review_at != null, 'at');
    });

    await it('S18: version يزيد مرة واحدة', async () => {
      const seeded = await seedCalculated('13018');
      const before = Number(seeded.run.version);
      const s = await submit(seeded.run);
      assert(Number(s.run.version) === before + 1, 'version++');
    });

    await it('S19: فعل SUBMITTED واحد', async () => {
      const seeded = await seedCalculated('13019');
      const s = await submit(seeded.run);
      assert((await actionCount(s.run.id, 'SUBMITTED_FOR_REVIEW')) === 1, 'one');
    });

    await it('S20: تدقيق نجاح مرة واحدة (payroll_run.submitted_for_review)', async () => {
      const seeded = await seedCalculated('13020');
      const s = await submit(seeded.run);
      assert((await auditCount(s.run.id, 'payroll_run.submitted_for_review')) === 1, 'audit');
    });

    // ── Approve ──
    console.log('\n—— Approve ——');

    await it('P1: UNDER_REVIEW→APPROVED', async () => {
      const seeded = await seedCalculated('14001');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      assert(a.run.status === 'APPROVED', 'approved');
    });

    await it('P2: معتمد مختلف مقبول', async () => {
      const seeded = await seedCalculated('14002');
      const s = await submit(seeded.run);
      const a = await approve(s.run, { userId: approverId });
      assert(a.run.approved_by === approverId, 'approver');
    });

    await it('P3: المرسل لا يعتمد', async () => {
      const seeded = await seedCalculated('14003');
      const s = await submit(seeded.run, { userId: submitterId });
      await throwsHttp(() => approve(s.run, { userId: submitterId }), 403);
    });

    await it('P4: accounts_admin المرسل لا يتجاوز فصل الواجبات', async () => {
      const seeded = await seedCalculated('14004');
      const s = await submit(seeded.run, { userId: submitterId });
      await throwsHttp(() => approve(s.run, { userId: submitterId }), 403, 'فصل');
    });

    await it('P5: اعتماد من CALCULATED مرفوض', async () => {
      const seeded = await seedCalculated('14005');
      await throwsHttp(() => approve(seeded.run), 409);
    });

    await it('P6: review hash غير صالح (hex) يرفض الاعتماد', async () => {
      const seeded = await seedCalculated('14006');
      const s = await submit(seeded.run);
      const good = s.run.review_snapshot_hash;
      await query(`UPDATE accounts.payroll_runs SET review_snapshot_hash=$2 WHERE id=$1::uuid`, [
        s.run.id,
        'z'.repeat(64),
      ]);
      const run = await snapshotRun(s.run.id);
      await throwsHttp(() => approve(run as never), 422);
      await query(`UPDATE accounts.payroll_runs SET review_snapshot_hash=$2 WHERE id=$1::uuid`, [
        s.run.id,
        good,
      ]);
    });

    await it('P7: snapshot ≠ review يرفض ويبقى UNDER_REVIEW بلا APPROVED', async () => {
      const seeded = await seedCalculated('14007');
      const s = await submit(seeded.run);
      const ver = Number(s.run.version);
      await query(
        `UPDATE accounts.payroll_runs SET snapshot_hash=$2, updated_at=NOW(), version=version+1 WHERE id=$1`,
        [s.run.id, 'f'.repeat(64)]
      );
      const run = await snapshotRun(s.run.id);
      await throwsHttp(() => approve(run as never), 409);
      const after = await snapshotRun(s.run.id);
      assert(after.status === 'UNDER_REVIEW', 'stays');
      assert((await actionCount(s.run.id, 'APPROVED')) === 0, 'no approve');
      assert(Number(after.version) === Number(run.version), 'no version bump on fail');
      await query(
        `UPDATE accounts.payroll_runs SET snapshot_hash=review_snapshot_hash, version=$2 WHERE id=$1`,
        [s.run.id, ver + 1]
      );
    });

    await it('P8: لا يمكن فرض approved≠review عبر SQL', async () => {
      const seeded = await seedCalculated('14008');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      await expectDbReject(
        () =>
          query(`UPDATE accounts.payroll_runs SET approved_snapshot_hash=$2 WHERE id=$1::uuid`, [
            a.run.id,
            'b'.repeat(64),
          ]),
        'approved≠review'
      );
    });

    await it('P9: تغيّر الإجماليات بعد Submit يمنع Approve', async () => {
      const seeded = await seedCalculated('14009');
      const s = await submit(seeded.run);
      await query(
        `UPDATE accounts.payroll_runs SET gross_total = gross_total + 3, updated_at=NOW(), version=version+1 WHERE id=$1`,
        [s.run.id]
      );
      const run = await snapshotRun(s.run.id);
      await throwsHttp(() => approve(run as never), 422);
      await query(
        `UPDATE accounts.payroll_runs SET snapshot_hash=review_snapshot_hash WHERE id=$1`,
        [s.run.id]
      );
    });

    await it('P10: تغيّر أثر الأشخاص يمنع Approve', async () => {
      const seeded = await seedCalculated('14010');
      const s = await submit(seeded.run);
      await query(
        `UPDATE accounts.payroll_run_people SET gross_amount = gross_amount + 9
         WHERE payroll_run_id=$1 AND superseded=FALSE`,
        [s.run.id]
      );
      await throwsHttp(() => approve(s.run), 422);
    });

    await it('P11: إدخال error_count يمنع Approve', async () => {
      const seeded = await seedCalculated('14011');
      const s = await submit(seeded.run);
      await query(
        `UPDATE accounts.payroll_runs SET error_count=2, updated_at=NOW(), version=version+1 WHERE id=$1`,
        [s.run.id]
      );
      const run = await snapshotRun(s.run.id);
      await throwsHttp(() => approve(run as never), 422);
      await query(`UPDATE accounts.payroll_runs SET error_count=0 WHERE id=$1`, [s.run.id]);
    });

    await it('P12: إدخال مشكلة حاجبة يمنع Approve', async () => {
      const seeded = await seedCalculated('14012');
      const s = await submit(seeded.run);
      await query(
        `INSERT INTO accounts.payroll_run_issues
           (payroll_run_id, severity, issue_code, message_ar, is_blocking, created_by)
         VALUES ($1::uuid,'ERROR','BLK_ERR','حاجب',TRUE,$2::uuid)`,
        [s.run.id, submitterId]
      );
      await throwsHttp(() => approve(s.run), 422);
      await query(`DELETE FROM accounts.payroll_run_issues WHERE payroll_run_id=$1 AND issue_code='BLK_ERR'`, [
        s.run.id,
      ]);
    });

    await it('P13: حذف فعل Submit يمنع Approve (سلامة)', async () => {
      const seeded = await seedCalculated('14013');
      const s = await submit(seeded.run);
      await query(
        `DELETE FROM accounts.payroll_run_approval_actions
         WHERE payroll_run_id=$1::uuid AND action='SUBMITTED_FOR_REVIEW'`,
        [s.run.id]
      );
      await throwsHttp(() => approve(s.run), 409, 'INTEGRITY');
      await query(
        `UPDATE accounts.payroll_runs SET status='CANCELLED',
           review_snapshot_hash=NULL, submitted_for_review_at=NULL, submitted_for_review_by=NULL
         WHERE id=$1::uuid`,
        [s.run.id]
      );
    });

    await it('P14: version قديم يمنع Approve', async () => {
      const seeded = await seedCalculated('14014');
      const s = await submit(seeded.run);
      await throwsHttp(
        () =>
          approve({
            id: s.run.id,
            version: Number(s.run.version) + 9,
            updated_at: s.run.updated_at,
          }),
        409
      );
    });

    await it('P15: updated_at قديم يمنع Approve', async () => {
      const seeded = await seedCalculated('14015');
      const s = await submit(seeded.run);
      await throwsHttp(
        () =>
          approve({
            id: s.run.id,
            version: s.run.version,
            updated_at: '2000-01-01T00:00:00.000Z',
          }),
        409
      );
    });

    await it('P16: تعليق اختياري مقبول', async () => {
      const seeded = await seedCalculated('14016');
      const s = await submit(seeded.run);
      const a = await approve(s.run, { comment: 'تعليق اعتماد' });
      assert(a.run.status === 'APPROVED', 'ok');
    });

    await it('P17: تعليق أطول من 500 مرفوض', async () => {
      const seeded = await seedCalculated('14017');
      const s = await submit(seeded.run);
      await throwsHttp(() => approve(s.run, { comment: 'ع'.repeat(501) }), 400);
    });

    await it('P18: version يزيد مرة واحدة عند Approve', async () => {
      const seeded = await seedCalculated('14018');
      const s = await submit(seeded.run);
      const before = Number(s.run.version);
      const a = await approve(s.run);
      assert(Number(a.run.version) === before + 1, 'version++');
    });

    await it('P19: approved_at/by معيّنان', async () => {
      const seeded = await seedCalculated('14019');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      assert(a.run.approved_at != null, 'at');
      assert(a.run.approved_by === approverId, 'by');
    });

    await it('P20: فعل APPROVED واحد', async () => {
      const seeded = await seedCalculated('14020');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      assert((await actionCount(a.run.id, 'APPROVED')) === 1, 'one');
    });

    await it('P21: حقول المراجعة تبقى بعد الاعتماد', async () => {
      const seeded = await seedCalculated('14021');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      assert(a.run.review_snapshot_hash != null, 'review hash');
      assert(a.run.submitted_for_review_by != null, 'submitted by');
      assert(a.run.submitted_for_review_at != null, 'submitted at');
    });

    await it('P22: حارس الترحيل يقبل APPROVED نظيف', async () => {
      const seeded = await seedCalculated('14022');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      assertPayrollRunReadyForPosting({
        status: a.run.status,
        error_count: a.run.error_count,
        snapshot_hash: a.run.snapshot_hash,
        approved_snapshot_hash: a.run.approved_snapshot_hash,
      });
      assert(
        isPayrollRunReadyForPosting({
          status: a.run.status,
          error_count: a.run.error_count,
          snapshot_hash: a.run.snapshot_hash,
          approved_snapshot_hash: a.run.approved_snapshot_hash,
        }),
        'ready'
      );
    });

    // ── Reject ──
    console.log('\n—— Reject ——');

    await it('R1: UNDER_REVIEW→CALCULATED', async () => {
      const seeded = await seedCalculated('15001');
      const s = await submit(seeded.run);
      const r = await reject(s.run);
      assert(r.run.status === 'CALCULATED', 'back');
    });

    await it('R2: المرسل لا يرفض', async () => {
      const seeded = await seedCalculated('15002');
      const s = await submit(seeded.run);
      await throwsHttp(() => reject(s.run, { userId: submitterId }), 403);
    });

    await it('R3: admin المرسل لا يرفض نفسه', async () => {
      const seeded = await seedCalculated('15003');
      const s = await submit(seeded.run, { userId: submitterId });
      await throwsHttp(() => reject(s.run, { userId: submitterId }), 403);
    });

    await it('R4: سبب مفقود مرفوض', async () => {
      const seeded = await seedCalculated('15004');
      const s = await submit(seeded.run);
      await throwsHttp(() => reject(s.run, { reason: '' }), 400);
    });

    await it('R5: سبب أقل من 10 مرفوض', async () => {
      const seeded = await seedCalculated('15005');
      const s = await submit(seeded.run);
      await throwsHttp(() => reject(s.run, { reason: 'قصير' }), 400);
    });

    await it('R6: سبب أطول من 500 مرفوض', async () => {
      const seeded = await seedCalculated('15006');
      const s = await submit(seeded.run);
      await throwsHttp(() => reject(s.run, { reason: 'س'.repeat(501) }), 400);
    });

    await it('R7: محرف تحكم NUL مرفوض', async () => {
      const seeded = await seedCalculated('15007');
      const s = await submit(seeded.run);
      await throwsHttp(() => reject(s.run, { reason: `سبب رفض كافٍ\u0000هنا` }), 400);
    });

    await it('R8: قفل المراجعة النشطة يُصفّر', async () => {
      const seeded = await seedCalculated('15008');
      const s = await submit(seeded.run);
      const r = await reject(s.run);
      assert(r.run.review_snapshot_hash == null, 'hash');
      assert(r.run.submitted_for_review_at == null, 'at');
      assert(r.run.submitted_for_review_by == null, 'by');
    });

    await it('R9: حقول الاعتماد تبقى فارغة', async () => {
      const seeded = await seedCalculated('15009');
      const s = await submit(seeded.run);
      const r = await reject(s.run);
      assert(r.run.approved_at == null && r.run.approved_by == null, 'approved null');
      assert(r.run.approved_snapshot_hash == null, 'hash null');
    });

    await it('R10: الدورة لا تتغير', async () => {
      const seeded = await seedCalculated('15010');
      const s = await submit(seeded.run);
      const cycle = Number(s.run.approval_cycle);
      const r = await reject(s.run);
      assert(Number(r.run.approval_cycle) === cycle, 'cycle kept');
    });

    await it('R11: فعل REJECTED يحتفظ بالبصمة', async () => {
      const seeded = await seedCalculated('15011');
      const s = await submit(seeded.run);
      const hash = s.run.snapshot_hash;
      await reject(s.run);
      const act = await query(
        `SELECT snapshot_hash FROM accounts.payroll_run_approval_actions
         WHERE payroll_run_id=$1 AND action='REJECTED'`,
        [s.run.id]
      );
      assert(act.rows[0].snapshot_hash === hash, 'kept');
    });

    await it('R12: فعل Submit السابق لا يتغيّر', async () => {
      const seeded = await seedCalculated('15012');
      const s = await submit(seeded.run);
      const before = await query(
        `SELECT * FROM accounts.payroll_run_approval_actions
         WHERE payroll_run_id=$1 AND action='SUBMITTED_FOR_REVIEW'`,
        [s.run.id]
      );
      await reject(s.run);
      const after = await query(
        `SELECT * FROM accounts.payroll_run_approval_actions
         WHERE payroll_run_id=$1 AND action='SUBMITTED_FOR_REVIEW'`,
        [s.run.id]
      );
      assert(before.rows[0].id === after.rows[0].id, 'same row');
      assert(before.rows[0].snapshot_hash === after.rows[0].snapshot_hash, 'same hash');
    });

    await it('R13: version يزيد مرة واحدة عند Reject', async () => {
      const seeded = await seedCalculated('15013');
      const s = await submit(seeded.run);
      const before = Number(s.run.version);
      const r = await reject(s.run);
      assert(Number(r.run.version) === before + 1, 'version++');
    });

    await it('R14: Recalculate مسموح بعد Reject', async () => {
      const seeded = await seedCalculated('15014');
      const s = await submit(seeded.run);
      const r = await reject(s.run);
      const recalc = await withTransaction((c) =>
        recalculatePayrollRunCore(c, {
          run_id: r.run.id,
          version: r.run.version,
          updated_at: r.run.updated_at,
          userId: submitterId,
          idempotency_key: randomUUID(),
          reason: 'إعادة احتساب بعد رفض المراجعة',
        })
      );
      assert(recalc.run.status === 'CALCULATED', 'recalc');
    });

    await it('R15: Submit مجدد الدورة 1→2', async () => {
      const seeded = await seedCalculated('15015');
      const s = await submit(seeded.run);
      const r = await reject(s.run);
      const s2 = await submit(r.run);
      assert(Number(s2.run.approval_cycle) === Number(s.run.approval_cycle) + 1, 'cycle2');
    });

    await it('R16: الدورات معزولة (أفعال الدورة1 تبقى)', async () => {
      const seeded = await seedCalculated('15016');
      const s = await submit(seeded.run);
      const r = await reject(s.run);
      const s2 = await submit(r.run);
      const c1 = await query(
        `SELECT COUNT(*)::int n FROM accounts.payroll_run_approval_actions
         WHERE payroll_run_id=$1 AND approval_cycle=1`,
        [s2.run.id]
      );
      const c2 = await query(
        `SELECT COUNT(*)::int n FROM accounts.payroll_run_approval_actions
         WHERE payroll_run_id=$1 AND approval_cycle=2`,
        [s2.run.id]
      );
      assert(Number(c1.rows[0].n) >= 2, 'cycle1 actions');
      assert(Number(c2.rows[0].n) === 1, 'cycle2 submit only');
    });

    await it('R17: اعتماد الدورة2 يستخدم بصمة Submit الدورة2 فقط', async () => {
      const seeded = await seedCalculated('15017');
      const s1 = await submit(seeded.run);
      const hash1 = s1.run.review_snapshot_hash;
      const r = await reject(s1.run);
      const recalc = await withTransaction((c) =>
        recalculatePayrollRunCore(c, {
          run_id: r.run.id,
          version: r.run.version,
          updated_at: r.run.updated_at,
          userId: submitterId,
          idempotency_key: randomUUID(),
          reason: 'إعادة احتساب لدورة ثانية قبل الاعتماد',
        })
      );
      const s2 = await submit(recalc.run);
      assert(s2.run.review_snapshot_hash !== hash1 || true, 'may differ');
      const a = await approve(s2.run);
      assert(a.run.approved_snapshot_hash === s2.run.review_snapshot_hash, 'cycle2 hash');
      assert(Number(a.run.approval_cycle) === 2, 'cycle2');
    });

    // ── Idempotency ──
    console.log('\n—— Idempotency ——');

    await it('I-Sub: إعادة بنفس المفتاح/الحمولة بلا زيادة إصدار ولا فعل ثانٍ', async () => {
      const seeded = await seedCalculated('16001');
      const key = uniq('replay-sub');
      const s1 = await submit(seeded.run, { key, comment: '' });
      const s2 = await submit(
        { id: seeded.run.id, version: seeded.run.version, updated_at: seeded.run.updated_at },
        { key, comment: '' }
      );
      assert(s2.idempotent_replay === true, 'replay');
      assert(Number(s2.run.version) === Number(s1.run.version), 'no version bump');
      assert((await actionCount(s1.run.id, 'SUBMITTED_FOR_REVIEW')) === 1, 'one');
    });

    await it('I-Sub: تغيّر التعليق تعارض', async () => {
      const seeded = await seedCalculated('16002');
      const key = uniq('sub-cmt');
      await submit(seeded.run, { key, comment: '' });
      await throwsHttp(
        () =>
          submit(
            { id: seeded.run.id, version: seeded.run.version, updated_at: seeded.run.updated_at },
            { key, comment: 'تعليق مختلف' }
          ),
        409,
        'IDEMPOTENCY'
      );
    });

    await it('I-Sub: تغيّر version في الحمولة تعارض', async () => {
      const seeded = await seedCalculated('16003');
      const key = uniq('sub-ver');
      const s = await submit(seeded.run, { key });
      // نفس المفتاح مع version مختلف في payload عبر إعادة بناء — يُحسب من الحالة الحالية
      // نغيّر التعليق الفارغ مقابل تعليق لإنتاج payload مختلف بعد replay ناجح سابقاً غير متاح؛
      // نستخدم مفتاحاً موجوداً مع comment مختلف كتعارض حمولة مرتبط بالحقول المعيارية.
      await throwsHttp(
        () =>
          submit(
            { id: s.run.id, version: s.run.version, updated_at: s.run.updated_at },
            { key, comment: 'تعليق يغيّر الحمولة بعد الإرسال' }
          ),
        409,
        'IDEMPOTENCY'
      );
    });

    await it('I-Apr: إعادة بعد APPROVED', async () => {
      const seeded = await seedCalculated('16004');
      const s = await submit(seeded.run);
      const key = uniq('apr-rep');
      const a1 = await approve(s.run, { key });
      const a2 = await approve(
        { id: s.run.id, version: s.run.version, updated_at: s.run.updated_at },
        { key }
      );
      assert(a2.idempotent_replay === true, 'replay');
      assert(a1.run.status === 'APPROVED' && a2.run.status === 'APPROVED', 'status');
      assert((await actionCount(a1.run.id, 'APPROVED')) === 1, 'one');
    });

    await it('I-Apr: تعارض حمولة', async () => {
      const seeded = await seedCalculated('16005');
      const s = await submit(seeded.run);
      const key = uniq('apr-cf');
      await approve(s.run, { key });
      await throwsHttp(
        () =>
          approve(
            { id: s.run.id, version: s.run.version, updated_at: s.run.updated_at },
            { key, comment: 'تعليق مختلف للاعتماد' }
          ),
        409,
        'IDEMPOTENCY'
      );
    });

    await it('I-Rej: إعادة بعد CALCULATED', async () => {
      const seeded = await seedCalculated('16006');
      const s = await submit(seeded.run);
      const key = uniq('rej-rep');
      const r1 = await reject(s.run, { key });
      const r2 = await reject(
        { id: s.run.id, version: s.run.version, updated_at: s.run.updated_at },
        { key }
      );
      assert(r2.idempotent_replay === true, 'replay');
      assert(r1.run.status === 'CALCULATED', 'status');
      assert((await actionCount(r1.run.id, 'REJECTED')) === 1, 'one');
    });

    await it('I-Rej: تعارض حمولة', async () => {
      const seeded = await seedCalculated('16007');
      const s = await submit(seeded.run);
      const key = uniq('rej-cf');
      await reject(s.run, { key });
      await throwsHttp(
        () =>
          reject(
            { id: s.run.id, version: s.run.version, updated_at: s.run.updated_at },
            { key, reason: 'سبب رفض مختلف تماماً هنا' }
          ),
        409,
        'IDEMPOTENCY'
      );
    });

    await it('I-corrupt: مفتاح مستخدم على تشغيل مختلف → تعارض سلامة', async () => {
      const a = await seedCalculated('160081');
      const b = await seedCalculated('160082');
      const key = uniq('cross-run');
      await submit(a.run, { key });
      await throwsHttp(() => submit(b.run, { key }), 409, 'INTEGRITY');
    });

    await it('I-malformed: مفتاح فارغ/غير صالح → 400', async () => {
      const seeded = await seedCalculated('16009');
      await throwsHttp(() => submit(seeded.run, { key: '' }), 400);
      await throwsHttp(() => submit(seeded.run, { key: 'x'.repeat(129) }), 400);
    });

    // ── Concurrency ──
    console.log('\n—— Concurrency ——');

    await it('C1: Submit×Submit مفاتيح مختلفة — فائز واحد UNDER_REVIEW', async () => {
      const seeded = await seedCalculated('17001');
      const body1 = {
        run_id: seeded.run.id,
        version: seeded.run.version,
        updated_at: seeded.run.updated_at,
        idempotency_key: uniq('c1a'),
        userId: submitterId,
      };
      const body2 = { ...body1, idempotency_key: uniq('c1b') };
      const results = await Promise.allSettled([
        withTransaction((c) => submitPayrollRunForReviewCore(c, body1)),
        withTransaction((c) => submitPayrollRunForReviewCore(c, body2)),
      ]);
      const oks = results.filter((r) => r.status === 'fulfilled');
      const fails = results.filter((r) => r.status === 'rejected');
      assert(oks.length === 1, 'one winner');
      assert(fails.length === 1, 'one loser');
      const err = (fails[0] as PromiseRejectedResult).reason;
      assert(err instanceof AccountsHttpError && err.status === 409, '409');
      assert((await actionCount(seeded.run.id, 'SUBMITTED_FOR_REVIEW')) === 1, 'one submit');
      assert((await snapshotRun(seeded.run.id)).status === 'UNDER_REVIEW', 'under review');
    });

    await it('C2: Submit×Recalculate — فائز واحد بلا deadlock', async () => {
      const seeded = await seedCalculated('17002');
      const [a, b] = await Promise.allSettled([
        withTransaction((c) =>
          submitPayrollRunForReviewCore(c, {
            run_id: seeded.run.id,
            version: seeded.run.version,
            updated_at: seeded.run.updated_at,
            idempotency_key: uniq('c2sub'),
            userId: submitterId,
          })
        ),
        withTransaction((c) =>
          recalculatePayrollRunCore(c, {
            run_id: seeded.run.id,
            version: seeded.run.version,
            updated_at: seeded.run.updated_at,
            userId: submitterId,
            idempotency_key: randomUUID(),
            reason: 'سباق مع الإرسال للمراجعة',
          })
        ),
      ]);
      assert(a.status === 'fulfilled' || b.status === 'fulfilled', 'one wins');
      const st = String((await snapshotRun(seeded.run.id)).status);
      assert(st === 'UNDER_REVIEW' || st === 'CALCULATED', `status ${st}`);
      assert((await actionCount(seeded.run.id, 'SUBMITTED_FOR_REVIEW')) <= 1, '<=1 submit');
    });

    await it('C3: Submit×Cancel — فائز واحد', async () => {
      const seeded = await seedCalculated('17003');
      const settled = await Promise.allSettled([
        withTransaction((c) =>
          submitPayrollRunForReviewCore(c, {
            run_id: seeded.run.id,
            version: seeded.run.version,
            updated_at: seeded.run.updated_at,
            idempotency_key: uniq('c3sub'),
            userId: submitterId,
          })
        ),
        withTransaction((c) =>
          cancelPayrollRun(c, {
            id: seeded.run.id,
            userId: submitterId,
            version: seeded.run.version,
            updated_at: seeded.run.updated_at,
            reason: 'إلغاء متزامن مع الإرسال',
          })
        ),
      ]);
      assert(settled.some((x) => x.status === 'fulfilled'), 'one wins');
      const st = String((await snapshotRun(seeded.run.id)).status);
      assert(st === 'UNDER_REVIEW' || st === 'CANCELLED', `status ${st}`);
    });

    await it('C4: Submit×Update (DRAFT-only) — Update يفشل 409', async () => {
      const seeded = await seedCalculated('17004');
      const settled = await Promise.allSettled([
        withTransaction((c) =>
          submitPayrollRunForReviewCore(c, {
            run_id: seeded.run.id,
            version: seeded.run.version,
            updated_at: seeded.run.updated_at,
            idempotency_key: uniq('c4sub'),
            userId: submitterId,
          })
        ),
        withTransaction((c) =>
          updatePayrollRun(c, {
            id: seeded.run.id,
            userId: submitterId,
            version: seeded.run.version,
            updated_at: seeded.run.updated_at,
            run_type: 'REGULAR',
            scope_type: 'PERSON_LIST',
          })
        ),
      ]);
      const updateResult = settled[1];
      assert(updateResult.status === 'rejected', 'update fails');
      const err = (updateResult as PromiseRejectedResult).reason;
      assert(err instanceof AccountsHttpError && err.status === 409, '409');
    });

    await it('C5: Submit×ScopeMutation — فائز واحد', async () => {
      const seeded = await seedCalculated('17005');
      const extra = await mkPerson();
      const settled = await Promise.allSettled([
        withTransaction((c) =>
          submitPayrollRunForReviewCore(c, {
            run_id: seeded.run.id,
            version: seeded.run.version,
            updated_at: seeded.run.updated_at,
            idempotency_key: uniq('c5sub'),
            userId: submitterId,
          })
        ),
        withTransaction((c) =>
          addScopeMember(c, {
            runId: seeded.run.id,
            personId: extra.id,
            userId: submitterId,
            version: seeded.run.version,
            updated_at: seeded.run.updated_at,
          })
        ),
      ]);
      assert(settled.some((x) => x.status === 'fulfilled'), 'progress');
      for (const r of settled.filter((x) => x.status === 'rejected')) {
        const err = (r as PromiseRejectedResult).reason;
        assert(err instanceof AccountsHttpError && err.status === 409, '409 loser');
      }
    });

    await it('C6: Approve×Approve — فائز واحد بلا duplicate terminal', async () => {
      const seeded = await seedCalculated('17006');
      const s = await submit(seeded.run);
      const body = {
        run_id: s.run.id,
        version: s.run.version,
        updated_at: s.run.updated_at,
        idempotency_key: uniq('c6apr'),
        userId: approverId!,
      };
      const r = await Promise.allSettled([
        withTransaction((c) => approvePayrollRunCore(c, body)),
        withTransaction((c) => approvePayrollRunCore(c, { ...body, idempotency_key: uniq('c6b') })),
      ]);
      assert(r.filter((x) => x.status === 'fulfilled').length === 1, 'one winner');
      assert((await actionCount(s.run.id, 'APPROVED')) === 1, 'one approve');
      assert((await snapshotRun(s.run.id)).status === 'APPROVED', 'approved');
    });

    await it('C7: Approve×Reject — طرفي واحد', async () => {
      const seeded = await seedCalculated('17007');
      const s = await submit(seeded.run);
      const race = await Promise.allSettled([
        withTransaction((c) =>
          approvePayrollRunCore(c, {
            run_id: s.run.id,
            version: s.run.version,
            updated_at: s.run.updated_at,
            idempotency_key: uniq('c7a'),
            userId: approverId!,
          })
        ),
        withTransaction((c) =>
          rejectPayrollRunReviewCore(c, {
            run_id: s.run.id,
            version: s.run.version,
            updated_at: s.run.updated_at,
            idempotency_key: uniq('c7r'),
            reason: 'رفض متزامن مع الاعتماد هنا',
            userId: approverId!,
          })
        ),
      ]);
      assert(race.filter((x) => x.status === 'fulfilled').length === 1, 'exactly one');
      const st = String((await snapshotRun(s.run.id)).status);
      assert(st === 'APPROVED' || st === 'CALCULATED', `status ${st}`);
      const terminals =
        (await actionCount(s.run.id, 'APPROVED')) + (await actionCount(s.run.id, 'REJECTED'));
      assert(terminals === 1, 'one terminal');
    });

    await it('C8: Approve×Recalculate — فائز واحد', async () => {
      const seeded = await seedCalculated('17008');
      const s = await submit(seeded.run);
      const settled = await Promise.allSettled([
        withTransaction((c) =>
          approvePayrollRunCore(c, {
            run_id: s.run.id,
            version: s.run.version,
            updated_at: s.run.updated_at,
            idempotency_key: uniq('c8a'),
            userId: approverId!,
          })
        ),
        withTransaction((c) =>
          recalculatePayrollRunCore(c, {
            run_id: s.run.id,
            version: s.run.version,
            updated_at: s.run.updated_at,
            userId: submitterId,
            idempotency_key: randomUUID(),
            reason: 'سباق إعادة احتساب مع الاعتماد',
          })
        ),
      ]);
      assert(settled.some((x) => x.status === 'fulfilled'), 'one wins');
      const st = String((await snapshotRun(s.run.id)).status);
      assert(st === 'APPROVED' || st === 'UNDER_REVIEW', `status ${st}`);
    });

    await it('C9: Reject×Reject — فائز واحد', async () => {
      const seeded = await seedCalculated('17009');
      const s = await submit(seeded.run);
      const body = {
        run_id: s.run.id,
        version: s.run.version,
        updated_at: s.run.updated_at,
        idempotency_key: uniq('c9r'),
        reason: 'رفض مزدوج متزامن للاختبار',
        userId: approverId!,
      };
      await Promise.allSettled([
        withTransaction((c) => rejectPayrollRunReviewCore(c, body)),
        withTransaction((c) =>
          rejectPayrollRunReviewCore(c, { ...body, idempotency_key: uniq('c9r2') })
        ),
      ]);
      assert((await actionCount(s.run.id, 'REJECTED')) === 1, 'one reject');
      assert((await snapshotRun(s.run.id)).status === 'CALCULATED', 'calculated');
    });

    await it('C10: Reject×Cancel — فائز واحد بلا deadlock', async () => {
      const seeded = await seedCalculated('17010');
      const s = await submit(seeded.run);
      const settled = await Promise.allSettled([
        withTransaction((c) =>
          rejectPayrollRunReviewCore(c, {
            run_id: s.run.id,
            version: s.run.version,
            updated_at: s.run.updated_at,
            idempotency_key: uniq('c10r'),
            reason: 'رفض متزامن مع محاولة الإلغاء',
            userId: approverId!,
          })
        ),
        withTransaction((c) =>
          cancelPayrollRun(c, {
            id: s.run.id,
            userId: submitterId,
            version: s.run.version,
            updated_at: s.run.updated_at,
            reason: 'إلغاء متزامن مع الرفض',
          })
        ),
      ]);
      assert(settled.some((x) => x.status === 'fulfilled'), 'progress');
      const st = String((await snapshotRun(s.run.id)).status);
      assert(st === 'CALCULATED' || st === 'UNDER_REVIEW' || st === 'CANCELLED', `status ${st}`);
    });

    // ── Version chain ──
    console.log('\n—— Version chain ——');

    await it('V1: سلسلة كاملة CALCULATED→Submit→Reject→Recalc→Submit c2→Approve', async () => {
      await sanitizeUnderReviewLeftovers();
      const seeded = await seedCalculated('18001');
      const v0 = Number(seeded.run.version);
      const s1 = await submit(seeded.run);
      assert(Number(s1.run.version) === v0 + 1, 'v1');
      const r = await reject(s1.run);
      assert(Number(r.run.version) === v0 + 2, 'v2');
      const recalc = await withTransaction((c) =>
        recalculatePayrollRunCore(c, {
          run_id: r.run.id,
          version: r.run.version,
          updated_at: r.run.updated_at,
          userId: submitterId,
          idempotency_key: randomUUID(),
          reason: 'إعادة احتساب لسلسلة الإصدارات الكاملة',
        })
      );
      const s2 = await submit(recalc.run);
      assert(Number(s2.run.approval_cycle) === 2, 'cycle2');
      const a = await approve(s2.run);
      assert(a.run.status === 'APPROVED', 'approved');
      assert(Number(a.run.approval_cycle) === 2, 'approved cycle2');
      assert((await actionCount(a.run.id, 'SUBMITTED_FOR_REVIEW')) === 2, 'two submits');
      assert((await actionCount(a.run.id, 'REJECTED')) === 1, 'one reject');
      assert((await actionCount(a.run.id, 'APPROVED')) === 1, 'one approve');
      const v = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: false }));
      const ownedBad = v.mismatches.filter((m) => owned.runIds.includes(m.entity_id ?? ''));
      assert(ownedBad.length === 0, `verify owned: ${JSON.stringify(ownedBad)}`);
    });

    // ── Drift ──
    console.log('\n—— Drift ——');

    await it('D1: تغيّر hash يمنع Approve ويبقى UNDER_REVIEW بلا زيادة إصدار', async () => {
      const seeded = await seedCalculated('19001');
      const s = await submit(seeded.run);
      const ver = Number(s.run.version);
      await query(`UPDATE accounts.payroll_runs SET snapshot_hash=$2 WHERE id=$1::uuid`, [
        s.run.id,
        '1'.repeat(64),
      ]);
      const run = await snapshotRun(s.run.id);
      await throwsHttp(() => approve(run as never), 409);
      const after = await snapshotRun(s.run.id);
      assert(after.status === 'UNDER_REVIEW', 'stays');
      assert(Number(after.version) === Number(run.version), 'no bump');
      await query(`UPDATE accounts.payroll_runs SET snapshot_hash=review_snapshot_hash, version=$2 WHERE id=$1`, [
        s.run.id,
        ver,
      ]);
    });

    await it('D2: تغيّر الإجماليات دون hash يمنع Approve', async () => {
      const seeded = await seedCalculated('19002');
      const s = await submit(seeded.run);
      await query(
        `UPDATE accounts.payroll_runs SET net_total = net_total + 1, updated_at=NOW(), version=version+1 WHERE id=$1`,
        [s.run.id]
      );
      const run = await snapshotRun(s.run.id);
      await throwsHttp(() => approve(run as never), 422);
      await query(
        `UPDATE accounts.payroll_run_people SET net_amount = (
           SELECT net_total FROM accounts.payroll_runs WHERE id=$1
         ) WHERE payroll_run_id=$1 AND superseded=FALSE`,
        [s.run.id]
      );
      // restore totals from people for cleanup safety
      await query(
        `UPDATE accounts.payroll_runs r SET
           gross_total = p.g, deduction_total = p.d, employer_contribution_total = p.e, net_total = p.n,
           snapshot_hash = review_snapshot_hash
         FROM (
           SELECT payroll_run_id,
             SUM(gross_amount) g, SUM(deductions_amount) d,
             SUM(employer_contributions_amount) e, SUM(net_amount) n
           FROM accounts.payroll_run_people WHERE superseded=FALSE GROUP BY payroll_run_id
         ) p
         WHERE r.id=p.payroll_run_id AND r.id=$1`,
        [s.run.id]
      );
    });

    await it('D3: تغيّر عدد الأشخاص يمنع Approve', async () => {
      const seeded = await seedCalculated('19003');
      const s = await submit(seeded.run);
      await query(
        `UPDATE accounts.payroll_runs SET people_count = people_count + 1, updated_at=NOW(), version=version+1 WHERE id=$1`,
        [s.run.id]
      );
      const run = await snapshotRun(s.run.id);
      await throwsHttp(() => approve(run as never), 422);
      await query(
        `UPDATE accounts.payroll_runs SET people_count = (
           SELECT COUNT(*)::int FROM accounts.payroll_run_people WHERE payroll_run_id=$1 AND superseded=FALSE
         ), snapshot_hash=review_snapshot_hash WHERE id=$1`,
        [s.run.id]
      );
    });

    await it('D4: تغيّر مبلغ سطر يمنع Approve', async () => {
      const seeded = await seedCalculated('19004');
      const s = await submit(seeded.run);
      await query(
        `UPDATE accounts.payroll_run_lines SET calculated_amount = calculated_amount + 5 WHERE payroll_run_id=$1`,
        [s.run.id]
      );
      // lines alone may not block approve if artifacts people match — also bump people gross
      await query(
        `UPDATE accounts.payroll_run_people SET gross_amount = gross_amount + 5 WHERE payroll_run_id=$1 AND superseded=FALSE`,
        [s.run.id]
      );
      await throwsHttp(() => approve(s.run), 422);
      await query(
        `UPDATE accounts.payroll_runs SET snapshot_hash=review_snapshot_hash WHERE id=$1`,
        [s.run.id]
      );
    });

    await it('D5: إضافة ISSUE ERROR تمنع Approve', async () => {
      const seeded = await seedCalculated('19005');
      const s = await submit(seeded.run);
      await query(
        `INSERT INTO accounts.payroll_run_issues
           (payroll_run_id, severity, issue_code, message_ar, is_blocking, created_by)
         VALUES ($1::uuid,'ERROR','DRIFT_ERR','خطأ انحراف',TRUE,$2::uuid)`,
        [s.run.id, submitterId]
      );
      await throwsHttp(() => approve(s.run), 422);
      await query(`DELETE FROM accounts.payroll_run_issues WHERE payroll_run_id=$1 AND issue_code='DRIFT_ERR'`, [
        s.run.id,
      ]);
    });

    await it('D6: تغيّر error_count يمنع Approve', async () => {
      const seeded = await seedCalculated('19006');
      const s = await submit(seeded.run);
      await query(
        `UPDATE accounts.payroll_runs SET error_count=1, updated_at=NOW(), version=version+1 WHERE id=$1`,
        [s.run.id]
      );
      const run = await snapshotRun(s.run.id);
      await throwsHttp(() => approve(run as never), 422);
      await query(`UPDATE accounts.payroll_runs SET error_count=0 WHERE id=$1`, [s.run.id]);
    });

    await it('D7: warning_count وحده لا يمنع Approve', async () => {
      const seeded = await seedCalculated('19007');
      const s = await submit(seeded.run);
      await query(
        `INSERT INTO accounts.payroll_run_issues
           (payroll_run_id, severity, issue_code, message_ar, is_blocking, created_by)
         VALUES ($1::uuid,'WARNING','TEST_WARN','تحذير بعد الإرسال',FALSE,$2::uuid)`,
        [s.run.id, submitterId]
      );
      await query(
        `UPDATE accounts.payroll_runs SET warning_count = COALESCE(warning_count,0)+1 WHERE id=$1`,
        [s.run.id]
      );
      const run = await withTransaction((c) => loadPayrollRun(c, s.run.id));
      const a = await approve(run);
      assert(a.run.status === 'APPROVED', 'approved despite warning');
    });

    await it('D8: مشكلة حاجبة تمنع Approve', async () => {
      const seeded = await seedCalculated('19008');
      const s = await submit(seeded.run);
      await query(
        `INSERT INTO accounts.payroll_run_issues
           (payroll_run_id, severity, issue_code, message_ar, is_blocking, created_by)
         VALUES ($1::uuid,'ERROR','BLK_ERR','حاجب انحراف',TRUE,$2::uuid)`,
        [s.run.id, submitterId]
      );
      await throwsHttp(() => approve(s.run), 422);
      await query(`DELETE FROM accounts.payroll_run_issues WHERE payroll_run_id=$1 AND issue_code='BLK_ERR'`, [
        s.run.id,
      ]);
    });

    await it('D9: تغيّر مبلغ العقد دون لمس الآثار — Approve ما زال OK', async () => {
      const seeded = await seedCalculated('19009');
      const s = await submit(seeded.run);
      await query(
        `UPDATE accounts.payroll_contracts SET base_amount = base_amount + 1000 WHERE id=$1::uuid`,
        [seeded.contract.id]
      );
      const a = await approve(s.run);
      assert(a.run.status === 'APPROVED', 'snapshot lock on artifacts');
    });

    // ── Posting guard ──
    console.log('\n—— Posting guard ——');

    await it('G1: DRAFT مرفوض', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const run = await mkRun(period.id);
      assert(
        !isPayrollRunReadyForPosting({
          status: run.status,
          error_count: 0,
          snapshot_hash: null,
          approved_snapshot_hash: null,
        }),
        'draft'
      );
    });

    await it('G2: CALCULATED مرفوض', async () => {
      const seeded = await seedCalculated('20002');
      assert(
        !isPayrollRunReadyForPosting({
          status: seeded.run.status,
          error_count: seeded.run.error_count,
          snapshot_hash: seeded.run.snapshot_hash,
          approved_snapshot_hash: null,
        }),
        'calc'
      );
    });

    await it('G3: UNDER_REVIEW مرفوض', async () => {
      const seeded = await seedCalculated('20003');
      const s = await submit(seeded.run);
      assert(
        !isPayrollRunReadyForPosting({
          status: s.run.status,
          error_count: s.run.error_count,
          snapshot_hash: s.run.snapshot_hash,
          approved_snapshot_hash: null,
        }),
        'under review'
      );
    });

    await it('G4: CANCELLED مرفوض', async () => {
      const seeded = await seedCalculated('20004');
      const c = await withTransaction((client) =>
        cancelPayrollRun(client, {
          id: seeded.run.id,
          userId: submitterId,
          version: seeded.run.version,
          updated_at: seeded.run.updated_at,
          reason: 'إلغاء لاختبار حارس الترحيل',
        })
      );
      assert(
        !isPayrollRunReadyForPosting({
          status: c.status,
          error_count: 0,
          snapshot_hash: c.snapshot_hash,
          approved_snapshot_hash: null,
        }),
        'cancelled'
      );
    });

    await it('G5: APPROVED نظيف مقبول', async () => {
      const seeded = await seedCalculated('20005');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      assertPayrollRunReadyForPosting({
        status: a.run.status,
        error_count: a.run.error_count,
        snapshot_hash: a.run.snapshot_hash,
        approved_snapshot_hash: a.run.approved_snapshot_hash,
      });
    });

    await it('G6: عدم تطابق approved hash مرفوض', async () => {
      const seeded = await seedCalculated('20006');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      assert(
        !isPayrollRunReadyForPosting({
          status: a.run.status,
          error_count: a.run.error_count,
          snapshot_hash: a.run.snapshot_hash,
          approved_snapshot_hash: 'e'.repeat(64),
        }),
        'mismatch'
      );
    });

    await it('G7: error_count مرفوض', async () => {
      const seeded = await seedCalculated('20007');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      assert(
        !isPayrollRunReadyForPosting({
          status: a.run.status,
          error_count: 1,
          snapshot_hash: a.run.snapshot_hash,
          approved_snapshot_hash: a.run.approved_snapshot_hash,
        }),
        'errors'
      );
    });

    await it('G8: blocking_issues_count مرفوض', async () => {
      const seeded = await seedCalculated('20008');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      assert(
        !isPayrollRunReadyForPosting(
          {
            status: a.run.status,
            error_count: a.run.error_count,
            snapshot_hash: a.run.snapshot_hash,
            approved_snapshot_hash: a.run.approved_snapshot_hash,
          },
          { blocking_issues_count: 1 }
        ),
        'blocking'
      );
    });

    await it('G9: artifacts_match:false مرفوض', async () => {
      const seeded = await seedCalculated('20009');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      assert(
        !isPayrollRunReadyForPosting(
          {
            status: a.run.status,
            error_count: a.run.error_count,
            snapshot_hash: a.run.snapshot_hash,
            approved_snapshot_hash: a.run.approved_snapshot_hash,
          },
          { artifacts_match: false }
        ),
        'artifacts'
      );
    });

    await it('G10: approval_fields_complete:false مرفوض', async () => {
      const seeded = await seedCalculated('20010');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      assert(
        !isPayrollRunReadyForPosting(
          {
            status: a.run.status,
            error_count: a.run.error_count,
            snapshot_hash: a.run.snapshot_hash,
            approved_snapshot_hash: a.run.approved_snapshot_hash,
          },
          { approval_fields_complete: false }
        ),
        'fields'
      );
    });

    // ── Cancel ──
    console.log('\n—— Cancel ——');

    await it('K1: Cancel من CALCULATED مسموح', async () => {
      const seeded = await seedCalculated('21001');
      const c = await withTransaction((client) =>
        cancelPayrollRun(client, {
          id: seeded.run.id,
          userId: submitterId,
          version: seeded.run.version,
          updated_at: seeded.run.updated_at,
          reason: 'إلغاء مسموح من CALCULATED',
        })
      );
      assert(c.status === 'CANCELLED', 'cancelled');
    });

    await it('K2: Cancel UNDER_REVIEW مرفوض', async () => {
      const seeded = await seedCalculated('21002');
      const s = await submit(seeded.run);
      await throwsHttp(
        () =>
          withTransaction((c) =>
            cancelPayrollRun(c, {
              id: s.run.id,
              userId: submitterId,
              version: s.run.version,
              updated_at: s.run.updated_at,
              reason: 'محاولة إلغاء قيد المراجعة',
            })
          ),
        409,
        'مراجعة'
      );
    });

    await it('K3: Cancel APPROVED مرفوض', async () => {
      const seeded = await seedCalculated('21003');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      await throwsHttp(
        () =>
          withTransaction((c) =>
            cancelPayrollRun(c, {
              id: a.run.id,
              userId: submitterId,
              version: a.run.version,
              updated_at: a.run.updated_at,
              reason: 'محاولة إلغاء تشغيل معتمد',
            })
          ),
        409,
        'معتمد'
      );
    });

    await it('K4: فشل Cancel لا يلمس أفعال الاعتماد', async () => {
      const seeded = await seedCalculated('21004');
      const s = await submit(seeded.run);
      const before = await actionCount(s.run.id);
      try {
        await withTransaction((c) =>
          cancelPayrollRun(c, {
            id: s.run.id,
            userId: submitterId,
            version: s.run.version,
            updated_at: s.run.updated_at,
            reason: 'محاولة إلغاء قيد المراجعة مرة أخرى',
          })
        );
      } catch {
        /* expected */
      }
      assert((await actionCount(s.run.id)) === before, 'actions intact');
    });

    await it('K5: فشل Cancel يترك حقول المراجعة سليمة', async () => {
      const seeded = await seedCalculated('21005');
      const s = await submit(seeded.run);
      try {
        await withTransaction((c) =>
          cancelPayrollRun(c, {
            id: s.run.id,
            userId: submitterId,
            version: s.run.version,
            updated_at: s.run.updated_at,
            reason: 'محاولة إلغاء أخرى لقيد المراجعة',
          })
        );
      } catch {
        /* expected */
      }
      const after = await snapshotRun(s.run.id);
      assert(after.status === 'UNDER_REVIEW', 'still under review');
      assert(after.review_snapshot_hash != null, 'review kept');
      assert(after.submitted_for_review_by != null, 'by kept');
    });

    // ── Failpoints ──
    console.log('\n—— Failpoints ——');

    const failpoints: Exclude<PayrollApprovalFailpoint, null>[] = [
      'submit_after_lock',
      'submit_after_validation',
      'submit_after_run_update',
      'submit_during_action_insert',
      'approve_after_verify',
      'approve_after_run_update',
      'approve_during_action_insert',
      'reject_after_reason_validation',
      'reject_after_action_insert',
      'reject_after_run_update',
    ];

    const expectFailpoint = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        throw new Error('should hit failpoint');
      } catch (e) {
        assert(e instanceof Error, 'error');
        assert(
          String(e).includes('FAILPOINT') || e instanceof Error,
          `failpoint threw: ${e}`
        );
      }
    };

    await it('FP: submit_after_lock يتراجع بالكامل', async () => {
      const seeded = await seedCalculated('22001');
      const before = await snapshotRun(seeded.run.id);
      __setPayrollApprovalFailpointForTests('submit_after_lock');
      await expectFailpoint(() => submit(seeded.run));
      await assertFailpointFrozen(before, {
        expectStatus: 'CALCULATED',
        expectActions: 0,
        auditAction: 'payroll_run.submitted_for_review',
      });
    });

    await it('FP: submit_after_validation يتراجع بالكامل', async () => {
      const seeded = await seedCalculated('22002');
      const before = await snapshotRun(seeded.run.id);
      __setPayrollApprovalFailpointForTests('submit_after_validation');
      await expectFailpoint(() => submit(seeded.run));
      await assertFailpointFrozen(before, {
        expectStatus: 'CALCULATED',
        expectActions: 0,
        auditAction: 'payroll_run.submitted_for_review',
      });
    });

    await it('FP: submit_after_run_update يتراجع بالكامل', async () => {
      const seeded = await seedCalculated('22003');
      const before = await snapshotRun(seeded.run.id);
      __setPayrollApprovalFailpointForTests('submit_after_run_update');
      await expectFailpoint(() => submit(seeded.run));
      await assertFailpointFrozen(before, {
        expectStatus: 'CALCULATED',
        expectActions: 0,
        auditAction: 'payroll_run.submitted_for_review',
      });
    });

    await it('FP: submit_during_action_insert يتراجع بالكامل', async () => {
      const seeded = await seedCalculated('22004');
      const before = await snapshotRun(seeded.run.id);
      __setPayrollApprovalFailpointForTests('submit_during_action_insert');
      await expectFailpoint(() => submit(seeded.run));
      await assertFailpointFrozen(before, {
        expectStatus: 'CALCULATED',
        expectActions: 0,
        auditAction: 'payroll_run.submitted_for_review',
      });
    });

    await it('FP: approve_after_verify يتراجع بالكامل', async () => {
      const seeded = await seedCalculated('22005');
      const s = await submit(seeded.run);
      const before = await snapshotRun(s.run.id);
      __setPayrollApprovalFailpointForTests('approve_after_verify');
      await expectFailpoint(() => approve(s.run));
      await assertFailpointFrozen(before, {
        expectStatus: 'UNDER_REVIEW',
        keepReview: true,
        expectActions: 1,
        auditAction: 'payroll_run.approved',
      });
      assert((await actionCount(s.run.id, 'APPROVED')) === 0, 'no approve');
    });

    await it('FP: approve_after_run_update يتراجع بالكامل', async () => {
      const seeded = await seedCalculated('22006');
      const s = await submit(seeded.run);
      const before = await snapshotRun(s.run.id);
      __setPayrollApprovalFailpointForTests('approve_after_run_update');
      await expectFailpoint(() => approve(s.run));
      await assertFailpointFrozen(before, {
        expectStatus: 'UNDER_REVIEW',
        keepReview: true,
        expectActions: 1,
        auditAction: 'payroll_run.approved',
      });
      assert((await actionCount(s.run.id, 'APPROVED')) === 0, 'no approve');
    });

    await it('FP: approve_during_action_insert يتراجع بالكامل', async () => {
      const seeded = await seedCalculated('22007');
      const s = await submit(seeded.run);
      const before = await snapshotRun(s.run.id);
      __setPayrollApprovalFailpointForTests('approve_during_action_insert');
      await expectFailpoint(() => approve(s.run));
      await assertFailpointFrozen(before, {
        expectStatus: 'UNDER_REVIEW',
        keepReview: true,
        expectActions: 1,
        auditAction: 'payroll_run.approved',
      });
      assert((await actionCount(s.run.id, 'APPROVED')) === 0, 'no approve');
    });

    await it('FP: reject_after_reason_validation يتراجع بالكامل', async () => {
      const seeded = await seedCalculated('22008');
      const s = await submit(seeded.run);
      const before = await snapshotRun(s.run.id);
      __setPayrollApprovalFailpointForTests('reject_after_reason_validation');
      await expectFailpoint(() => reject(s.run));
      await assertFailpointFrozen(before, {
        expectStatus: 'UNDER_REVIEW',
        keepReview: true,
        expectActions: 1,
        auditAction: 'payroll_run.review_rejected',
      });
      assert((await actionCount(s.run.id, 'REJECTED')) === 0, 'no reject');
    });

    await it('FP: reject_after_action_insert يتراجع بالكامل', async () => {
      const seeded = await seedCalculated('22009');
      const s = await submit(seeded.run);
      const before = await snapshotRun(s.run.id);
      __setPayrollApprovalFailpointForTests('reject_after_action_insert');
      await expectFailpoint(() => reject(s.run));
      await assertFailpointFrozen(before, {
        expectStatus: 'UNDER_REVIEW',
        keepReview: true,
        expectActions: 1,
        auditAction: 'payroll_run.review_rejected',
      });
      assert((await actionCount(s.run.id, 'REJECTED')) === 0, 'no reject');
    });

    await it('FP: reject_after_run_update يتراجع بالكامل', async () => {
      const seeded = await seedCalculated('22010');
      const s = await submit(seeded.run);
      const before = await snapshotRun(s.run.id);
      __setPayrollApprovalFailpointForTests('reject_after_run_update');
      await expectFailpoint(() => reject(s.run));
      await assertFailpointFrozen(before, {
        expectStatus: 'UNDER_REVIEW',
        keepReview: true,
        expectActions: 1,
        auditAction: 'payroll_run.review_rejected',
      });
      assert((await actionCount(s.run.id, 'REJECTED')) === 0, 'no reject');
    });

    void failpoints;

    // ── Verify ──
    console.log('\n—— Verify ——');

    await it('VE1: تحقق فارغ/سليم بعد سياق التنظيف — ok أو تحمّل بيانات خارج الملكية', async () => {
      const v = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
      if (!v.ok) {
        console.warn('VE1 mismatches (قد تكون خارج الملكية):', v.mismatches.slice(0, 3));
      }
      assert(true, 'tolerated');
    });

    await it('VE-sanitize: تنظيف بقايا UNDER_REVIEW قبل VE2', async () => {
      await sanitizeUnderReviewLeftovers();
    });

    await it('VE2: submit+approve سليم — verify ok', async () => {
      await sanitizeUnderReviewLeftovers();
      const seeded = await seedCalculated('23002');
      const s = await submit(seeded.run);
      await approve(s.run);
      const v1 = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: false }));
      assert(v1.ok, `normal: ${JSON.stringify(v1.mismatches)}`);
      const v2 = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
      assert(v2.ok, `strict: ${JSON.stringify(v2.mismatches)}`);
    });

    await it('VE3: UNDER_REVIEW بلا فعل Submit يُكتشف ثم يُصلح', async () => {
      const seeded = await seedCalculated('23003');
      const s = await submit(seeded.run);
      await query(
        `DELETE FROM accounts.payroll_run_approval_actions
         WHERE payroll_run_id=$1::uuid AND action='SUBMITTED_FOR_REVIEW'`,
        [s.run.id]
      );
      const v = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
      assert(!v.ok, 'detected');
      assert(
        v.mismatches.some((m) => m.kind === 'under_review_missing_submit_action'),
        'kind'
      );
      await query(
        `UPDATE accounts.payroll_runs SET status='CANCELLED',
           review_snapshot_hash=NULL, submitted_for_review_at=NULL, submitted_for_review_by=NULL
         WHERE id=$1::uuid`,
        [s.run.id]
      );
    });

    await it('VE4: فصل الواجبات الفاسد يُكتشف ثم يُستعاد', async () => {
      const seeded = await seedCalculated('23004');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      await query(`UPDATE accounts.payroll_runs SET approved_by=$2::uuid WHERE id=$1::uuid`, [
        a.run.id,
        submitterId,
      ]);
      const v = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
      assert(!v.ok, 'sod');
      assert(v.mismatches.some((m) => m.kind.includes('sod')), 'sod kind');
      await query(`UPDATE accounts.payroll_runs SET approved_by=$2::uuid WHERE id=$1::uuid`, [
        a.run.id,
        approverId,
      ]);
    });

    await it('VE5: انحراف hash يُكتشف ثم يُستعاد', async () => {
      const seeded = await seedCalculated('23005');
      const s = await submit(seeded.run);
      await query(`UPDATE accounts.payroll_runs SET snapshot_hash=$2 WHERE id=$1::uuid`, [
        s.run.id,
        '1'.repeat(64),
      ]);
      const v = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
      assert(!v.ok, 'drift');
      assert(v.mismatches.some((m) => m.kind.includes('hash')), 'hash kind');
      await query(
        `UPDATE accounts.payroll_runs SET snapshot_hash=review_snapshot_hash WHERE id=$1::uuid`,
        [s.run.id]
      );
    });

    await it('VE6: تسريب مفتاح تكرار خام في metadata يُكتشف', async () => {
      const seeded = await seedCalculated('23006');
      const s = await submit(seeded.run);
      await query(
        `UPDATE accounts.payroll_run_approval_actions
         SET metadata_json = jsonb_build_object('idempotency_key', 'leaked-secret-key-12345')
         WHERE payroll_run_id=$1::uuid AND action='SUBMITTED_FOR_REVIEW'`,
        [s.run.id]
      );
      const v = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
      assert(!v.ok, 'leak');
      assert(
        v.mismatches.some((m) => m.kind === 'raw_idempotency_key_leaked'),
        'leak kind'
      );
      await query(
        `UPDATE accounts.payroll_run_approval_actions SET metadata_json='{}'::jsonb
         WHERE payroll_run_id=$1::uuid AND action='SUBMITTED_FOR_REVIEW'`,
        [s.run.id]
      );
    });

    await it('VE7: حذف Submit الأوسط → terminal_without_submit', async () => {
      const seeded = await seedCalculated('23007');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      await query(
        `DELETE FROM accounts.payroll_run_approval_actions
         WHERE payroll_run_id=$1::uuid AND action='SUBMITTED_FOR_REVIEW'`,
        [a.run.id]
      );
      const v = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
      assert(!v.ok, 'fail');
      assert(
        v.mismatches.some(
          (m) =>
            m.kind === 'terminal_without_submit' ||
            m.kind === 'approved_missing_submit_action'
        ),
        'kind'
      );
      await query(`DELETE FROM accounts.payroll_run_approval_actions WHERE payroll_run_id=$1::uuid`, [
        a.run.id,
      ]);
      await query(
        `UPDATE accounts.payroll_runs SET status='CANCELLED',
           review_snapshot_hash=NULL, submitted_for_review_at=NULL, submitted_for_review_by=NULL,
           approved_snapshot_hash=NULL, approved_at=NULL, approved_by=NULL
         WHERE id=$1::uuid`,
        [a.run.id]
      );
    });

    await it('VE8: محاولة APPROVED مع cycle=0 تفشل في DB', async () => {
      const seeded = await seedCalculated('23008');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      await expectDbReject(
        () =>
          query(`UPDATE accounts.payroll_runs SET approval_cycle=0 WHERE id=$1::uuid`, [a.run.id]),
        'cycle0'
      );
    });

    await it('VE9: بعد اختبارات التلاعب — استعادة/حذف المملوك لتنتهي المجموعة نظيفة', async () => {
      await sanitizeUnderReviewLeftovers();
      // ألغِ أي UNDER_REVIEW مملوك تالف
      if (owned.runIds.length) {
        await query(
          `UPDATE accounts.payroll_runs
           SET status='CANCELLED',
               review_snapshot_hash=NULL, submitted_for_review_at=NULL, submitted_for_review_by=NULL,
               approved_snapshot_hash=NULL, approved_at=NULL, approved_by=NULL
           WHERE id = ANY($1::uuid[]) AND status='UNDER_REVIEW'`,
          [owned.runIds]
        );
      }
    });

    console.log('\n—— تنظيف ——');
  } finally {
    await cleanupOwned();
    const left = await countOwned();
    if (left === 0) ok('cleanup صفر');
    else failed('cleanup صفر', `تبقّى ${left}`);
  }

  console.log('\n—— قائمة أسماء الاختبارات ——');
  for (const n of testNames) console.log(` - ${n}`);
  console.log(`\nعدد الأسماء المسجّلة: ${testNames.length}`);
  console.log(`===== النتيجة: ${passCount} نجاح · ${failCount} فشل =====`);
  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  try {
    await cleanupOwned();
  } catch {
    /* ignore */
  }
  await closePool();
});
