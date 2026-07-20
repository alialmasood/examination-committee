/**
 * اختبارات HTTP لتكامل قرار اعتماد/رفض الرواتب 9.B.3
 * npm run test:payroll-approval-decision-integration
 *
 * عزل: ownership token + cleanupOwned في finally.
 * تشغيل مرتين يجب أن يترك 0 صفوف مملوكة.
 *
 * سلوكيات الصفحة (React) تُغطّى عبر HTTP + فحوصات المساعدات النقية
 * (CAP.APPROVE/REJECT / runApproveUrl/runRejectUrl / approveDecisionErrorMsg) — بلا RTL.
 */
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { generateAccessToken } from '../lib/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import {
  ACCOUNTS_CLERK_ROLE_CODE,
  ACCOUNTS_VIEWER_ROLE_CODE,
} from '../lib/accounts/student-receivables-access';
import {
  PAYROLL_CAPABILITIES,
  __clearPayrollCapabilitiesOverrideForTests,
  __setPayrollCapabilitiesOverrideForTests,
  grantAccountsPlatformRole,
} from '../lib/accounts/payroll-access';
import {
  __clearPayrollApprovalFailpointForTests,
  __setPayrollApprovalFailpointForTests,
} from '../lib/accounts/payroll-approval-failpoints';
import {
  buildApprovalRequestKeyHash,
  buildApprovalRequestPayloadHash,
  normalizeApprovalIdempotencyKey,
  normalizeApprovalComment,
  normalizeApprovalRejectReason,
} from '../lib/accounts/payroll-approval-idempotency';
import { createPayrollCalendar } from '../lib/accounts/payroll-calendars';
import { createPayrollComponent } from '../lib/accounts/payroll-components';
import { createPayrollComponentAssignment } from '../lib/accounts/payroll-component-assignments';
import {
  createPayrollContract,
  transitionPayrollContract,
} from '../lib/accounts/payroll-contracts';
import { createPayrollPerson } from '../lib/accounts/payroll-people';
import { createPayrollPeriod } from '../lib/accounts/payroll-periods';
import { createPayrollRun, loadPayrollRun } from '../lib/accounts/payroll-runs';
import { addScopeMember } from '../lib/accounts/payroll-run-scope';
import { loadRunCalculationArtifacts } from '../lib/accounts/payroll-run-snapshots';
import { withTransaction } from '../lib/accounts/with-transaction';
import { CAP, runApproveUrl, runRejectUrl, approveDecisionErrorMsg, rejectDecisionErrorMsg } from '../../app/accounts/payroll/_lib';

import { POST as approvePost } from '../../app/api/accounts/payroll/runs/[id]/approve/route';
import { POST as rejectPost } from '../../app/api/accounts/payroll/runs/[id]/reject/route';
import { POST as submitReviewPost } from '../../app/api/accounts/payroll/runs/[id]/submit-review/route';
import { GET as runGet, PATCH as runPatch } from '../../app/api/accounts/payroll/runs/[id]/route';
import { POST as calculatePost } from '../../app/api/accounts/payroll/runs/[id]/calculate/route';
import { POST as cancelPost } from '../../app/api/accounts/payroll/runs/[id]/cancel/route';
import { POST as recalculatePost } from '../../app/api/accounts/payroll/runs/[id]/recalculate/route';

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
    __clearPayrollApprovalFailpointForTests();
    __clearPayrollCapabilitiesOverrideForTests();
  }
}
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const owned = {
  calendarIds: [] as string[],
  periodIds: [] as string[],
  runIds: [] as string[],
  personIds: [] as string[],
  contractIds: [] as string[],
  componentIds: [] as string[],
  pcaIds: [] as string[],
};

