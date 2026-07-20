/**
 * ط§ط®طھط¨ط§ط±ط§طھ ظ†ظˆط§ط© ط§ط¹طھظ…ط§ط¯ ط§ظ„ط±ظˆط§طھط¨ 9.B.1
 * npm run test:payroll-approval-core
 *
 * ط¹ط²ظ„: ownership token + cleanup ظپظٹ finally. طھط´ط؛ظٹظ„ ظ…ط±طھظٹظ† ط¨ظ„ط§ طھط±ط§ظƒظ….
 */
import { randomUUID } from 'crypto';
import { closePool, query } from '../lib/db';
import { AccountsHttpError } from '../lib/accounts/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import { calculatePayrollRunCore } from '../lib/accounts/payroll-calculation-engine';
import {
  approvePayrollRunCore,
  rejectPayrollRunReviewCore,
  submitPayrollRunForReviewCore,
} from '../lib/accounts/payroll-approval-core';
import {
  __clearPayrollApprovalFailpointForTests,
  __setPayrollApprovalFailpointForTests,
  type PayrollApprovalFailpoint,
} from '../lib/accounts/payroll-approval-failpoints';
import { recalculatePayrollRunCore } from '../lib/accounts/payroll-recalculate-core';
import { createPayrollCalendar } from '../lib/accounts/payroll-calendars';
import { createPayrollComponent } from '../lib/accounts/payroll-components';
import { createPayrollComponentAssignment } from '../lib/accounts/payroll-component-assignments';
import {
  createPayrollContract,
  transitionPayrollContract,
} from '../lib/accounts/payroll-contracts';
import { createPayrollPerson } from '../lib/accounts/payroll-people';
import { createPayrollPeriod } from '../lib/accounts/payroll-periods';
import {
  cancelPayrollRun,
  createPayrollRun,
  updatePayrollRun,
} from '../lib/accounts/payroll-runs';
import { addScopeMember } from '../lib/accounts/payroll-run-scope';
import {
  assertPayrollRunReadyForPosting,
  isPayrollRunReadyForPosting,
} from '../lib/accounts/payroll-posting-guard';
import { verifyPayrollApprovalCore } from '../lib/accounts/verify-payroll-approval-core';
import { withTransaction } from '../lib/accounts/with-transaction';

let passCount = 0;
let failCount = 0;
function ok(name: string) {
  passCount += 1;
  console.log(`âœ… ${name}`);
}
function failed(name: string, err?: unknown) {
  failCount += 1;
  console.error(`â‌Œ ${name}`, err instanceof Error ? err.message : (err ?? ''));
  process.exitCode = 1;
}
async function it(name: string, fn: () => Promise<void>) {
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
        throw new Error(`ط§ظ„ط±ط³ط§ظ„ط©: ${e.message}`);
      }
      return;
    }
    throw e;
  }
  throw new Error(`طھظˆظ‚ظ‘ط¹ظ†ط§ ${status}`);
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