async function cleanupOwned() {
  if (owned.runIds.length) {
    await query(
      `DELETE FROM accounts.payroll_run_approval_actions WHERE payroll_run_id = ANY($1::uuid[])`,
      [owned.runIds]
    );
    await query(
      `DELETE FROM accounts.financial_audit_log
       WHERE entity_type = 'payroll_run' AND entity_id = ANY($1::uuid[])`,
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
      (SELECT COUNT(*)::int FROM accounts.payroll_run_approval_actions WHERE payroll_run_id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_people WHERE id=ANY($4::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_components WHERE id=ANY($5::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.financial_audit_log
         WHERE entity_type='payroll_run' AND entity_id=ANY($3::uuid[])) AS n`,
    [
      owned.calendarIds,
      owned.periodIds,
      owned.runIds,
      owned.personIds,
      owned.componentIds,
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

async function latestAudit(runId: string, action: string) {
  const r = await query(
    `SELECT id, new_values, old_values, description
     FROM accounts.financial_audit_log
     WHERE entity_type='payroll_run' AND entity_id=$1::uuid AND action=$2
     ORDER BY created_at DESC LIMIT 1`,
    [runId, action]
  );
  return r.rows[0] as
    | {
        id: string;
        new_values: Record<string, unknown> | null;
        old_values: Record<string, unknown> | null;
        description: string | null;
      }
    | undefined;
}

async function actionCount(runId: string, action: string) {
  const r = await query(
    `SELECT COUNT(*)::int n FROM accounts.payroll_run_approval_actions
     WHERE payroll_run_id=$1::uuid AND action=$2`,
    [runId, action]
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function upsertUser(username: string, withAccounts: boolean): Promise<string> {
  const hash = await bcrypt.hash('test-approval-decision-int-pass', 10);
  const res = await query(
    `INSERT INTO student_affairs.users (username, email, full_name, password_hash, is_active)
     VALUES ($1,$2,$3,$4,TRUE)
     ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, is_active=TRUE
     RETURNING id`,
    [username, `${username}@test.local`, `اختبار ${username}`, hash]
  );
  const userId = res.rows[0].id as string;
  if (withAccounts) {
    await query(
      `INSERT INTO student_affairs.user_systems (user_id, system_id)
       SELECT $1::uuid, s.id FROM student_affairs.systems s WHERE s.code='ACCOUNTS'
       ON CONFLICT (user_id, system_id) DO NOTHING`,
      [userId]
    );
  }
  return userId;
}

function authReq(
  url: string,
  userId: string,
  username: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> }
): NextRequest {
  const token = generateAccessToken(userId, username);
  const headers: Record<string, string> = {
    cookie: `access_token=${token}`,
    ...(init?.headers ?? {}),
  };
  if (init?.body && !headers['content-type']) headers['content-type'] = 'application/json';
  return new NextRequest(url, { method: init?.method, body: init?.body, headers });
}

function isoAt(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return new Date(String(v)).toISOString();
}

type RunLike = { id: string; version: number; updated_at: unknown };

async function postApprove(
  run: RunLike | string,
  userId: string,
  username: string,
  opts: {
    key?: string;
    comment?: string;
    version?: unknown;
    updated_at?: unknown;
    confirmation?: boolean;
    omitKey?: boolean;
  } = {}
) {
  const runId = typeof run === 'string' ? run : run.id;
  const body: Record<string, unknown> = {};
  if (opts.confirmation !== undefined) body.confirmation = opts.confirmation;
  else body.confirmation = true;
  if (opts.version !== undefined) body.version = opts.version;
  else if (typeof run !== 'string') body.version = run.version;
  if (opts.updated_at !== undefined) body.updated_at = opts.updated_at;
  else if (typeof run !== 'string') body.updated_at = isoAt(run.updated_at);
  if (!opts.omitKey) body.idempotency_key = opts.key ?? randomUUID();
  if (opts.comment !== undefined) body.comment = opts.comment;
  return approvePost(
    authReq(`http://localhost/api/accounts/payroll/runs/${runId}/approve`, userId, username, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}

async function postReject(
  run: RunLike | string,
  userId: string,
  username: string,
  opts: {
    key?: string;
    reason?: string;
    version?: unknown;
    updated_at?: unknown;
    confirmation?: boolean;
    omitKey?: boolean;
  } = {}
) {
  const runId = typeof run === 'string' ? run : run.id;
  const body: Record<string, unknown> = {};
  if (opts.confirmation !== undefined) body.confirmation = opts.confirmation;
  else body.confirmation = true;
  if (opts.version !== undefined) body.version = opts.version;
  else if (typeof run !== 'string') body.version = run.version;
  if (opts.updated_at !== undefined) body.updated_at = opts.updated_at;
  else if (typeof run !== 'string') body.updated_at = isoAt(run.updated_at);
  if (!opts.omitKey) body.idempotency_key = opts.key ?? randomUUID();
  body.reason = opts.reason ?? 'سبب رفض واضح لاختبار التكامل بعد المراجعة';
  return rejectPost(
    authReq(`http://localhost/api/accounts/payroll/runs/${runId}/reject`, userId, username, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}

async function postSubmitReview(
  run: RunLike | string,
  userId: string,
  username: string,
  opts: { key?: string; comment?: string; version?: unknown; updated_at?: unknown } = {}
) {
  const runId = typeof run === 'string' ? run : run.id;
  const body: Record<string, unknown> = {
    confirmation: true,
    idempotency_key: opts.key ?? randomUUID(),
  };
  if (opts.version !== undefined) body.version = opts.version;
  else if (typeof run !== 'string') body.version = run.version;
  if (opts.updated_at !== undefined) body.updated_at = opts.updated_at;
  else if (typeof run !== 'string') body.updated_at = isoAt(run.updated_at);
  if (opts.comment !== undefined) body.comment = opts.comment;
  return submitReviewPost(
    authReq(`http://localhost/api/accounts/payroll/runs/${runId}/submit-review`, userId, username, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}

async function postCalculate(
  runId: string,
  userId: string,
  username: string,
  body: {
    confirmation?: boolean;
    version?: unknown;
    updated_at?: unknown;
    idempotency_key?: string;
  }
) {
  return calculatePost(
    authReq(`http://localhost/api/accounts/payroll/runs/${runId}/calculate`, userId, username, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}

async function postCancel(
  runId: string,
  userId: string,
  username: string,
  body: { version: unknown; updated_at: unknown; reason: string }
) {
  return cancelPost(
    authReq(`http://localhost/api/accounts/payroll/runs/${runId}/cancel`, userId, username, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}

async function postRecalculate(
  run: RunLike | string,
  userId: string,
  username: string,
  opts: { key?: string; reason?: string; version?: unknown; updated_at?: unknown } = {}
) {
  const runId = typeof run === 'string' ? run : run.id;
  const body: Record<string, unknown> = {
    confirmation: true,
    idempotency_key: opts.key ?? randomUUID(),
    reason: opts.reason ?? 'تعديل الراتب الأساسي بعد رفض المراجعة',
  };
  if (opts.version !== undefined) body.version = opts.version;
  else if (typeof run !== 'string') body.version = run.version;
  if (opts.updated_at !== undefined) body.updated_at = opts.updated_at;
  else if (typeof run !== 'string') body.updated_at = isoAt(run.updated_at);
  return recalculatePost(
    authReq(`http://localhost/api/accounts/payroll/runs/${runId}/recalculate`, userId, username, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}

async function getRun(runId: string, userId: string, username: string) {
  return runGet(authReq(`http://localhost/api/accounts/payroll/runs/${runId}`, userId, username), {
    params: Promise.resolve({ id: runId }),
  });
}

async function patchRun(
  runId: string,
  userId: string,
  username: string,
  body: Record<string, unknown>
) {
  return runPatch(
    authReq(`http://localhost/api/accounts/payroll/runs/${runId}`, userId, username, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}

function jsonHasRawKey(obj: unknown, rawKey: string): boolean {
  return JSON.stringify(obj ?? {}).includes(rawKey);
}

async function main() {
  console.log('===== اختبارات تكامل قرار اعتماد/رفض الرواتب 9.B.3 =====');
  const token = `AD${Date.now().toString(36).toUpperCase()}`;
  let seq = 0;
  const uniq = (p: string) => {
    seq += 1;
    return `${p}-${token}-${seq}`;
  };

  const user = await query(
    `SELECT u.id, u.username FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id=u.id
     JOIN student_affairs.systems s ON s.id=us.system_id
     WHERE s.code='ACCOUNTS' AND u.is_active
     ORDER BY CASE WHEN LOWER(u.username)='accounts' THEN 0 ELSE 1 END, u.created_at LIMIT 1`
  );
  if (!user.rows[0]) {
    failed('إعداد: لا مستخدم حسابات');
    await closePool();
    return;
  }
  const submitterId = user.rows[0].id as string;
  const submitterUser = user.rows[0].username as string;
  await grantAccountsAdminRole(submitterId);

  const approverUser = `test-ad-approver-${token.toLowerCase()}`;
  const clerkUser = `test-ad-clerk-${token.toLowerCase()}`;
  const viewerUser = `test-ad-viewer-${token.toLowerCase()}`;
  const approverId = await upsertUser(approverUser, true);
  const clerkId = await upsertUser(clerkUser, true);
  const viewerId = await upsertUser(viewerUser, true);
  await grantAccountsAdminRole(approverId);
  await grantAccountsPlatformRole(clerkId, ACCOUNTS_CLERK_ROLE_CODE);
  await grantAccountsPlatformRole(viewerId, ACCOUNTS_VIEWER_ROLE_CODE);

  let fy = await query(
    `SELECT id FROM accounts.fiscal_years WHERE status='ACTIVE' ORDER BY is_default DESC, start_date DESC LIMIT 1`
  );
  if (!fy.rows[0]) {
    fy = await query(
      `INSERT INTO accounts.fiscal_years (code,name_ar,start_date,end_date,status,is_default,created_by)
       VALUES ($1,'سنة تكامل قرار اعتماد','2025-01-01','2025-12-31','ACTIVE',FALSE,$2) RETURNING id`,
      [uniq('ADFY'), submitterId]
    );
  }
  const fiscalYearId = fy.rows[0].id as string;

  const mkCalendar = async (currency = 'IQD') => {
    const cal = await withTransaction((c) =>
      createPayrollCalendar(c, {
        code: uniq('ADCAL'),
        name_ar: 'تقويم تكامل قرار اعتماد',
        calendar_type: 'MONTHLY',
        currency_code: currency,
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
        name_ar: 'فترة تكامل قرار اعتماد',
        start_date: '2025-01-01',
        end_date: '2025-01-31',
        fiscal_year_id: fiscalYearId,
        created_by: submitterId,
      })
    );
    owned.periodIds.push(p.id);
    return p;
  };
  const mkPerson = async (over: Record<string, unknown> = {}) => {
    const p = await withTransaction((c) =>
      createPayrollPerson(c, {
        full_name_ar: 'شخص تكامل قرار اعتماد',
        person_type: 'EMPLOYEE',
        default_currency_code: 'IQD',
        effective_from: '2025-01-01',
        created_by: submitterId,
        ...over,
      })
    );
    owned.personIds.push(p.id);
    return p;
  };
  const mkContract = async (personId: string, base = '1000000', currency = 'IQD') => {
    return withTransaction(async (client) => {
      const draft = await createPayrollContract(client, {
        payroll_person_id: personId,
        compensation_basis: 'MONTHLY_FIXED',
        base_amount: base,
        currency_code: currency,
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
  };
  const mkFixedComponent = async (amount = '100000') => {
    const comp = await withTransaction((c) =>
      createPayrollComponent(c, {
        component_code: uniq('ADFIX'),
        name_ar: 'بدل ثابت تكامل قرار',
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
        percentage: over.percentage,
        effective_from: '2025-01-01',
        created_by: submitterId,
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
        created_by: submitterId,
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
        userId: submitterId,
        version: run.version,
        updated_at: run.updated_at,
      });
      return r.run;
    });
    return run;
  };

  const readyCalcBody = (run: { version: number; updated_at: unknown }, key?: string) => ({
    confirmation: true,
    version: run.version,
    updated_at: isoAt(run.updated_at),
    idempotency_key: key ?? randomUUID(),
  });

  const seedCalculated = async (amount = '77000') => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    const contract = await mkContract(person.id);
    const fix = await mkFixedComponent(amount);
    await mkPca(person.id, fix.id, { payroll_contract_id: contract.id, amount });
    const draft = await mkRunWithPerson(period.id, person.id);
    const calcRes = await postCalculate(draft.id, submitterId, submitterUser, readyCalcBody(draft));
    assert(calcRes.status === 200, `seed calc ${calcRes.status}`);
    const run = await withTransaction((c) => loadPayrollRun(c, draft.id));
    assert(run.status === 'CALCULATED', 'seed CALCULATED');
    return { cal, period, person, contract, fix, run };
  };

  /** CALCULATED → UNDER_REVIEW بواسطة المُرسل (submitter). */
  const seedUnderReview = async (amount = '88000') => {
    const seeded = await seedCalculated(amount);
    const submit = await postSubmitReview(seeded.run, submitterId, submitterUser);
    assert(submit.status === 200, `seed submit ${submit.status}`);
    const run = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
    assert(run.status === 'UNDER_REVIEW', 'seed UNDER_REVIEW');
    return { ...seeded, run };
  };

  try {
    // —— UI helpers ——
    await it('1) UI: CAP.APPROVE === payroll_approve ويطابق PAYROLL_CAPABILITIES', async () => {
      assert(CAP.APPROVE === 'payroll_approve', CAP.APPROVE);
      assert(CAP.APPROVE === PAYROLL_CAPABILITIES.APPROVE, 'CAP APPROVE matches');
    });

    await it('2) UI: CAP.REJECT === payroll_reject ويطابق PAYROLL_CAPABILITIES', async () => {
      assert(CAP.REJECT === 'payroll_reject', CAP.REJECT);
      assert(CAP.REJECT === PAYROLL_CAPABILITIES.REJECT, 'CAP REJECT matches');
    });

    await it('3) UI: runApproveUrl / runRejectUrl شكل المسار', async () => {
      const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      assert(runApproveUrl(id) === `/api/accounts/payroll/runs/${id}/approve`, runApproveUrl(id));
      assert(runRejectUrl(id) === `/api/accounts/payroll/runs/${id}/reject`, runRejectUrl(id));
    });

    await it('4) UI: approveDecisionErrorMsg / rejectDecisionErrorMsg للـ SoD وTECHNICAL', async () => {
      assert(
        approveDecisionErrorMsg({
          __status: 403,
          error: { code: 'PAYROLL_SELF_APPROVAL_FORBIDDEN' },
        }).includes('يعتمد'),
        'approve sod msg'
      );
      assert(
        rejectDecisionErrorMsg({
          __status: 403,
          error: { code: 'PAYROLL_SELF_REJECTION_FORBIDDEN' },
        }).includes('رفض'),
        'reject sod msg'
      );
      assert(
        approveDecisionErrorMsg({
          __status: 500,
          error: { code: 'TECHNICAL_FAILURE' },
        }).includes('تقني'),
        'approve tech msg'
      );
    });

    // —— Approve success ——
    await it('5) Approver نجاح → 200 APPROVED و approval_cycle>=1', async () => {
      const seeded = await seedUnderReview('500000');
      const res = await postApprove(seeded.run, approverId, approverUser);
      assert(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as {
        success?: boolean;
        idempotent_replay?: boolean;
        run?: { status: string; approval_cycle: number };
        decision?: { action?: string };
      };
      assert(body.success === true, 'success');
      assert(body.idempotent_replay === false, 'not replay');
      assert(body.run?.status === 'APPROVED', `status ${body.run?.status}`);
      assert(Number(body.run?.approval_cycle) >= 1, `cycle ${body.run?.approval_cycle}`);
      assert(body.decision?.action === 'APPROVED', 'decision APPROVED');
    });

    await it('6) Approve totals typeof string', async () => {
      const seeded = await seedUnderReview('120000');
      const res = await postApprove(seeded.run, approverId, approverUser);
      assert(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as {
        run?: {
          gross_total: unknown;
          deduction_total: unknown;
          employer_contribution_total: unknown;
          net_total: unknown;
        };
      };
      assert(typeof body.run?.gross_total === 'string', 'gross string');
      assert(typeof body.run?.net_total === 'string', 'net string');
      assert(typeof body.run?.deduction_total === 'string', 'deduction string');
      assert(typeof body.run?.employer_contribution_total === 'string', 'employer string');
    });

    await it('7) تعليق اعتماد اختياري يُعاد في decision.comment', async () => {
      const seeded = await seedUnderReview('130000');
      const comment = 'تعليق اعتماد بعد التحقق من النتائج';
      const res = await postApprove(seeded.run, approverId, approverUser, { comment });
      assert(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as { decision?: { comment?: string | null } };
      assert(
        body.decision?.comment === normalizeApprovalComment(comment),
        `comment ${body.decision?.comment}`
      );
    });

    await it('8) GET بعد الاعتماد: review_state APPROVED و can_approve/can_reject false', async () => {
      const seeded = await seedUnderReview('135000');
      const approve = await postApprove(seeded.run, approverId, approverUser);
      assert(approve.status === 200, `approve ${approve.status}`);
      const getRes = await getRun(seeded.run.id, approverId, approverUser);
      assert(getRes.status === 200, `get ${getRes.status}`);
      const body = (await getRes.json()) as {
        data?: {
          approval?: {
            review_state?: string;
            can_approve?: boolean;
            can_reject?: boolean;
            approved_by?: { id?: string } | null;
          };
        };
      };
      assert(body.data?.approval?.review_state === 'APPROVED', `state ${body.data?.approval?.review_state}`);
      assert(body.data?.approval?.can_approve === false, 'can_approve false');
      assert(body.data?.approval?.can_reject === false, 'can_reject false');
      assert(body.data?.approval?.approved_by?.id === approverId, 'approved_by');
    });

    // —— Reject success ——
    await it('9) Reject نجاح → 200 CALCULATED و decision REJECTED', async () => {
      const seeded = await seedUnderReview('140000');
      const reason = 'رفض واضح لوجود ملاحظات على النتائج النهائية';
      const res = await postReject(seeded.run, approverId, approverUser, { reason });
      assert(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as {
        success?: boolean;
        run?: { status: string };
        decision?: { action?: string; reason?: string };
      };
      assert(body.success === true, 'success');
      assert(body.run?.status === 'CALCULATED', `status ${body.run?.status}`);
      assert(body.decision?.action === 'REJECTED', 'REJECTED');
      assert(body.decision?.reason === normalizeApprovalRejectReason(reason), 'reason');
    });

    await it('10) بعد الرفض لا مراجعة نشطة + last_rejection في GET', async () => {
      const seeded = await seedUnderReview('145000');
      const reason = 'سبب رفض يظهر في بانر التصحيح لاحقاً';
      const res = await postReject(seeded.run, approverId, approverUser, { reason });
      assert(res.status === 200, `status ${res.status}`);
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(after.status === 'CALCULATED', 'CALCULATED');
      assert(after.review_snapshot_hash == null, 'no review hash');
      assert(after.submitted_for_review_by == null, 'no submitter');
      const getRes = await getRun(seeded.run.id, submitterId, submitterUser);
      const body = (await getRes.json()) as {
        data?: { approval?: { last_rejection?: { reason?: string } | null } };
      };
      assert(
        body.data?.approval?.last_rejection?.reason === normalizeApprovalRejectReason(reason),
        'last_rejection'
      );
    });

    await it('11) Recalculate مسموح بعد الرفض', async () => {
      const seeded = await seedUnderReview('150000');
      const rej = await postReject(seeded.run, approverId, approverUser);
      assert(rej.status === 200, `reject ${rej.status}`);
      const calculated = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postRecalculate(calculated, submitterId, submitterUser, {
        reason: 'إعادة احتساب بعد رفض المراجعة للتصحيح',
      });
      assert(res.status === 200, `recalc ${res.status}`);
    });

    await it('12) Submit مجدداً بعد الرفض يرفع الدورة', async () => {
      const seeded = await seedUnderReview('155000');
      const cycle1 = Number(seeded.run.approval_cycle);
      const rej = await postReject(seeded.run, approverId, approverUser);
      assert(rej.status === 200, `reject ${rej.status}`);
      const calculated = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const submit2 = await postSubmitReview(calculated, submitterId, submitterUser);
      assert(submit2.status === 200, `submit2 ${submit2.status}`);
      const under2 = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(under2.status === 'UNDER_REVIEW', 'UNDER_REVIEW again');
      assert(Number(under2.approval_cycle) > cycle1, `cycle ${under2.approval_cycle} > ${cycle1}`);
    });

    // —— SoD ——
    await it('13) Submitter يعتمد → 403 PAYROLL_SELF_APPROVAL_FORBIDDEN', async () => {
      const seeded = await seedUnderReview('160000');
      const res = await postApprove(seeded.run, submitterId, submitterUser);
      assert(res.status === 403, `status ${res.status}`);
      const body = (await res.json()) as { error?: { code?: string } };
      assert(body.error?.code === 'PAYROLL_SELF_APPROVAL_FORBIDDEN', body.error?.code ?? 'code');
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(after.status === 'UNDER_REVIEW', 'stays UNDER_REVIEW');
    });

    await it('14) Submitter يرفض → 403 PAYROLL_SELF_REJECTION_FORBIDDEN', async () => {
      const seeded = await seedUnderReview('165000');
      const res = await postReject(seeded.run, submitterId, submitterUser);
      assert(res.status === 403, `status ${res.status}`);
      const body = (await res.json()) as { error?: { code?: string } };
      assert(body.error?.code === 'PAYROLL_SELF_REJECTION_FORBIDDEN', body.error?.code ?? 'code');
    });

    await it('15) GET للمُرسل: is_current_user_submitter و segregation_of_duties_blocked', async () => {
      const seeded = await seedUnderReview('170000');
      const getRes = await getRun(seeded.run.id, submitterId, submitterUser);
      const body = (await getRes.json()) as {
        data?: {
          approval?: {
            is_current_user_submitter?: boolean;
            segregation_of_duties_blocked?: boolean;
            can_approve?: boolean;
            can_reject?: boolean;
            approval_blockers?: string[];
          };
        };
      };
      assert(body.data?.approval?.is_current_user_submitter === true, 'submitter true');
      assert(body.data?.approval?.segregation_of_duties_blocked === true, 'sod blocked');
      assert(body.data?.approval?.can_approve === false, 'can_approve false');
      assert(body.data?.approval?.can_reject === false, 'can_reject false');
      assert(
        (body.data?.approval?.approval_blockers ?? []).includes('SOD_SUBMITTER'),
        'SOD_SUBMITTER'
      );
    });

    await it('16) GET للمراجع: can_approve و can_reject true', async () => {
      const seeded = await seedUnderReview('175000');
      const getRes = await getRun(seeded.run.id, approverId, approverUser);
      const body = (await getRes.json()) as {
        data?: {
          approval?: {
            is_current_user_submitter?: boolean;
            can_approve?: boolean;
            can_reject?: boolean;
            readiness_for_approval?: boolean;
          };
        };
      };
      assert(body.data?.approval?.is_current_user_submitter === false, 'not submitter');
      assert(body.data?.approval?.can_approve === true, 'can_approve');
      assert(body.data?.approval?.can_reject === true, 'can_reject');
      assert(body.data?.approval?.readiness_for_approval === true, 'ready');
    });

    // —— 403 capabilities ——
    await it('17) clerk → approve 403', async () => {
      const seeded = await seedUnderReview('180000');
      const res = await postApprove(seeded.run, clerkId, clerkUser);
      assert(res.status === 403, `status ${res.status}`);
    });

    await it('18) clerk → reject 403', async () => {
      const seeded = await seedUnderReview('185000');
      const res = await postReject(seeded.run, clerkId, clerkUser);
      assert(res.status === 403, `status ${res.status}`);
    });

    await it('19) صلاحية APPROVE فقط تنجح اعتماداً وتفشل رفضاً', async () => {
      const seeded = await seedUnderReview('190000');
      __setPayrollCapabilitiesOverrideForTests(approverId, [
        PAYROLL_CAPABILITIES.VIEW,
        PAYROLL_CAPABILITIES.VIEW_RUNS,
        PAYROLL_CAPABILITIES.APPROVE,
      ]);
      try {
        const okApprove = await postApprove(seeded.run, approverId, approverUser);
        assert(okApprove.status === 200, `approve ${okApprove.status}`);
      } finally {
        __setPayrollCapabilitiesOverrideForTests(approverId, null);
      }
      const seeded2 = await seedUnderReview('191000');
      __setPayrollCapabilitiesOverrideForTests(approverId, [
        PAYROLL_CAPABILITIES.VIEW,
        PAYROLL_CAPABILITIES.VIEW_RUNS,
        PAYROLL_CAPABILITIES.APPROVE,
      ]);
      try {
        const rej = await postReject(seeded2.run, approverId, approverUser);
        assert(rej.status === 403, `reject ${rej.status}`);
      } finally {
        __setPayrollCapabilitiesOverrideForTests(approverId, null);
      }
    });

    await it('20) صلاحية REJECT فقط تنجح رفضاً وتفشل اعتماداً', async () => {
      const seeded = await seedUnderReview('195000');
      __setPayrollCapabilitiesOverrideForTests(approverId, [
        PAYROLL_CAPABILITIES.VIEW,
        PAYROLL_CAPABILITIES.VIEW_RUNS,
        PAYROLL_CAPABILITIES.REJECT,
      ]);
      try {
        const rej = await postReject(seeded.run, approverId, approverUser);
        assert(rej.status === 200, `reject ${rej.status}`);
      } finally {
        __setPayrollCapabilitiesOverrideForTests(approverId, null);
      }
      const seeded2 = await seedUnderReview('196000');
      __setPayrollCapabilitiesOverrideForTests(approverId, [
        PAYROLL_CAPABILITIES.VIEW,
        PAYROLL_CAPABILITIES.VIEW_RUNS,
        PAYROLL_CAPABILITIES.REJECT,
      ]);
      try {
        const ap = await postApprove(seeded2.run, approverId, approverUser);
        assert(ap.status === 403, `approve ${ap.status}`);
      } finally {
        __setPayrollCapabilitiesOverrideForTests(approverId, null);
      }
    });

    await it('21) SUBMIT_REVIEW فقط بلا APPROVE/REJECT → 403', async () => {
      const seeded = await seedUnderReview('200000');
      __setPayrollCapabilitiesOverrideForTests(approverId, [
        PAYROLL_CAPABILITIES.VIEW,
        PAYROLL_CAPABILITIES.VIEW_RUNS,
        PAYROLL_CAPABILITIES.SUBMIT_REVIEW,
      ]);
      try {
        const ap = await postApprove(seeded.run, approverId, approverUser);
        const rj = await postReject(seeded.run, approverId, approverUser);
        assert(ap.status === 403, `approve ${ap.status}`);
        assert(rj.status === 403, `reject ${rj.status}`);
      } finally {
        __setPayrollCapabilitiesOverrideForTests(approverId, null);
      }
    });

    await it('22) بلا صلاحيات قرار (VIEW فقط) → 403', async () => {
      const seeded = await seedUnderReview('205000');
      __setPayrollCapabilitiesOverrideForTests(approverId, [
        PAYROLL_CAPABILITIES.VIEW,
        PAYROLL_CAPABILITIES.VIEW_RUNS,
      ]);
      try {
        const ap = await postApprove(seeded.run, approverId, approverUser);
        assert(ap.status === 403, `status ${ap.status}`);
      } finally {
        __setPayrollCapabilitiesOverrideForTests(approverId, null);
      }
    });

    // —— 400 ——
    await it('23) Approve UUID غير صالح → 400', async () => {
      const res = await postApprove('not-a-uuid', approverId, approverUser, {
        version: 1,
        updated_at: new Date().toISOString(),
        key: randomUUID(),
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    await it('24) Reject بدون confirmation → 400', async () => {
      const seeded = await seedUnderReview('210000');
      const res = await postReject(seeded.run, approverId, approverUser, {
        confirmation: false,
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    await it('25) Approve بدون confirmation → 400', async () => {
      const seeded = await seedUnderReview('215000');
      const res = await postApprove(seeded.run, approverId, approverUser, {
        confirmation: false,
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    await it('26) Approve version غير صالح → 400', async () => {
      const seeded = await seedUnderReview('220000');
      const res = await postApprove(seeded.run, approverId, approverUser, { version: 'abc' });
      assert(res.status === 400, `status ${res.status}`);
    });

    await it('27) Approve updated_at فارغ → 400', async () => {
      const seeded = await seedUnderReview('225000');
      const res = await postApprove(seeded.run, approverId, approverUser, { updated_at: '' });
      assert(res.status === 400, `status ${res.status}`);
    });

    await it('28) Approve بدون مفتاح → 400', async () => {
      const seeded = await seedUnderReview('230000');
      const res = await postApprove(seeded.run, approverId, approverUser, { omitKey: true });
      assert(res.status === 400, `status ${res.status}`);
    });

    await it('29) Approve تعليق أطول من 500 → 400', async () => {
      const seeded = await seedUnderReview('235000');
      const res = await postApprove(seeded.run, approverId, approverUser, {
        comment: 'س'.repeat(501),
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    await it('30) Reject سبب أقصر من 10 → 400 INVALID_REJECTION_REASON', async () => {
      const seeded = await seedUnderReview('240000');
      const res = await postReject(seeded.run, approverId, approverUser, { reason: 'قصير' });
      assert(res.status === 400, `status ${res.status}`);
      const body = (await res.json()) as { error?: { code?: string } };
      assert(body.error?.code === 'INVALID_REJECTION_REASON', body.error?.code ?? 'code');
    });

    await it('31) Reject سبب أطول من 500 → 400', async () => {
      const seeded = await seedUnderReview('245000');
      const res = await postReject(seeded.run, approverId, approverUser, {
        reason: 'س'.repeat(501),
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    await it('32) Reject بدون مفتاح → 400', async () => {
      const seeded = await seedUnderReview('250000');
      const res = await postReject(seeded.run, approverId, approverUser, { omitKey: true });
      assert(res.status === 400, `status ${res.status}`);
    });

    // —— 409 status ——
    await it('33) Approve من CALCULATED → 409', async () => {
      const seeded = await seedCalculated('255000');
      const res = await postApprove(seeded.run, approverId, approverUser);
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('34) Reject من CALCULATED → 409', async () => {
      const seeded = await seedCalculated('260000');
      const res = await postReject(seeded.run, approverId, approverUser);
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('35) Approve من DRAFT → 409', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      await mkContract(person.id);
      const run = await mkRunWithPerson(period.id, person.id);
      const res = await postApprove(run, approverId, approverUser);
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('36) Approve بعد APPROVED مسبقاً → 409', async () => {
      const seeded = await seedUnderReview('265000');
      const first = await postApprove(seeded.run, approverId, approverUser);
      assert(first.status === 200, `first ${first.status}`);
      const approved = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postApprove(approved, approverId, approverUser);
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('37) Approve نسخة متقادمة → 409', async () => {
      const seeded = await seedUnderReview('270000');
      const res = await postApprove(seeded.run, approverId, approverUser, {
        version: seeded.run.version - 1,
      });
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('38) Reject updated_at متقادم → 409', async () => {
      const seeded = await seedUnderReview('275000');
      const res = await postReject(seeded.run, approverId, approverUser, {
        updated_at: '2000-01-01T00:00:00.000Z',
      });
      assert(res.status === 409, `status ${res.status}`);
    });

    // —— 422 ——
    await it('39) Approve مع error_count>0 → 422 + approval_blocked', async () => {
      const seeded = await seedUnderReview('280000');
      await query(`UPDATE accounts.payroll_runs SET error_count=1 WHERE id=$1::uuid`, [
        seeded.run.id,
      ]);
      const fresh = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const beforeBlocked = await auditCount(seeded.run.id, 'payroll_run.approval_blocked');
      const res = await postApprove(fresh, approverId, approverUser);
      assert(res.status === 422, `status ${res.status}`);
      const body = (await res.json()) as { error?: { code?: string } };
      assert(body.error?.code === 'PAYROLL_HAS_ERRORS', body.error?.code ?? 'code');
      assert(
        (await auditCount(seeded.run.id, 'payroll_run.approval_blocked')) > beforeBlocked,
        'blocked'
      );
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(after.status === 'UNDER_REVIEW', 'stays UNDER_REVIEW');
    });

    await it('40) Approve مشكلة حاجبة → 422', async () => {
      const seeded = await seedUnderReview('285000');
      await query(
        `INSERT INTO accounts.payroll_run_issues
           (payroll_run_id, severity, issue_code, message_ar, is_blocking, created_by)
         VALUES ($1::uuid, 'ERROR', 'TEST_BLOCK_APPROVE', 'مشكلة حاجبة للاعتماد', TRUE, $2::uuid)`,
        [seeded.run.id, submitterId]
      );
      const fresh = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postApprove(fresh, approverId, approverUser);
      assert(res.status === 422, `status ${res.status}`);
    });

    await it('41) Approve عملة USD → 422', async () => {
      const seeded = await seedUnderReview('290000');
      await query(
        `UPDATE accounts.payroll_periods SET currency_code='USD' WHERE id=$1::uuid`,
        [seeded.period.id]
      );
      await query(`UPDATE accounts.payroll_runs SET currency_code='USD' WHERE id=$1::uuid`, [
        seeded.run.id,
      ]);
      try {
        const fresh = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
        const res = await postApprove(fresh, approverId, approverUser);
        assert(res.status === 422, `status ${res.status}`);
        const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
        assert(after.status === 'UNDER_REVIEW', 'stays UNDER_REVIEW');
      } finally {
        await query(
          `UPDATE accounts.payroll_periods SET currency_code='IQD' WHERE id=$1::uuid`,
          [seeded.period.id]
        );
        await query(`UPDATE accounts.payroll_runs SET currency_code='IQD' WHERE id=$1::uuid`, [
          seeded.run.id,
        ]);
      }
    });

    await it('42) إغلاق الفترة → approve 422 PAYROLL_PERIOD_NOT_OPEN', async () => {
      const seeded = await seedUnderReview('295000');
      await query(
        `UPDATE accounts.payroll_periods
         SET status='CLOSED', closed_at=NOW(), closed_by=$2::uuid, updated_at=NOW(), version=version+1
         WHERE id=$1::uuid`,
        [seeded.period.id, submitterId]
      );
      try {
        const fresh = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
        const res = await postApprove(fresh, approverId, approverUser);
        assert(res.status === 422, `status ${res.status}`);
        const body = (await res.json()) as { error?: { code?: string } };
        assert(body.error?.code === 'PAYROLL_PERIOD_NOT_OPEN', body.error?.code ?? 'code');
      } finally {
        await query(
          `UPDATE accounts.payroll_periods
           SET status='OPEN', closed_at=NULL, closed_by=NULL, updated_at=NOW(), version=version+1
           WHERE id=$1::uuid`,
          [seeded.period.id]
        );
      }
    });

    await it('43) Drift بصمة المراجعة → 409 PAYROLL_REVIEW_SNAPSHOT_CHANGED', async () => {
      const seeded = await seedUnderReview('300000');
      await query(
        `UPDATE accounts.payroll_runs
         SET snapshot_hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
         WHERE id=$1::uuid`,
        [seeded.run.id]
      );
      const fresh = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postApprove(fresh, approverId, approverUser);
      assert(res.status === 409, `status ${res.status}`);
      const body = (await res.json()) as { error?: { code?: string } };
      assert(
        body.error?.code === 'PAYROLL_REVIEW_SNAPSHOT_CHANGED' ||
          body.error?.code === 'CONFLICT',
        body.error?.code ?? 'code'
      );
    });

    // —— Idempotency ——
    await it('44) Approve نفس المفتاح → idempotent_replay', async () => {
      const seeded = await seedUnderReview('310000');
      const key = randomUUID();
      const first = await postApprove(seeded.run, approverId, approverUser, { key });
      assert(first.status === 200, `first ${first.status}`);
      const second = await postApprove(seeded.run, approverId, approverUser, { key });
      assert(second.status === 200, `second ${second.status}`);
      const secondBody = (await second.json()) as { idempotent_replay?: boolean };
      assert(secondBody.idempotent_replay === true, 'replay');
      assert((await actionCount(seeded.run.id, 'APPROVED')) === 1, 'one APPROVED');
    });

    await it('45) Reject نفس المفتاح → replay بلا إجراء مكرر', async () => {
      const seeded = await seedUnderReview('315000');
      const key = randomUUID();
      const reason = 'سبب رفض ثابت لإعادة التشغيل بنفس المفتاح';
      const first = await postReject(seeded.run, approverId, approverUser, { key, reason });
      assert(first.status === 200, `first ${first.status}`);
      const second = await postReject(seeded.run, approverId, approverUser, { key, reason });
      assert(second.status === 200, `second ${second.status}`);
      const secondBody = (await second.json()) as { idempotent_replay?: boolean };
      assert(secondBody.idempotent_replay === true, 'replay');
      assert((await actionCount(seeded.run.id, 'REJECTED')) === 1, 'one REJECTED');
    });

    await it('46) Approve نفس المفتاح + تعليق مختلف → 409 IDEMPOTENCY_CONFLICT', async () => {
      const seeded = await seedUnderReview('320000');
      const key = randomUUID();
      const first = await postApprove(seeded.run, approverId, approverUser, {
        key,
        comment: 'التعليق الأول للاعتماد',
      });
      assert(first.status === 200, `first ${first.status}`);
      const second = await postApprove(seeded.run, approverId, approverUser, {
        key,
        comment: 'تعليق مختلف تماماً للاعتماد',
      });
      assert(second.status === 409, `status ${second.status}`);
      const body = (await second.json()) as { error?: { code?: string } };
      assert(body.error?.code === 'IDEMPOTENCY_CONFLICT', body.error?.code ?? 'code');
    });

    await it('47) Reject نفس المفتاح + سبب مختلف → 409 IDEMPOTENCY_CONFLICT', async () => {
      const seeded = await seedUnderReview('325000');
      const key = randomUUID();
      const first = await postReject(seeded.run, approverId, approverUser, {
        key,
        reason: 'السبب الأول للرفض بعد المراجعة',
      });
      assert(first.status === 200, `first ${first.status}`);
      const second = await postReject(seeded.run, approverId, approverUser, {
        key,
        reason: 'سبب مختلف تماماً للرفض بعد المراجعة',
      });
      assert(second.status === 409, `status ${second.status}`);
    });

    // —— Integrity ——
    await it('48) إجراء اعتماد تالف → 409 بلا طفرة', async () => {
      const seeded = await seedUnderReview('330000');
      const key = `corrupt-approve-${token}`;
      const normalizedKey = normalizeApprovalIdempotencyKey(key);
      const keyHash = buildApprovalRequestKeyHash('APPROVE', normalizedKey);
      const corruptSnapshot = 'incomplete-hash-missing-fields';
      const payloadHash = buildApprovalRequestPayloadHash('APPROVE', {
        run_id: seeded.run.id,
        expected_version: seeded.run.version,
        expected_updated_at: isoAt(seeded.run.updated_at),
        review_snapshot_hash: corruptSnapshot,
        normalized_comment: '',
      });
      await query(
        `INSERT INTO accounts.payroll_run_approval_actions
           (payroll_run_id, payroll_period_id, approval_cycle, action, from_status, to_status,
            actor_id, actor_display_name_snapshot, comment, reason, snapshot_hash,
            version_before, version_after, request_key_hash, request_payload_hash, request_key_masked)
         VALUES ($1::uuid,$2::uuid,$8,'APPROVED','UNDER_REVIEW','APPROVED',
                 $3::uuid,'اختبار تالف',NULL,NULL,$7,
                 $4,$4,$5,$6,'corrupt…key')`,
        [
          seeded.run.id,
          seeded.period.id,
          approverId,
          seeded.run.version,
          keyHash,
          payloadHash,
          corruptSnapshot,
          seeded.run.approval_cycle,
        ]
      );
      const before = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const artsBefore = await withTransaction((c) => loadRunCalculationArtifacts(c, before.id));
      const auditsBefore = await auditCount(seeded.run.id, 'payroll_run.approved');
      const res = await postApprove(before, approverId, approverUser, { key });
      assert(res.status === 409, `status ${res.status}`);
      const after = await withTransaction((c) => loadPayrollRun(c, before.id));
      assert(after.status === 'UNDER_REVIEW', 'no status mutation');
      assert(after.version === before.version, 'no version bump');
      const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, before.id));
      assert(arts.people.length === artsBefore.people.length, 'people frozen');
      assert(
        (await auditCount(seeded.run.id, 'payroll_run.approved')) === auditsBefore,
        'no success audit'
      );
    });

    // —— Concurrency ——
    await it('49) Concurrent Approve×Approve → واحد 200 وواحد 409؛ APPROVED؛ إجراء واحد', async () => {
      const seeded = await seedUnderReview('340000');
      const settled = await Promise.allSettled([
        postApprove(seeded.run, approverId, approverUser, { key: randomUUID() }),
        postApprove(seeded.run, approverId, approverUser, { key: randomUUID() }),
      ]);
      const responses = [];
      for (const s of settled) {
        assert(s.status === 'fulfilled', 'settled');
        if (s.status === 'fulfilled') responses.push(s.value);
      }
      const statuses = responses.map((r) => r.status);
      assert(statuses.filter((s) => s === 200).length === 1, `ok ${statuses.join(',')}`);
      assert(statuses.filter((s) => s === 409).length === 1, `conflict ${statuses.join(',')}`);
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(after.status === 'APPROVED', `final ${after.status}`);
      assert((await actionCount(seeded.run.id, 'APPROVED')) === 1, 'one approve');
    });

    await it('50) Concurrent Approve×Reject → APPROVED أو CALCULATED متسق؛ قرار واحد', async () => {
      const seeded = await seedUnderReview('350000');
      const settled = await Promise.allSettled([
        postApprove(seeded.run, approverId, approverUser),
        postReject(seeded.run, approverId, approverUser),
      ]);
      assert(settled.length === 2, 'both settled');
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(
        after.status === 'APPROVED' || after.status === 'CALCULATED',
        `status ${after.status}`
      );
      const approvedN = await actionCount(seeded.run.id, 'APPROVED');
      const rejectedN = await actionCount(seeded.run.id, 'REJECTED');
      assert(approvedN + rejectedN === 1, `decisions ${approvedN}+${rejectedN}`);
    });

    await it('51) Concurrent Reject×Reject → واحد ينجح؛ CALCULATED؛ إجراء رفض واحد', async () => {
      const seeded = await seedUnderReview('355000');
      const settled = await Promise.allSettled([
        postReject(seeded.run, approverId, approverUser, {
          key: randomUUID(),
          reason: 'رفض متزامن أول لاختبار التكامل',
        }),
        postReject(seeded.run, approverId, approverUser, {
          key: randomUUID(),
          reason: 'رفض متزامن ثانٍ لاختبار التكامل',
        }),
      ]);
      const responses = [];
      for (const s of settled) {
        assert(s.status === 'fulfilled', 'settled');
        if (s.status === 'fulfilled') responses.push(s.value);
      }
      const okN = responses.filter((r) => r.status === 200).length;
      const conflictN = responses.filter((r) => r.status === 409).length;
      assert(okN === 1, `okN ${okN}`);
      assert(conflictN === 1, `conflictN ${conflictN}`);
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(after.status === 'CALCULATED', `final ${after.status}`);
      assert((await actionCount(seeded.run.id, 'REJECTED')) === 1, 'one reject');
    });

    // —— IDOR ——
    await it('52) visibility/IDOR: عشوائي approve/reject 404؛ GET مفقود 404', async () => {
      const missing = randomUUID();
      const ap = await postApprove(missing, approverId, approverUser, {
        version: 1,
        updated_at: new Date().toISOString(),
        key: randomUUID(),
      });
      const rj = await postReject(missing, approverId, approverUser, {
        version: 1,
        updated_at: new Date().toISOString(),
        key: randomUUID(),
      });
      assert(ap.status === 404, `approve ${ap.status}`);
      assert(rj.status === 404, `reject ${rj.status}`);
      const getRes = await getRun(missing, viewerId, viewerUser);
      assert(getRes.status === 404, `get ${getRes.status}`);
    });

    // —— Failpoints ——
    await it('53) failpoint approve_after_verify → 500 TECHNICAL_FAILURE عربي', async () => {
      const seeded = await seedUnderReview('360000');
      __setPayrollApprovalFailpointForTests('approve_after_verify');
      try {
        const res = await postApprove(seeded.run, approverId, approverUser);
        assert(res.status === 500, `status ${res.status}`);
        const body = (await res.json()) as { message?: string; error?: { code?: string } };
        assert(body.error?.code === 'TECHNICAL_FAILURE', body.error?.code ?? 'code');
        assert(!String(body.message).includes('FAILPOINT'), 'no leak');
      } finally {
        __clearPayrollApprovalFailpointForTests();
      }
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(after.status === 'UNDER_REVIEW', 'rollback');
    });

    await it('54) failpoint reject_after_reason_validation → 500 وبلا طفرة', async () => {
      const seeded = await seedUnderReview('365000');
      const before = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      __setPayrollApprovalFailpointForTests('reject_after_reason_validation');
      try {
        const res = await postReject(before, approverId, approverUser);
        assert(res.status === 500, `status ${res.status}`);
      } finally {
        __clearPayrollApprovalFailpointForTests();
      }
      const after = await withTransaction((c) => loadPayrollRun(c, before.id));
      assert(after.status === 'UNDER_REVIEW', `status ${after.status}`);
      assert(after.version === before.version, 'version same');
    });

    await it('55) تدقيق approval_failed بلا مفتاح خام', async () => {
      const seeded = await seedUnderReview('370000');
      const rawKey = `raw-approve-fail-${token}-${randomUUID()}`;
      __setPayrollApprovalFailpointForTests('approve_after_verify');
      try {
        const res = await postApprove(seeded.run, approverId, approverUser, { key: rawKey });
        assert(res.status === 500, `status ${res.status}`);
      } finally {
        __clearPayrollApprovalFailpointForTests();
      }
      const audit = await latestAudit(seeded.run.id, 'payroll_run.approval_failed');
      assert(audit, 'failed audit');
      assert(!jsonHasRawKey(audit?.new_values, rawKey), 'no raw key');
    });

    await it('56) تدقيق rejection_failed بلا مفتاح خام', async () => {
      const seeded = await seedUnderReview('375000');
      const rawKey = `raw-reject-fail-${token}-${randomUUID()}`;
      __setPayrollApprovalFailpointForTests('reject_after_reason_validation');
      try {
        const res = await postReject(seeded.run, approverId, approverUser, { key: rawKey });
        assert(res.status === 500, `status ${res.status}`);
      } finally {
        __clearPayrollApprovalFailpointForTests();
      }
      const audit = await latestAudit(seeded.run.id, 'payroll_run.rejection_failed');
      assert(audit, 'failed audit');
      assert(!jsonHasRawKey(audit?.new_values, rawKey), 'no raw key');
    });

    // —— Audit safety ——
    await it('57) SoD blocked يكتب approval_blocked بلا مفتاح خام', async () => {
      const seeded = await seedUnderReview('380000');
      const rawKey = `raw-sod-key-${token}-${randomUUID()}`;
      const beforeBlocked = await auditCount(seeded.run.id, 'payroll_run.approval_blocked');
      const res = await postApprove(seeded.run, submitterId, submitterUser, { key: rawKey });
      assert(res.status === 403, `status ${res.status}`);
      assert(
        (await auditCount(seeded.run.id, 'payroll_run.approval_blocked')) > beforeBlocked,
        'blocked written'
      );
      const audit = await latestAudit(seeded.run.id, 'payroll_run.approval_blocked');
      assert(audit, 'blocked audit');
      assert(!jsonHasRawKey(audit?.new_values, rawKey), 'no raw');
      assert(audit?.new_values?.operation === 'APPROVE', 'operation APPROVE');
    });

    await it('58) success approved audit مرة واحدة بلا raw key / hashes', async () => {
      const seeded = await seedUnderReview('385000');
      const rawKey = `visible-approve-key-${token}-${randomUUID()}`;
      const res = await postApprove(seeded.run, approverId, approverUser, { key: rawKey });
      assert(res.status === 200, `status ${res.status}`);
      const body = await res.json();
      assert(!jsonHasRawKey(body, rawKey), 'no raw in body');
      assert(!JSON.stringify(body).includes('request_key_hash'), 'no key hash');
      assert(!JSON.stringify(body).includes('request_payload_hash'), 'no payload hash');
      assert((await auditCount(seeded.run.id, 'payroll_run.approved')) === 1, 'once');
      const audit = await latestAudit(seeded.run.id, 'payroll_run.approved');
      assert(!jsonHasRawKey(audit?.new_values, rawKey), 'no raw in audit');
    });

    await it('59) success review_rejected audit مرة واحدة بلا raw key', async () => {
      const seeded = await seedUnderReview('390000');
      const rawKey = `visible-reject-key-${token}-${randomUUID()}`;
      const res = await postReject(seeded.run, approverId, approverUser, { key: rawKey });
      assert(res.status === 200, `status ${res.status}`);
      assert((await auditCount(seeded.run.id, 'payroll_run.review_rejected')) === 1, 'once');
      const audit = await latestAudit(seeded.run.id, 'payroll_run.review_rejected');
      assert(!jsonHasRawKey(audit?.new_values, rawKey), 'no raw');
    });

    // —— Lock after APPROVED ——
    await it('60) بعد APPROVED إعادة احتساب → 409', async () => {
      const seeded = await seedUnderReview('400000');
      const ap = await postApprove(seeded.run, approverId, approverUser);
      assert(ap.status === 200, `approve ${ap.status}`);
      const approved = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postRecalculate(approved, submitterId, submitterUser, {
        reason: 'محاولة إعادة احتساب بعد الاعتماد النهائي',
      });
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('61) بعد APPROVED إلغاء → 409', async () => {
      const seeded = await seedUnderReview('405000');
      const ap = await postApprove(seeded.run, approverId, approverUser);
      assert(ap.status === 200, `approve ${ap.status}`);
      const approved = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postCancel(approved.id, submitterId, submitterUser, {
        version: approved.version,
        updated_at: isoAt(approved.updated_at),
        reason: 'محاولة إلغاء بعد الاعتماد النهائي للتشغيل',
      });
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('62) بعد APPROVED PATCH تشغيل → 409', async () => {
      const seeded = await seedUnderReview('410000');
      const ap = await postApprove(seeded.run, approverId, approverUser);
      assert(ap.status === 200, `approve ${ap.status}`);
      const approved = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await patchRun(approved.id, submitterId, submitterUser, {
        version: approved.version,
        updated_at: isoAt(approved.updated_at),
        run_type: 'REGULAR',
      });
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('63) بعد APPROVED Submit → 409', async () => {
      const seeded = await seedUnderReview('415000');
      const ap = await postApprove(seeded.run, approverId, approverUser);
      assert(ap.status === 200, `approve ${ap.status}`);
      const approved = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postSubmitReview(approved, submitterId, submitterUser);
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('64) بعد APPROVED Reject → 409', async () => {
      const seeded = await seedUnderReview('420000');
      const ap = await postApprove(seeded.run, approverId, approverUser);
      assert(ap.status === 200, `approve ${ap.status}`);
      const approved = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postReject(approved, approverId, approverUser);
      assert(res.status === 409, `status ${res.status}`);
    });

    // —— GET blockers ——
    await it('65) GET مع HAS_ERRORS تحت المراجعة: can_approve false و blockers', async () => {
      const seeded = await seedUnderReview('430000');
      await query(`UPDATE accounts.payroll_runs SET error_count=2 WHERE id=$1::uuid`, [
        seeded.run.id,
      ]);
      const getRes = await getRun(seeded.run.id, approverId, approverUser);
      const body = (await getRes.json()) as {
        data?: {
          approval?: {
            can_approve?: boolean;
            can_reject?: boolean;
            approval_blockers?: string[];
            readiness_for_approval?: boolean;
          };
        };
      };
      assert(body.data?.approval?.can_approve === false, 'can_approve false');
      assert(body.data?.approval?.can_reject === true, 'can_reject still true');
      assert(
        (body.data?.approval?.approval_blockers ?? []).includes('HAS_ERRORS'),
        'HAS_ERRORS'
      );
      assert(body.data?.approval?.readiness_for_approval === false, 'not ready');
    });

    await it('66) بلا snapshot_json في استجابة الاعتماد', async () => {
      const seeded = await seedUnderReview('435000');
      const res = await postApprove(seeded.run, approverId, approverUser);
      assert(res.status === 200, `status ${res.status}`);
      assert(!JSON.stringify(await res.json()).includes('snapshot_json'), 'no snapshot_json');
    });

    await it('67) SoD لا يُتجاوز بصلاحية ADMIN عبر override على المُرسل', async () => {
      const seeded = await seedUnderReview('440000');
      __setPayrollCapabilitiesOverrideForTests(submitterId, [
        PAYROLL_CAPABILITIES.VIEW,
        PAYROLL_CAPABILITIES.VIEW_RUNS,
        PAYROLL_CAPABILITIES.APPROVE,
        PAYROLL_CAPABILITIES.REJECT,
        PAYROLL_CAPABILITIES.ADMIN,
      ]);
      try {
        const ap = await postApprove(seeded.run, submitterId, submitterUser);
        assert(ap.status === 403, `approve ${ap.status}`);
        const rj = await postReject(seeded.run, submitterId, submitterUser);
        assert(rj.status === 403, `reject ${rj.status}`);
      } finally {
        __setPayrollCapabilitiesOverrideForTests(submitterId, null);
      }
    });

    await it('68) Approve×Cancel متزامن → APPROVED أو UNDER_REVIEW (Cancel ممنوع)', async () => {
      const seeded = await seedUnderReview('445000');
      const settled = await Promise.allSettled([
        postApprove(seeded.run, approverId, approverUser),
        postCancel(seeded.run.id, submitterId, submitterUser, {
          version: seeded.run.version,
          updated_at: isoAt(seeded.run.updated_at),
          reason: 'محاولة إلغاء متزامن أثناء الاعتماد',
        }),
      ]);
      assert(settled.length === 2, 'settled');
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(
        after.status === 'APPROVED' || after.status === 'UNDER_REVIEW',
        `status ${after.status}`
      );
      assert(after.status !== 'CANCELLED', 'not cancelled');
    });

    await it('69) rejection_blocked عند SoD رفض المُرسل', async () => {
      const seeded = await seedUnderReview('450000');
      const before = await auditCount(seeded.run.id, 'payroll_run.rejection_blocked');
      const res = await postReject(seeded.run, submitterId, submitterUser);
      assert(res.status === 403, `status ${res.status}`);
      assert(
        (await auditCount(seeded.run.id, 'payroll_run.rejection_blocked')) > before,
        'rejection_blocked'
      );
    });

    await it('70) تاريخ الإجراءات محفوظ بعد الرفض (SUBMITTED + REJECTED)', async () => {
      const seeded = await seedUnderReview('455000');
      const rej = await postReject(seeded.run, approverId, approverUser);
      assert(rej.status === 200, `reject ${rej.status}`);
      assert((await actionCount(seeded.run.id, 'SUBMITTED_FOR_REVIEW')) >= 1, 'submit kept');
      assert((await actionCount(seeded.run.id, 'REJECTED')) === 1, 'reject kept');
    });

    await it('71) اعتماد بعد دورة رفض سابقة ينجح بمراجع مختلف', async () => {
      const seeded = await seedUnderReview('460000');
      const rej = await postReject(seeded.run, approverId, approverUser);
      assert(rej.status === 200, `reject ${rej.status}`);
      const calculated = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const submit2 = await postSubmitReview(calculated, submitterId, submitterUser);
      assert(submit2.status === 200, `submit2 ${submit2.status}`);
      const under2 = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const ap = await postApprove(under2, approverId, approverUser);
      assert(ap.status === 200, `approve ${ap.status}`);
      const final = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(final.status === 'APPROVED', 'APPROVED');
      assert((await actionCount(seeded.run.id, 'REJECTED')) === 1, 'prior reject');
      assert((await actionCount(seeded.run.id, 'APPROVED')) === 1, 'approve');
    });

    await it('72) viewer لا يعتمد ولا يرفض', async () => {
      const seeded = await seedUnderReview('465000');
      const ap = await postApprove(seeded.run, viewerId, viewerUser);
      const rj = await postReject(seeded.run, viewerId, viewerUser);
      assert(ap.status === 403 || ap.status === 404, `approve ${ap.status}`);
      assert(rj.status === 403 || rj.status === 404, `reject ${rj.status}`);
    });

    await it('73) Approve response بلا actor/user_id من العميل', async () => {
      const seeded = await seedUnderReview('470000');
      const res = await postApprove(seeded.run, approverId, approverUser);
      assert(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as { run?: { approved_by?: { id?: string } | null } };
      assert(body.run?.approved_by?.id === approverId, 'server-side actor');
    });

    await it('74) بعد UNDER_REVIEW Cancel وحده → 409', async () => {
      const seeded = await seedUnderReview('475000');
      const res = await postCancel(seeded.run.id, submitterId, submitterUser, {
        version: seeded.run.version,
        updated_at: isoAt(seeded.run.updated_at),
        reason: 'محاولة إلغاء أثناء المراجعة بدل الرفض',
      });
      assert(res.status === 409, `status ${res.status}`);
    });
  } finally {
    console.log('— تنظيف سجلات الاختبار المملوكة —');
    try {
      await cleanupOwned();
      const left = await countOwned();
      console.log(`cleanup leftover count = ${left}`);
      await it('75) Cleanup leftover = 0', async () => {
        assert(left === 0, `بقايا ${left}`);
      });
    } catch (e) {
      failed('75) Cleanup leftover = 0', e);
    }
  }

  console.log(`\n===== النتيجة: ${passCount} ناجح / ${failCount} فاشل =====`);
  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  try {
    __clearPayrollApprovalFailpointForTests();
    __clearPayrollCapabilitiesOverrideForTests();
    await cleanupOwned();
  } catch {
    /* ignore */
  }
  await closePool();
});