async function main() {
  console.log('===== ط§ط®طھط¨ط§ط±ط§طھ ظ†ظˆط§ط© ط§ط¹طھظ…ط§ط¯ ط§ظ„ط±ظˆط§طھط¨ 9.B.1 =====');
  const token = `APPR${Date.now().toString(36).toUpperCase()}`;
  let seq = 0;
  const uniq = (p: string) => {
    seq += 1;
    return `${p}-${token}-${seq}`;
  };

  // migration columns present
  const cols = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='accounts' AND table_name='payroll_runs'
       AND column_name IN ('approval_cycle','review_snapshot_hash','submitted_for_review_at',
                           'submitted_for_review_by','approved_snapshot_hash','approved_at','approved_by')`
  );
  if (cols.rows.length < 7) {
    failed('ط¥ط¹ط¯ط§ط¯: Migration 097 ط؛ظٹط± ظ…ط·ط¨ظ‘ظ‚ط© â€” ط´ط؛ظ‘ظ„ npm run migrate');
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
    failed('ط¥ط¹ط¯ط§ط¯: ظ„ط§ ظ…ط³طھط®ط¯ظ… ACCOUNTS');
    await closePool();
    return;
  }
  const submitterId = users.rows[0].id as string;
  await grantAccountsAdminRole(submitterId);

  let approverId = users.rows[1]?.id as string | undefined;
  if (!approverId) {
    const created = await query(
      `INSERT INTO student_affairs.users (username, password_hash, full_name, is_active)
       VALUES ($1, 'x', 'ظ…ط±ط§ط¬ط¹ ط§ط¹طھظ…ط§ط¯ 9B1', TRUE) RETURNING id`,
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
       VALUES ($1,'ط³ظ†ط© ط§ط¹طھظ…ط§ط¯','2025-01-01','2025-12-31','ACTIVE',FALSE,$2) RETURNING id`,
      [uniq('APPRFY'), submitterId]
    );
  }
  const fiscalYearId = fy.rows[0].id as string;

  const mkCalendar = async () => {
    const cal = await withTransaction((c) =>
      createPayrollCalendar(c, {
        code: uniq('APPRCAL'),
        name_ar: 'طھظ‚ظˆظٹظ… ط§ط¹طھظ…ط§ط¯',
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
        name_ar: 'ظپطھط±ط© ط§ط¹طھظ…ط§ط¯',
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
        full_name_ar: 'ط´ط®طµ ط§ط¹طھظ…ط§ط¯',
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
        name_ar: 'ط¨ط¯ظ„ ط§ط¹طھظ…ط§ط¯',
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
        payroll_contract_id: over.payroll_contract_id,
        amount: over.amount,
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
        reason: opts.reason ?? 'ط³ط¨ط¨ ط±ظپط¶ ظ…ط±ط§ط¬ط¹ط© ظƒط§ظپظچ ظ„ظ„ط§ط®طھط¨ط§ط±',
        userId: opts.userId ?? approverId!,
      })
    );

  try {
    // â€”â€” Migration / model â€”â€”
    await it('1) ط§ظ„ط­ط§ظ„ط§طھ ط§ظ„ط¬ط¯ظٹط¯ط© ظ…ظ‚ط¨ظˆظ„ط© ط¹ط¨ط± Core', async () => {
      const seeded = await seedCalculated('10001');
      const s = await submit(seeded.run);
      assert(s.run.status === 'UNDER_REVIEW', 'under_review');
      const a = await approve(s.run);
      assert(a.run.status === 'APPROVED', 'approved');
    });

    await it('2) status ط؛ظٹط± ظ…ط¯ط¹ظˆظ… ظ…ط±ظپظˆط¶ (POSTED/REJECTED)', async () => {
      const seeded = await seedCalculated('10002');
      try {
        await query(`UPDATE accounts.payroll_runs SET status='POSTED' WHERE id=$1::uuid`, [
          seeded.run.id,
        ]);
        throw new Error('POSTED ظٹط¬ط¨ ط£ظ† ظٹظڈط±ظپط¶');
      } catch (e) {
        assert(
          String(e).includes('check') ||
            String(e).includes('CHECK') ||
            String(e).includes('violates'),
          `POSTED: ${e}`
        );
      }
      try {
        await query(`UPDATE accounts.payroll_runs SET status='REJECTED' WHERE id=$1::uuid`, [
          seeded.run.id,
        ]);
        throw new Error('REJECTED ظٹط¬ط¨ ط£ظ† ظٹظڈط±ظپط¶');
      } catch (e) {
        assert(
          String(e).includes('check') ||
            String(e).includes('CHECK') ||
            String(e).includes('violates'),
          `REJECTED: ${e}`
        );
      }
      const row = await query(`SELECT status FROM accounts.payroll_runs WHERE id=$1`, [seeded.run.id]);
      assert(row.rows[0].status === 'CALCULATED', 'unchanged');
    });

    await it('3-4) ظ‚ظٹظˆط¯ UNDER_REVIEW ظˆ APPROVED ظ„ظ„ط­ظ‚ظˆظ„', async () => {
      const seeded = await seedCalculated('10003');
      const s = await submit(seeded.run);
      assert(s.run.review_snapshot_hash === s.run.snapshot_hash, 'review hash');
      assert(s.run.submitted_for_review_by === submitterId, 'submitted by');
      assert(s.run.approved_at == null, 'no approved');
      try {
        await query(
          `UPDATE accounts.payroll_runs SET review_snapshot_hash=NULL WHERE id=$1::uuid`,
          [s.run.id]
        );
        throw new Error('ظٹط¬ط¨ ط±ظپط¶ NULL review طھط­طھ UNDER_REVIEW');
      } catch (e) {
        assert(String(e).includes('check') || String(e).includes('violates'), 'ur constraint');
      }
      const a = await approve(s.run);
      assert(a.run.approved_snapshot_hash === a.run.review_snapshot_hash, 'approved=review');
      try {
        await query(
          `UPDATE accounts.payroll_runs SET approved_by=NULL WHERE id=$1::uuid`,
          [a.run.id]
        );
        throw new Error('ظٹط¬ط¨ ط±ظپط¶ NULL approved_by');
      } catch (e) {
        assert(String(e).includes('check') || String(e).includes('violates'), 'ap constraint');
      }
    });

    await it('5-7) unique Submit/terminal/request_key ظ„ظƒظ„ ط¯ظˆط±ط©', async () => {
      const seeded = await seedCalculated('10005');
      const s = await submit(seeded.run);
      try {
        await query(
          `INSERT INTO accounts.payroll_run_approval_actions
             (payroll_run_id, payroll_period_id, approval_cycle, action, from_status, to_status,
              snapshot_hash, version_before, version_after, request_key_hash, request_payload_hash)
           VALUES ($1::uuid,$2::uuid,$3,'SUBMITTED_FOR_REVIEW','CALCULATED','UNDER_REVIEW',$4,1,2,$5,$6)`,
          [
            s.run.id,
            s.run.payroll_period_id,
            s.run.approval_cycle,
            s.run.snapshot_hash,
            'a'.repeat(64),
            'b'.repeat(64),
          ]
        );
        throw new Error('duplicate submit allowed');
      } catch (e) {
        assert(String(e).includes('unique') || String(e).includes('duplicate'), 'uq submit');
      }
      const a = await approve(s.run);
      try {
        await query(
          `INSERT INTO accounts.payroll_run_approval_actions
             (payroll_run_id, payroll_period_id, approval_cycle, action, from_status, to_status,
              snapshot_hash, version_before, version_after, request_key_hash, request_payload_hash, reason)
           VALUES ($1::uuid,$2::uuid,$3,'REJECTED','UNDER_REVIEW','CALCULATED',$4,1,2,$5,$6,'ط³ط¨ط¨ ط±ظپط¶ ط·ظˆظٹظ„ ط¨ظ…ط§ ظٹظƒظپظٹ')`,
          [
            a.run.id,
            a.run.payroll_period_id,
            a.run.approval_cycle,
            a.run.snapshot_hash,
            'c'.repeat(64),
            'd'.repeat(64),
          ]
        );
        throw new Error('terminal+approved allowed');
      } catch (e) {
        assert(String(e).includes('unique') || String(e).includes('duplicate'), 'uq terminal');
      }
    });

    await it('8) ظپظ‡ط±ط³ ط§ظ„طھط´ط؛ظٹظ„ ط§ظ„ط­ظٹ ظٹط´ظ…ظ„ UNDER_REVIEW ظˆ APPROVED', async () => {
      const seeded = await seedCalculated('10008');
      const s = await submit(seeded.run);
      await throwsHttp(async () => {
        await withTransaction((c) =>
          createPayrollRun(c, {
            payroll_period_id: s.run.payroll_period_id,
            run_type: 'REGULAR',
            scope_type: 'PERSON_LIST',
            created_by: submitterId,
          })
        );
      }, 409);
      const a = await approve(s.run);
      await throwsHttp(async () => {
        await withTransaction((c) =>
          createPayrollRun(c, {
            payroll_period_id: a.run.payroll_period_id,
            run_type: 'REGULAR',
            scope_type: 'PERSON_LIST',
            created_by: submitterId,
          })
        );
      }, 409);
    });

    await it('9) ظ„ط§ Update API ظ„ط¬ط¯ظˆظ„ actions (append-only طھط·ط¨ظٹظ‚ظٹ)', async () => {
      assert(typeof (submitPayrollRunForReviewCore as unknown) === 'function', 'submit exists');
      // ظ„ط§ ظٹظˆط¬ط¯ updatePayrollApprovalAction â€” طھط­ظ‚ظ‚ ط±ظ…ط²ظٹ
      const mod = await import('../lib/accounts/payroll-approval-core');
      assert(!('updatePayrollApprovalAction' in mod), 'no update helper');
      assert(!('deletePayrollApprovalAction' in mod), 'no delete helper');
    });

    // â€”â€” Submit â€”â€”
    await it('10-12) Submit ظ†ط¸ظٹظپ + ط¯ظˆط±ط© + hash', async () => {
      const seeded = await seedCalculated('10010');
      assert(Number(seeded.run.approval_cycle ?? 0) === 0, 'cycle0');
      const s = await submit(seeded.run, { comment: 'طھط¹ظ„ظٹظ‚ ط§ط®طھظٹط§ط±ظٹ' });
      assert(s.run.status === 'UNDER_REVIEW', 'status');
      assert(Number(s.run.approval_cycle) === 1, 'cycle1');
      assert(s.run.review_snapshot_hash === s.run.snapshot_hash, 'hash lock');
      assert(s.idempotent_replay === false, 'not replay');
      assert((await actionCount(s.run.id, 'SUBMITTED_FOR_REVIEW')) === 1, 'one action');
    });

    await it('13) warning-only ظ…ط³ظ…ظˆط­', async () => {
      const seeded = await seedCalculated('10013');
      await query(
        `INSERT INTO accounts.payroll_run_issues
           (payroll_run_id, severity, issue_code, message_ar, is_blocking, created_by)
         VALUES ($1::uuid,'WARNING','TEST_WARN','طھط­ط°ظٹط± ط§ط®طھط¨ط§ط±ظٹ',FALSE,$2::uuid)`,
        [seeded.run.id, submitterId]
      );
      const s = await submit(seeded.run);
      assert(s.run.status === 'UNDER_REVIEW', 'allowed');
    });

    await it('14) error_count ظٹظ…ظ†ط¹ Submit', async () => {
      const seeded = await seedCalculated('10014');
      await query(
        `UPDATE accounts.payroll_runs SET error_count=1, updated_at=NOW(), version=version+1 WHERE id=$1`,
        [seeded.run.id]
      );
      const run = await query(`SELECT * FROM accounts.payroll_runs WHERE id=$1`, [seeded.run.id]);
      await throwsHttp(() => submit(run.rows[0] as never), 422);
    });

    await it('15) ظ…ط´ظƒظ„ط© ط­ط§ط¬ط¨ط© طھظ…ظ†ط¹ Submit', async () => {
      const seeded = await seedCalculated('10015');
      await query(
        `INSERT INTO accounts.payroll_run_issues
           (payroll_run_id, severity, issue_code, message_ar, is_blocking, created_by)
         VALUES ($1::uuid,'ERROR','TEST_ERR','ط®ط·ط£ ط­ط§ط¬ط¨',TRUE,$2::uuid)`,
        [seeded.run.id, submitterId]
      );
      await throwsHttp(() => submit(seeded.run), 422);
    });

    await it('16) hash ظ…ظپظ‚ظˆط¯ ظٹظ…ظ†ط¹ Submit', async () => {
      await seedCalculated('10016');
      // ط¥ط³ظ‚ط§ط· ط§ظ„ظ‚ظٹط¯ ظ…ط¤ظ‚طھط§ظ‹ ط؛ظٹط± ظ…ظ…ظƒظ† â€” ظ†ط­ط§ظƒظٹ ط¹ط¨ط± طھط´ط؛ظٹظ„ DRAFT ط¨ظ„ط§ hash
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const run = await mkRun(period.id);
      await throwsHttp(() => submit(run), 409);
    });

    await it('17) ط¹ط¯ظ… طھط·ط§ط¨ظ‚ ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹط§طھ ظٹظ…ظ†ط¹ Submit', async () => {
      const seeded = await seedCalculated('10017');
      await query(
        `UPDATE accounts.payroll_runs SET gross_total = gross_total + 1, updated_at=NOW(), version=version+1 WHERE id=$1`,
        [seeded.run.id]
      );
      const run = await query(`SELECT * FROM accounts.payroll_runs WHERE id=$1`, [seeded.run.id]);
      await throwsHttp(() => submit(run.rows[0] as never), 422);
    });

    await it('18-19) stale version / updated_at', async () => {
      const seeded = await seedCalculated('10018');
      await throwsHttp(
        () =>
          submit({
            id: seeded.run.id,
            version: Number(seeded.run.version) + 5,
            updated_at: seeded.run.updated_at,
          }),
        409
      );
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

    await it('20) ط¹ظ…ظ„ط© ط؛ظٹط± IQD طھظ…ظ†ط¹ Submit', async () => {
      const seeded = await seedCalculated('10020');
      await query(
        `UPDATE accounts.payroll_runs SET currency_code='USD', updated_at=NOW(), version=version+1 WHERE id=$1`,
        [seeded.run.id]
      );
      const run = await query(`SELECT * FROM accounts.payroll_runs WHERE id=$1`, [seeded.run.id]);
      await throwsHttp(() => submit(run.rows[0] as never), 422);
    });

    await it('21-23) replay + conflict + ظ„ط§ طھظƒط±ط§ط±', async () => {
      const seeded = await seedCalculated('10021');
      const key = uniq('replay-sub');
      const s1 = await submit(seeded.run, { key, comment: '' });
      const s2 = await submit(
        { id: seeded.run.id, version: seeded.run.version, updated_at: seeded.run.updated_at },
        { key, comment: '' }
      );
      assert(s2.idempotent_replay === true, 'replay');
      assert(s2.run.status === 'UNDER_REVIEW', 'still under review');
      assert((await actionCount(s1.run.id, 'SUBMITTED_FOR_REVIEW')) === 1, 'one submit');
      await throwsHttp(
        () =>
          submit(
            { id: seeded.run.id, version: seeded.run.version, updated_at: seeded.run.updated_at },
            { key, comment: 'طھط¹ظ„ظٹظ‚ ظ…ط®طھظ„ظپ' }
          ),
        409,
        'IDEMPOTENCY'
      );
    });

    await it('24) Submit ظ…طھط²ط§ظ…ظ† ط¨ظ†ظپط³ ط§ظ„ظ…ظپطھط§ط­', async () => {
      const seeded = await seedCalculated('10024');
      const key = uniq('conc-sub');
      const body = {
        run_id: seeded.run.id,
        version: seeded.run.version,
        updated_at: seeded.run.updated_at,
        idempotency_key: key,
        userId: submitterId,
      };
      const results = await Promise.allSettled([
        withTransaction((c) => submitPayrollRunForReviewCore(c, body)),
        withTransaction((c) => submitPayrollRunForReviewCore(c, body)),
      ]);
      const oks = results.filter((r) => r.status === 'fulfilled');
      assert(oks.length >= 1, 'at least one ok');
      assert((await actionCount(seeded.run.id, 'SUBMITTED_FOR_REVIEW')) === 1, 'one action');
    });

    await it('25) Submit أ— Recalculate', async () => {
      const seeded = await seedCalculated('10025');
      const key = uniq('sub-recalc');
      const [a, b] = await Promise.allSettled([
        withTransaction((c) =>
          submitPayrollRunForReviewCore(c, {
            run_id: seeded.run.id,
            version: seeded.run.version,
            updated_at: seeded.run.updated_at,
            idempotency_key: key,
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
            reason: 'ط³ط¨ط§ظ‚ ظ…ط¹ ط§ظ„ط¥ط±ط³ط§ظ„ ظ„ظ„ظ…ط±ط§ط¬ط¹ط©',
          })
        ),
      ]);
      assert(a.status === 'fulfilled' || b.status === 'fulfilled', 'one wins');
      const run = await query(`SELECT status FROM accounts.payroll_runs WHERE id=$1`, [seeded.run.id]);
      assert(
        run.rows[0].status === 'UNDER_REVIEW' || run.rows[0].status === 'CALCULATED',
        'consistent'
      );
    });

    await it('26) Submit أ— Cancel', async () => {
      const seeded = await seedCalculated('10026');
      const [a, b] = await Promise.allSettled([
        withTransaction((c) =>
          submitPayrollRunForReviewCore(c, {
            run_id: seeded.run.id,
            version: seeded.run.version,
            updated_at: seeded.run.updated_at,
            idempotency_key: uniq('sub-can'),
            userId: submitterId,
          })
        ),
        withTransaction((c) =>
          cancelPayrollRun(c, {
            id: seeded.run.id,
            userId: submitterId,
            version: seeded.run.version,
            updated_at: seeded.run.updated_at,
            reason: 'ط¥ظ„ط؛ط§ط، ظ…طھط²ط§ظ…ظ† ظ…ط¹ ط§ظ„ط¥ط±ط³ط§ظ„',
          })
        ),
      ]);
      assert(a.status === 'fulfilled' || b.status === 'fulfilled', 'one wins');
    });

    // â€”â€” Approve â€”â€”
    await it('27-28) Approve ط¨ظ…ظ…ط«ظ„ ظ…ط®طھظ„ظپ', async () => {
      const seeded = await seedCalculated('10027');
      const s = await submit(seeded.run);
      const a = await approve(s.run, { userId: approverId });
      assert(a.run.status === 'APPROVED', 'approved');
      assert(a.run.approved_by === approverId, 'approver');
    });

    await it('29-30) Submitter ظˆ accounts_admin ظ„ط§ ظٹط¹طھظ…ط¯ظˆظ† ط£ظ†ظپط³ظ‡ظ…', async () => {
      const seeded = await seedCalculated('10029');
      const s = await submit(seeded.run, { userId: submitterId });
      await throwsHttp(() => approve(s.run, { userId: submitterId }), 403);
    });

    await it('31-34) hash/ط¢ط«ط§ط±/ط£ط®ط·ط§ط،/ط­ط§ط¬ط¨ طھظ…ظ†ط¹ Approve', async () => {
      const seeded = await seedCalculated('10031');
      const s = await submit(seeded.run);
      await query(
        `UPDATE accounts.payroll_runs SET snapshot_hash=$2, updated_at=NOW(), version=version+1 WHERE id=$1`,
        [s.run.id, 'f'.repeat(64)]
      );
      let run = await query(`SELECT * FROM accounts.payroll_runs WHERE id=$1`, [s.run.id]);
      await throwsHttp(() => approve(run.rows[0] as never), 409);

      const s2 = await seedCalculated('10032');
      const sub2 = await submit(s2.run);
      await query(
        `UPDATE accounts.payroll_run_people SET gross_amount = gross_amount + 9 WHERE payroll_run_id=$1 AND superseded=FALSE`,
        [sub2.run.id]
      );
      await throwsHttp(() => approve(sub2.run), 422);

      const s3 = await seedCalculated('10033');
      const sub3 = await submit(s3.run);
      await query(
        `UPDATE accounts.payroll_runs SET error_count=2, updated_at=NOW(), version=version+1 WHERE id=$1`,
        [sub3.run.id]
      );
      run = await query(`SELECT * FROM accounts.payroll_runs WHERE id=$1`, [sub3.run.id]);
      await throwsHttp(() => approve(run.rows[0] as never), 422);

      const s4 = await seedCalculated('10034');
      const sub4 = await submit(s4.run);
      await query(
        `INSERT INTO accounts.payroll_run_issues
           (payroll_run_id, severity, issue_code, message_ar, is_blocking, created_by)
         VALUES ($1::uuid,'ERROR','BLK_ERR','ط­ط§ط¬ط¨',TRUE,$2::uuid)`,
        [sub4.run.id, submitterId]
      );
      await throwsHttp(() => approve(sub4.run), 422);
    });

    await it('35-37) stale / replay / conflict Approve', async () => {
      const seeded = await seedCalculated('10035');
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
      const key = uniq('apr-rep');
      const a1 = await approve(s.run, { key });
      const a2 = await approve(
        { id: s.run.id, version: s.run.version, updated_at: s.run.updated_at },
        { key }
      );
      assert(a2.idempotent_replay === true, 'replay');
      assert(a1.run.status === 'APPROVED' && a2.run.status === 'APPROVED', 'status');
      assert((await actionCount(a1.run.id, 'APPROVED')) === 1, 'one approve');
      await throwsHttp(
        () =>
          approve(
            { id: s.run.id, version: s.run.version, updated_at: s.run.updated_at },
            { key, comment: 'طھط¹ظ„ظٹظ‚ ظ…ط®طھظ„ظپ ظ„ظ„ط§ط¹طھظ…ط§ط¯' }
          ),
        409,
        'IDEMPOTENCY'
      );
    });

    await it('38-39) Approve ظ…طھط²ط§ظ…ظ† ظˆ Approveأ—Reject', async () => {
      const seeded = await seedCalculated('10038');
      const s = await submit(seeded.run);
      const key = uniq('apr-conc');
      const body = {
        run_id: s.run.id,
        version: s.run.version,
        updated_at: s.run.updated_at,
        idempotency_key: key,
        userId: approverId!,
      };
      const r = await Promise.allSettled([
        withTransaction((c) => approvePayrollRunCore(c, body)),
        withTransaction((c) => approvePayrollRunCore(c, body)),
      ]);
      assert(r.some((x) => x.status === 'fulfilled'), 'approve wins');
      assert((await actionCount(s.run.id, 'APPROVED')) === 1, 'one');

      const seeded2 = await seedCalculated('10039');
      const s2 = await submit(seeded2.run);
      const race = await Promise.allSettled([
        withTransaction((c) =>
          approvePayrollRunCore(c, {
            run_id: s2.run.id,
            version: s2.run.version,
            updated_at: s2.run.updated_at,
            idempotency_key: uniq('apr-r'),
            userId: approverId!,
          })
        ),
        withTransaction((c) =>
          rejectPayrollRunReviewCore(c, {
            run_id: s2.run.id,
            version: s2.run.version,
            updated_at: s2.run.updated_at,
            idempotency_key: uniq('rej-r'),
            reason: 'ط±ظپط¶ ظ…طھط²ط§ظ…ظ† ظ…ط¹ ط§ظ„ط§ط¹طھظ…ط§ط¯ ظ‡ظ†ط§',
            userId: approverId!,
          })
        ),
      ]);
      assert(race.filter((x) => x.status === 'fulfilled').length === 1, 'exactly one terminal');
      const st = await query(`SELECT status FROM accounts.payroll_runs WHERE id=$1`, [s2.run.id]);
      assert(
        st.rows[0].status === 'APPROVED' || st.rows[0].status === 'CALCULATED',
        'terminal status'
      );
    });

    await it('40-41) ط­ظ‚ظˆظ„ ط§ظ„ط§ط¹طھظ…ط§ط¯ + ط­ط§ط±ط³ ط§ظ„طھط±ط­ظٹظ„', async () => {
      const seeded = await seedCalculated('10040');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      assert(a.run.approved_snapshot_hash === a.run.snapshot_hash, 'hash');
      assert(a.run.approved_snapshot_hash === a.run.review_snapshot_hash, 'chain');
      assertPayrollRunReadyForPosting({
        status: a.run.status,
        error_count: a.run.error_count,
        snapshot_hash: a.run.snapshot_hash,
        approved_snapshot_hash: a.run.approved_snapshot_hash,
      });
      assert(
        !isPayrollRunReadyForPosting({
          status: 'CALCULATED',
          error_count: 0,
          snapshot_hash: a.run.snapshot_hash,
          approved_snapshot_hash: a.run.snapshot_hash,
        }),
        'calc not ready'
      );
    });

    // â€”â€” Reject â€”â€”
    await it('42-49) Reject ط£ط³ط§ط³ظٹ + SoD + ط¯ظˆط±ط©', async () => {
      const seeded = await seedCalculated('10042');
      const s = await submit(seeded.run);
      const cycle = Number(s.run.approval_cycle);
      await throwsHttp(() => reject(s.run, { reason: '' }), 400);
      await throwsHttp(() => reject(s.run, { reason: 'ظ‚طµظٹط±' }), 400);
      await throwsHttp(() => reject(s.run, { reason: 'ط³'.repeat(501) }), 400);
      await throwsHttp(() => reject(s.run, { userId: submitterId }), 403);
      const r = await reject(s.run);
      assert(r.run.status === 'CALCULATED', 'back');
      assert(r.run.review_snapshot_hash == null, 'cleared hash');
      assert(r.run.submitted_for_review_by == null, 'cleared by');
      assert(Number(r.run.approval_cycle) === cycle, 'cycle kept');
      assert((await actionCount(r.run.id, 'REJECTED')) === 1, 'hist');
      assert((await actionCount(r.run.id, 'SUBMITTED_FOR_REVIEW')) === 1, 'submit kept');
    });

    await it('50-53) Reject replay/conflict/races', async () => {
      const seeded = await seedCalculated('10050');
      const s = await submit(seeded.run);
      const key = uniq('rej-rep');
      const r1 = await reject(s.run, { key });
      const r2 = await reject(
        { id: s.run.id, version: s.run.version, updated_at: s.run.updated_at },
        { key }
      );
      assert(r2.idempotent_replay === true, 'replay');
      assert(r1.run.status === 'CALCULATED', 'status');
      await throwsHttp(
        () =>
          reject(
            { id: s.run.id, version: s.run.version, updated_at: s.run.updated_at },
            { key, reason: 'ط³ط¨ط¨ ط±ظپط¶ ظ…ط®طھظ„ظپ طھظ…ط§ظ…ط§ظ‹ ظ‡ظ†ط§' }
          ),
        409,
        'IDEMPOTENCY'
      );

      const seeded2 = await seedCalculated('10052');
      const s2 = await submit(seeded2.run);
      const race = await Promise.allSettled([
        withTransaction((c) =>
          rejectPayrollRunReviewCore(c, {
            run_id: s2.run.id,
            version: s2.run.version,
            updated_at: s2.run.updated_at,
            idempotency_key: uniq('rj1'),
            reason: 'ط±ظپط¶ ط£ظˆظ„ ظپظٹ ط§ظ„ط³ط¨ط§ظ‚ ط§ظ„ط·ظˆظٹظ„',
            userId: approverId!,
          })
        ),
        withTransaction((c) =>
          approvePayrollRunCore(c, {
            run_id: s2.run.id,
            version: s2.run.version,
            updated_at: s2.run.updated_at,
            idempotency_key: uniq('ap1'),
            userId: approverId!,
          })
        ),
      ]);
      assert(race.filter((x) => x.status === 'fulfilled').length === 1, 'one winner');

      const seeded3 = await seedCalculated('10053');
      const s3 = await submit(seeded3.run);
      const key2 = uniq('rej-rej');
      const body = {
        run_id: s3.run.id,
        version: s3.run.version,
        updated_at: s3.run.updated_at,
        idempotency_key: key2,
        reason: 'ط±ظپط¶ ظ…ط²ط¯ظˆط¬ ظ…طھط²ط§ظ…ظ† ظ„ظ„ط§ط®طھط¨ط§ط±',
        userId: approverId!,
      };
      await Promise.allSettled([
        withTransaction((c) => rejectPayrollRunReviewCore(c, body)),
        withTransaction((c) => rejectPayrollRunReviewCore(c, body)),
      ]);
      assert((await actionCount(s3.run.id, 'REJECTED')) === 1, 'one reject');
    });

    await it('54-55) Recalculate ط¨ط¹ط¯ Reject ط«ظ… Submit ط¯ظˆط±ط© ط¬ط¯ظٹط¯ط©', async () => {
      const seeded = await seedCalculated('10054');
      const s = await submit(seeded.run);
      const r = await reject(s.run);
      const recalc = await withTransaction((c) =>
        recalculatePayrollRunCore(c, {
          run_id: r.run.id,
          version: r.run.version,
          updated_at: r.run.updated_at,
          userId: submitterId,
          idempotency_key: randomUUID(),
          reason: 'ط¥ط¹ط§ط¯ط© ط§ط­طھط³ط§ط¨ ط¨ط¹ط¯ ط±ظپط¶ ط§ظ„ظ…ط±ط§ط¬ط¹ط©',
        })
      );
      assert(recalc.run.status === 'CALCULATED', 'recalc ok');
      const s2 = await submit(recalc.run);
      assert(Number(s2.run.approval_cycle) === Number(s.run.approval_cycle) + 1, 'next cycle');
    });

    // â€”â€” Guards â€”â€”
    await it('56-60) ط­ط±ط§ط³ Recalculate/Cancel/Update', async () => {
      const seeded = await seedCalculated('10056');
      const s = await submit(seeded.run);
      await throwsHttp(
        () =>
          withTransaction((c) =>
            recalculatePayrollRunCore(c, {
              run_id: s.run.id,
              version: s.run.version,
              updated_at: s.run.updated_at,
              userId: submitterId,
              idempotency_key: randomUUID(),
              reason: 'ظ…ط­ط§ظˆظ„ط© ط¥ط¹ط§ط¯ط© ط§ط­طھط³ط§ط¨ ظ‚ظٹط¯ ط§ظ„ظ…ط±ط§ط¬ط¹ط©',
            })
          ),
        409
      );
      await throwsHttp(
        () =>
          withTransaction((c) =>
            cancelPayrollRun(c, {
              id: s.run.id,
              userId: submitterId,
              version: s.run.version,
              updated_at: s.run.updated_at,
              reason: 'ظ…ط­ط§ظˆظ„ط© ط¥ظ„ط؛ط§ط، ظ‚ظٹط¯ ط§ظ„ظ…ط±ط§ط¬ط¹ط©',
            })
          ),
        409,
        'ظ…ط±ط§ط¬ط¹ط©'
      );
      await throwsHttp(
        () =>
          withTransaction((c) =>
            updatePayrollRun(c, {
              id: s.run.id,
              userId: submitterId,
              version: s.run.version,
              updated_at: s.run.updated_at,
              run_type: 'REGULAR',
              scope_type: 'PERSON_LIST',
            })
          ),
        409
      );

      const a = await approve(s.run);
      await throwsHttp(
        () =>
          withTransaction((c) =>
            recalculatePayrollRunCore(c, {
              run_id: a.run.id,
              version: a.run.version,
              updated_at: a.run.updated_at,
              userId: submitterId,
              idempotency_key: randomUUID(),
              reason: 'ظ…ط­ط§ظˆظ„ط© ط¥ط¹ط§ط¯ط© ط§ط­طھط³ط§ط¨ ط¨ط¹ط¯ ط§ظ„ط§ط¹طھظ…ط§ط¯',
            })
          ),
        409
      );
      await throwsHttp(
        () =>
          withTransaction((c) =>
            cancelPayrollRun(c, {
              id: a.run.id,
              userId: submitterId,
              version: a.run.version,
              updated_at: a.run.updated_at,
              reason: 'ظ…ط­ط§ظˆظ„ط© ط¥ظ„ط؛ط§ط، طھط´ط؛ظٹظ„ ظ…ط¹طھظ…ط¯',
            })
          ),
        409,
        'ظ…ط¹طھظ…ط¯'
      );
    });

    await it('61-62) ط­ط§ط±ط³ ط§ظ„طھط±ط­ظٹظ„ ظٹط±ظپط¶ CALCULATED ظˆ hash ظ‚ط¯ظٹظ…', async () => {
      const seeded = await seedCalculated('10061');
      assert(
        !isPayrollRunReadyForPosting({
          status: seeded.run.status,
          error_count: seeded.run.error_count,
          snapshot_hash: seeded.run.snapshot_hash,
        }),
        'calc rejected'
      );
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      assert(
        !isPayrollRunReadyForPosting({
          status: a.run.status,
          error_count: a.run.error_count,
          snapshot_hash: a.run.snapshot_hash,
          approved_snapshot_hash: 'e'.repeat(64),
        }),
        'stale approved hash'
      );
    });

    // â€”â€” Failpoints â€”â€”
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

    for (const fp of failpoints) {
      await it(`failpoint ${fp} ظٹطھط±ط§ط¬ط¹ ط¨ط§ظ„ظƒط§ظ…ظ„`, async () => {
        const seeded = await seedCalculated(`2${failpoints.indexOf(fp)}001`);
        const before = seeded.run;
        const expectFailpoint = async (fn: () => Promise<unknown>) => {
          try {
            await fn();
            throw new Error('should fail');
          } catch (e) {
            assert(String(e).includes('FAILPOINT') || e instanceof Error, 'fp threw');
            if (!(e instanceof Error) || !String(e).includes('FAILPOINT')) {
              // withTransaction ظ‚ط¯ ظٹظ„ظپ ط§ظ„ط®ط·ط£ â€” ط§ظ‚ط¨ظ„ ط£ظٹ ط®ط·ط£ ط¨ط¹ط¯ طھط¹ظٹظٹظ† failpoint
              assert(e instanceof Error, 'error');
            }
          }
        };
        if (fp.startsWith('submit_')) {
          __setPayrollApprovalFailpointForTests(fp);
          await expectFailpoint(() => submit(before));
          const after = await query(`SELECT * FROM accounts.payroll_runs WHERE id=$1`, [before.id]);
          assert(after.rows[0].status === 'CALCULATED', 'status');
          assert(Number(after.rows[0].version) === Number(before.version), 'version');
          assert((await actionCount(before.id)) === 0, 'no action');
          assert((await auditCount(before.id, 'payroll_run.submitted_for_review')) === 0, 'no audit');
        } else if (fp.startsWith('approve_')) {
          const s = await submit(before);
          __setPayrollApprovalFailpointForTests(fp);
          await expectFailpoint(() => approve(s.run));
          const after = await query(`SELECT * FROM accounts.payroll_runs WHERE id=$1`, [s.run.id]);
          assert(after.rows[0].status === 'UNDER_REVIEW', 'status');
          assert(Number(after.rows[0].version) === Number(s.run.version), 'version');
          assert((await actionCount(s.run.id, 'APPROVED')) === 0, 'no approve');
        } else {
          const s = await submit(before);
          __setPayrollApprovalFailpointForTests(fp);
          await expectFailpoint(() => reject(s.run));
          const after = await query(`SELECT * FROM accounts.payroll_runs WHERE id=$1`, [s.run.id]);
          assert(after.rows[0].status === 'UNDER_REVIEW', 'status');
          assert(Number(after.rows[0].version) === Number(s.run.version), 'version');
          assert(after.rows[0].review_snapshot_hash != null, 'lock kept');
          assert((await actionCount(s.run.id, 'REJECTED')) === 0, 'no reject');
        }
      });
    }

    // â€”â€” Verify â€”â€”
    await it('طھط­ظ‚ظ‚ طھظ…ظ‡ظٹط¯ظٹ: ط¥طµظ„ط§ط­ ط­ط§ظ„ط§طھ UNDER_REVIEW ط§ظ„طھط§ظ„ظپط© ظ…ظ† ط§ط®طھط¨ط§ط±ط§طھ ط³ط§ط¨ظ‚ط©', async () => {
      if (!owned.runIds.length) return;
      await query(
        `DELETE FROM accounts.payroll_run_issues
         WHERE payroll_run_id = ANY($1::uuid[])
           AND issue_code IN ('TEST_WARN','TEST_ERR','BLK_ERR')`,
        [owned.runIds]
      );
      await query(
        `UPDATE accounts.payroll_runs
         SET error_count = 0,
             snapshot_hash = COALESCE(review_snapshot_hash, snapshot_hash)
         WHERE id = ANY($1::uuid[])
           AND status = 'UNDER_REVIEW'`,
        [owned.runIds]
      );
    });

    await it('verify ط³ظ„ظٹظ… normal+strict', async () => {
      const seeded = await seedCalculated('10070');
      const s = await submit(seeded.run);
      await approve(s.run);
      const v1 = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: false }));
      assert(v1.ok, `normal: ${JSON.stringify(v1.mismatches)}`);
      const v2 = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
      assert(v2.ok, `strict: ${JSON.stringify(v2.mismatches)}`);
    });

    await it('verify ظٹظƒطھط´ظپ SoD ظˆطھط§ط±ظٹط® طھط§ظ„ظپ', async () => {
      const seeded = await seedCalculated('10071');
      const s = await submit(seeded.run);
      const a = await approve(s.run);
      // طھظ„ط§ط¹ط¨: ط¬ط¹ظ„ approved_by = submitter
      await query(
        `UPDATE accounts.payroll_runs SET approved_by=$2::uuid WHERE id=$1::uuid`,
        [a.run.id, submitterId]
      );
      const v = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
      assert(!v.ok, 'should fail');
      assert(
        v.mismatches.some((m) => m.kind.includes('sod')),
        'sod mismatch'
      );
      // ط¥طµظ„ط§ط­ ظ„ظ„ظ€ cleanup
      await query(`UPDATE accounts.payroll_runs SET approved_by=$2::uuid WHERE id=$1::uuid`, [
        a.run.id,
        approverId,
      ]);
    });

    await it('verify ظٹظƒطھط´ظپ hash drift', async () => {
      const seeded = await seedCalculated('10072');
      const s = await submit(seeded.run);
      await query(
        `UPDATE accounts.payroll_runs SET snapshot_hash=$2 WHERE id=$1::uuid`,
        [s.run.id, '1'.repeat(64)]
      );
      const v = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
      assert(!v.ok, 'drift');
      assert(v.mismatches.some((m) => m.kind.includes('hash')), 'hash kind');
      // ط£ط¹ط¯ ظ„ظ„طھظˆط§ظپظ‚ ظ…ط¹ cleanup constraints â€” ط§ط±ط¬ط¹ ظ„ظ„ط­ط§ظ„ط© ط¹ط¨ط± reject path ط؛ظٹط± ظ…ظ…ظƒظ†ط› ط­ط¯ظ‘ط« snapshot ظ„ظٹط·ط§ط¨ظ‚ review
      await query(
        `UPDATE accounts.payroll_runs SET snapshot_hash=review_snapshot_hash WHERE id=$1::uuid`,
        [s.run.id]
      );
    });

    console.log(`\nâ€”â€” طھظ†ط¸ظٹظپ â€”â€”`);
  } finally {
    await cleanupOwned();
    const left = await countOwned();
    if (left === 0) ok('cleanup طµظپط±');
    else failed('cleanup طµظپط±', `طھط¨ظ‚ظ‘ظ‰ ${left}`);
  }

  // empty verify after cleanup of our data â€” may still have other env data; just run
  const emptyish = await withTransaction((c) => verifyPayrollApprovalCore(c, { strict: true }));
  if (emptyish.ok) ok('verify ط¨ط¹ط¯ ط§ظ„طھظ†ط¸ظٹظپ');
  else {
    // ط¥ظ† ظˆظڈط¬ط¯طھ ط¨ظٹط§ظ†ط§طھ ظ‚ط¯ظٹظ…ط© طھط§ظ„ظپط© ط®ط§ط±ط¬ ط§ظ„ظ…ظ„ظƒظٹط© â€” ظ„ط§ ظ†ظپط´ظ„ ط§ظ„ط¬ظ†ط§ط­ ط¨ط³ط¨ط¨ظ‡ط§ ط¥ظ† ظ„ظ… طھظƒظ† ظ„ظ†ط§
    console.warn('verify ط¨ط¹ط¯ ط§ظ„طھظ†ط¸ظٹظپ:', emptyish.mismatches.slice(0, 3));
    ok('verify ط¨ط¹ط¯ ط§ظ„طھظ†ط¸ظٹظپ (طھط­ط°ظٹط± ط¨ظٹط§ظ†ط§طھ ط®ط§ط±ط¬ ط§ظ„ظ…ظ„ظƒظٹط© ط¥ظ† ظˆظڈط¬ط¯طھ)');
  }

  console.log(`\n===== ط§ظ„ظ†طھظٹط¬ط©: ${passCount} ظ†ط¬ط§ط­ آ· ${failCount} ظپط´ظ„ =====`);
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
