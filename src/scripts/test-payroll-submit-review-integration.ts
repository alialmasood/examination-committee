/**
 * اختبارات HTTP لتكامل إرسال الرواتب للمراجعة 9.B.2
 * npm run test:payroll-submit-review-integration
 *
 * عزل: ownership token + cleanupOwned في finally.
 * تشغيل مرتين يجب أن يترك 0 صفوف مملوكة.
 *
 * سلوكيات الصفحة (React) تُغطّى عبر HTTP + فحوصات المساعدات النقية
 * (CAP.SUBMIT_REVIEW / runSubmitReviewUrl) — بلا RTL.
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
import { CAP, runSubmitReviewUrl } from '../../app/accounts/payroll/_lib';

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

async function submitActionCount(runId: string) {
  const r = await query(
    `SELECT COUNT(*)::int n FROM accounts.payroll_run_approval_actions
     WHERE payroll_run_id=$1::uuid AND action='SUBMITTED_FOR_REVIEW'`,
    [runId]
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function upsertUser(username: string, withAccounts: boolean): Promise<string> {
  const hash = await bcrypt.hash('test-submit-review-int-pass', 10);
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

type SubmitBody = {
  confirmation?: boolean;
  version?: unknown;
  updated_at?: unknown;
  idempotency_key?: string;
  comment?: string;
};

type RunLike = { id: string; version: number; updated_at: unknown };

async function postSubmitReview(
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
  const body: SubmitBody = {};
  if (opts.confirmation !== undefined) body.confirmation = opts.confirmation;
  else body.confirmation = true;

  if (opts.version !== undefined) body.version = opts.version;
  else if (typeof run !== 'string') body.version = run.version;

  if (opts.updated_at !== undefined) body.updated_at = opts.updated_at;
  else if (typeof run !== 'string') body.updated_at = isoAt(run.updated_at);

  if (!opts.omitKey) {
    body.idempotency_key = opts.key ?? randomUUID();
  }
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
  opts: {
    key?: string;
    reason?: string;
    version?: unknown;
    updated_at?: unknown;
    confirmation?: boolean;
  } = {}
) {
  const runId = typeof run === 'string' ? run : run.id;
  const body: Record<string, unknown> = {
    confirmation: opts.confirmation ?? true,
    idempotency_key: opts.key ?? randomUUID(),
    reason: opts.reason ?? 'تعديل الراتب الأساسي بعد المراجعة',
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
  const s = JSON.stringify(obj ?? {});
  return s.includes(rawKey);
}

async function main() {
  console.log('===== اختبارات تكامل إرسال الرواتب للمراجعة 9.B.2 =====');
  const token = `SR${Date.now().toString(36).toUpperCase()}`;
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
  const adminId = user.rows[0].id as string;
  const adminUser = user.rows[0].username as string;
  await grantAccountsAdminRole(adminId);

  const clerkUser = `test-sr-clerk-${token.toLowerCase()}`;
  const viewerUser = `test-sr-viewer-${token.toLowerCase()}`;
  const clerkId = await upsertUser(clerkUser, true);
  const viewerId = await upsertUser(viewerUser, true);
  await grantAccountsPlatformRole(clerkId, ACCOUNTS_CLERK_ROLE_CODE);
  await grantAccountsPlatformRole(viewerId, ACCOUNTS_VIEWER_ROLE_CODE);

  let fy = await query(
    `SELECT id FROM accounts.fiscal_years WHERE status='ACTIVE' ORDER BY is_default DESC, start_date DESC LIMIT 1`
  );
  if (!fy.rows[0]) {
    fy = await query(
      `INSERT INTO accounts.fiscal_years (code,name_ar,start_date,end_date,status,is_default,created_by)
       VALUES ($1,'سنة تكامل إرسال مراجعة','2025-01-01','2025-12-31','ACTIVE',FALSE,$2) RETURNING id`,
      [uniq('SRFY'), adminId]
    );
  }
  const fiscalYearId = fy.rows[0].id as string;

  const mkCalendar = async (currency = 'IQD') => {
    const cal = await withTransaction((c) =>
      createPayrollCalendar(c, {
        code: uniq('SRCAL'),
        name_ar: 'تقويم تكامل إرسال مراجعة',
        calendar_type: 'MONTHLY',
        currency_code: currency,
        effective_from: '2025-01-01',
        created_by: adminId,
      })
    );
    owned.calendarIds.push(cal.id);
    return cal;
  };
  const mkPeriod = async (calendarId: string) => {
    const p = await withTransaction((c) =>
      createPayrollPeriod(c, {
        payroll_calendar_id: calendarId,
        name_ar: 'فترة تكامل إرسال مراجعة',
        start_date: '2025-01-01',
        end_date: '2025-01-31',
        fiscal_year_id: fiscalYearId,
        created_by: adminId,
      })
    );
    owned.periodIds.push(p.id);
    return p;
  };
  const mkPerson = async (over: Record<string, unknown> = {}) => {
    const p = await withTransaction((c) =>
      createPayrollPerson(c, {
        full_name_ar: 'شخص تكامل إرسال مراجعة',
        person_type: 'EMPLOYEE',
        default_currency_code: 'IQD',
        effective_from: '2025-01-01',
        created_by: adminId,
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
        created_by: adminId,
      });
      owned.contractIds.push(draft.id);
      return transitionPayrollContract(client, {
        id: draft.id,
        userId: adminId,
        version: draft.version,
        updated_at: draft.updated_at,
        action: 'activate',
      });
    });
  };
  const mkFixedComponent = async (amount = '100000') => {
    const comp = await withTransaction((c) =>
      createPayrollComponent(c, {
        component_code: uniq('SRFIX'),
        name_ar: 'بدل ثابت تكامل إرسال',
        component_type: 'EARNING',
        calculation_method: 'FIXED_AMOUNT',
        calculation_base_type: 'NONE',
        default_amount: amount,
        effective_from: '2025-01-01',
        created_by: adminId,
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
        created_by: adminId,
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
        created_by: adminId,
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
        userId: adminId,
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

  /** بذرة CALCULATED عبر API الاحتساب ثم جاهزة للإرسال للمراجعة. */
  const seedCalculated = async (amount = '77000') => {
    const cal = await mkCalendar();
    const period = await mkPeriod(cal.id);
    const person = await mkPerson();
    const contract = await mkContract(person.id);
    const fix = await mkFixedComponent(amount);
    await mkPca(person.id, fix.id, { payroll_contract_id: contract.id, amount });
    const draft = await mkRunWithPerson(period.id, person.id);
    const calcRes = await postCalculate(draft.id, adminId, adminUser, readyCalcBody(draft));
    assert(calcRes.status === 200, `seed calc ${calcRes.status}`);
    const calcBody = (await calcRes.json()) as {
      run?: {
        id: string;
        status: string;
        version: number;
        updated_at: string;
        gross_total: string;
        snapshot_hash: string | null;
        error_count: number;
      };
    };
    assert(calcBody.run?.status === 'CALCULATED', 'seed CALCULATED');
    const run = await withTransaction((c) => loadPayrollRun(c, draft.id));
    return {
      cal,
      period,
      person,
      contract,
      fix,
      run,
      gross_total: String(calcBody.run?.gross_total ?? run.gross_total),
    };
  };

  try {
    // —— UI helpers ——
    await it('1) UI: CAP.SUBMIT_REVIEW === payroll_submit_review ويطابق PAYROLL_CAPABILITIES', async () => {
      assert(CAP.SUBMIT_REVIEW === 'payroll_submit_review', CAP.SUBMIT_REVIEW);
      assert(
        CAP.SUBMIT_REVIEW === PAYROLL_CAPABILITIES.SUBMIT_REVIEW,
        'CAP يطابق PAYROLL_CAPABILITIES'
      );
    });

    await it('2) UI: runSubmitReviewUrl شكل المسار', async () => {
      const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      assert(
        runSubmitReviewUrl(id) === `/api/accounts/payroll/runs/${id}/submit-review`,
        runSubmitReviewUrl(id)
      );
    });

    // —— Success ——
    await it('3) Admin نجاح → 200 UNDER_REVIEW و approval_cycle>=1', async () => {
      const seeded = await seedCalculated('500000');
      const res = await postSubmitReview(seeded.run, adminId, adminUser);
      assert(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as {
        success?: boolean;
        idempotent_replay?: boolean;
        run?: { status: string; approval_cycle: number };
      };
      assert(body.success === true, 'success');
      assert(body.idempotent_replay === false, 'not replay');
      assert(body.run?.status === 'UNDER_REVIEW', `status ${body.run?.status}`);
      assert(Number(body.run?.approval_cycle) >= 1, `cycle ${body.run?.approval_cycle}`);
    });

    await it('4) totals typeof string', async () => {
      const seeded = await seedCalculated('120000');
      const res = await postSubmitReview(seeded.run, adminId, adminUser);
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
      assert(/^\d/.test(String(body.run?.gross_total)), 'gross digit');
      assert(typeof body.run?.net_total === 'string', 'net string');
      assert(typeof body.run?.deduction_total === 'string', 'deduction string');
      assert(
        typeof body.run?.employer_contribution_total === 'string',
        'employer string'
      );
    });

    await it('5) تعليق اختياري يُعاد في submission.comment', async () => {
      const seeded = await seedCalculated('130000');
      const comment = 'تعليق إرسال للمراجعة بعد التحقق';
      const res = await postSubmitReview(seeded.run, adminId, adminUser, { comment });
      assert(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as { submission?: { comment?: string | null } };
      assert(body.submission?.comment === normalizeApprovalComment(comment), `comment ${body.submission?.comment}`);
    });

    await it('6) GET بعد الإرسال: review_state UNDER_REVIEW و can_submit_for_review false', async () => {
      const seeded = await seedCalculated('135000');
      const submit = await postSubmitReview(seeded.run, adminId, adminUser);
      assert(submit.status === 200, `submit ${submit.status}`);
      const getRes = await getRun(seeded.run.id, adminId, adminUser);
      assert(getRes.status === 200, `get ${getRes.status}`);
      const body = (await getRes.json()) as {
        data?: {
          approval?: {
            review_state?: string;
            can_submit_for_review?: boolean;
          };
        };
      };
      assert(body.data?.approval?.review_state === 'UNDER_REVIEW', `state ${body.data?.approval?.review_state}`);
      assert(body.data?.approval?.can_submit_for_review === false, 'can_submit false');
    });

    // —— 403 ——
    await it('7) clerk → 403', async () => {
      const seeded = await seedCalculated('140000');
      const res = await postSubmitReview(seeded.run, clerkId, clerkUser);
      assert(res.status === 403, `status ${res.status}`);
    });

    await it('8) صلاحية احتساب فقط بلا SUBMIT_REVIEW → 403', async () => {
      const seeded = await seedCalculated('150000');
      __setPayrollCapabilitiesOverrideForTests(adminId, [
        PAYROLL_CAPABILITIES.VIEW,
        PAYROLL_CAPABILITIES.VIEW_RUNS,
        PAYROLL_CAPABILITIES.CALCULATE,
      ]);
      try {
        const res = await postSubmitReview(seeded.run, adminId, adminUser);
        assert(res.status === 403, `status ${res.status}`);
      } finally {
        __setPayrollCapabilitiesOverrideForTests(adminId, null);
      }
    });

    await it('9) صلاحية إعادة احتساب فقط بلا SUBMIT_REVIEW → 403', async () => {
      const seeded = await seedCalculated('155000');
      __setPayrollCapabilitiesOverrideForTests(adminId, [
        PAYROLL_CAPABILITIES.VIEW,
        PAYROLL_CAPABILITIES.VIEW_RUNS,
        PAYROLL_CAPABILITIES.RECALCULATE,
      ]);
      try {
        const res = await postSubmitReview(seeded.run, adminId, adminUser);
        assert(res.status === 403, `status ${res.status}`);
      } finally {
        __setPayrollCapabilitiesOverrideForTests(adminId, null);
      }
    });

    await it('10) بدون صلاحية إرسال (VIEW + VIEW_RUNS فقط) → 403', async () => {
      const seeded = await seedCalculated('160000');
      __setPayrollCapabilitiesOverrideForTests(adminId, [
        PAYROLL_CAPABILITIES.VIEW,
        PAYROLL_CAPABILITIES.VIEW_RUNS,
      ]);
      try {
        const res = await postSubmitReview(seeded.run, adminId, adminUser);
        assert(res.status === 403, `status ${res.status}`);
      } finally {
        __setPayrollCapabilitiesOverrideForTests(adminId, null);
      }
    });

    // —— 400 ——
    await it('11) UUID غير صالح → 400', async () => {
      const res = await postSubmitReview('not-a-uuid', adminId, adminUser, {
        version: 1,
        updated_at: new Date().toISOString(),
        key: randomUUID(),
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    await it('12) بدون confirmation → 400', async () => {
      const seeded = await seedCalculated('170000');
      const res = await postSubmitReview(seeded.run, adminId, adminUser, {
        confirmation: false,
      });
      assert(res.status === 400, `status ${res.status}`);
      const body = (await res.json()) as { message?: string; error?: { code?: string } };
      assert(
        body.error?.code === 'MISSING_CONFIRMATION' ||
          body.message?.includes('confirmation') ||
          body.message?.includes('تأكيد'),
        body.message ?? 'missing'
      );
    });

    await it('13) version غير صالح → 400', async () => {
      const seeded = await seedCalculated('180000');
      const res = await postSubmitReview(seeded.run, adminId, adminUser, {
        version: 'abc',
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    await it('14) updated_at غير صالح → 400', async () => {
      const seeded = await seedCalculated('190000');
      const res = await postSubmitReview(seeded.run, adminId, adminUser, {
        updated_at: '',
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    await it('15) بدون مفتاح → 400', async () => {
      const seeded = await seedCalculated('200000');
      const res = await postSubmitReview(seeded.run, adminId, adminUser, {
        omitKey: true,
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    await it('16) تعليق أطول من 500 → 400', async () => {
      const seeded = await seedCalculated('210000');
      const res = await postSubmitReview(seeded.run, adminId, adminUser, {
        comment: 'س'.repeat(501),
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    // —— 409 status ——
    await it('17) DRAFT → 409', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      await mkContract(person.id);
      const run = await mkRunWithPerson(period.id, person.id);
      const res = await postSubmitReview(run, adminId, adminUser);
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('18) CANCELLED → 409', async () => {
      const seeded = await seedCalculated('250000');
      const cancelRes = await postCancel(seeded.run.id, adminId, adminUser, {
        version: seeded.run.version,
        updated_at: isoAt(seeded.run.updated_at),
        reason: 'إلغاء لاختبار إرسال المراجعة',
      });
      assert(cancelRes.status === 200, `cancel ${cancelRes.status}`);
      const cancelled = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postSubmitReview(cancelled, adminId, adminUser);
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('19) UNDER_REVIEW مسبقاً → 409', async () => {
      const seeded = await seedCalculated('255000');
      const first = await postSubmitReview(seeded.run, adminId, adminUser);
      assert(first.status === 200, `first ${first.status}`);
      const under = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postSubmitReview(under, adminId, adminUser);
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('20) نسخة متقادمة → 409', async () => {
      const seeded = await seedCalculated('260000');
      const res = await postSubmitReview(seeded.run, adminId, adminUser, {
        version: seeded.run.version - 1,
      });
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('21) updated_at متقادم → 409', async () => {
      const seeded = await seedCalculated('270000');
      const res = await postSubmitReview(seeded.run, adminId, adminUser, {
        updated_at: '2000-01-01T00:00:00.000Z',
      });
      assert(res.status === 409, `status ${res.status}`);
    });

    // —— 422 ——
    await it('22) عملة USD → 422 + submit_review_blocked؛ الحالة تبقى CALCULATED', async () => {
      const seeded = await seedCalculated('280000');
      await query(
        `UPDATE accounts.payroll_periods SET currency_code='USD' WHERE id=$1::uuid`,
        [seeded.period.id]
      );
      await query(`UPDATE accounts.payroll_runs SET currency_code='USD' WHERE id=$1::uuid`, [
        seeded.run.id,
      ]);
      try {
        const fresh = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
        const beforeBlocked = await auditCount(seeded.run.id, 'payroll_run.submit_review_blocked');
        const res = await postSubmitReview(fresh, adminId, adminUser);
        assert(res.status === 422, `status ${res.status}`);
        const body = (await res.json()) as { message?: string; error?: { code?: string } };
        assert(
          body.error?.code === 'UNSUPPORTED_PAYROLL_CURRENCY' || body.message?.includes('IQD'),
          body.message ?? 'msg'
        );
        const blocked = await auditCount(seeded.run.id, 'payroll_run.submit_review_blocked');
        assert(blocked > beforeBlocked, 'blocked audit written');
        const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
        assert(after.status === 'CALCULATED', 'stays CALCULATED');
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

    await it('23) error_count>0 → 422 PAYROLL_HAS_ERRORS + blocked', async () => {
      const seeded = await seedCalculated('290000');
      await query(`UPDATE accounts.payroll_runs SET error_count=1 WHERE id=$1::uuid`, [
        seeded.run.id,
      ]);
      const fresh = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const beforeBlocked = await auditCount(seeded.run.id, 'payroll_run.submit_review_blocked');
      const res = await postSubmitReview(fresh, adminId, adminUser);
      assert(res.status === 422, `status ${res.status}`);
      const body = (await res.json()) as { error?: { code?: string }; message?: string };
      assert(
        body.error?.code === 'PAYROLL_HAS_ERRORS' || body.message?.includes('أخطاء'),
        body.message ?? 'msg'
      );
      const blocked = await auditCount(seeded.run.id, 'payroll_run.submit_review_blocked');
      assert(blocked > beforeBlocked, 'blocked audit');
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(after.status === 'CALCULATED', 'still CALCULATED');
    });

    await it('24) مشكلة حاجبة ERROR → 422 PAYROLL_HAS_BLOCKING_ISSUES', async () => {
      const seeded = await seedCalculated('300000');
      await query(
        `INSERT INTO accounts.payroll_run_issues
           (payroll_run_id, severity, issue_code, message_ar, is_blocking, created_by)
         VALUES ($1::uuid, 'ERROR', 'TEST_BLOCKING_ISSUE', 'مشكلة حاجبة لاختبار الإرسال', TRUE, $2::uuid)`,
        [seeded.run.id, adminId]
      );
      const fresh = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postSubmitReview(fresh, adminId, adminUser);
      assert(res.status === 422, `status ${res.status}`);
      const body = (await res.json()) as { error?: { code?: string }; message?: string };
      assert(
        body.error?.code === 'PAYROLL_HAS_BLOCKING_ISSUES' || body.message?.includes('حاجبة'),
        body.message ?? 'msg'
      );
    });

    await it('25) مسح snapshot_hash → 422', async () => {
      const seeded = await seedCalculated('310000');
      await query(`UPDATE accounts.payroll_runs SET snapshot_hash=NULL WHERE id=$1::uuid`, [
        seeded.run.id,
      ]);
      const fresh = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postSubmitReview(fresh, adminId, adminUser);
      assert(res.status === 422, `status ${res.status}`);
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(after.status === 'CALCULATED', 'stays CALCULATED');
    });

    // —— GET readiness ——
    await it('26) GET CALCULATED نظيف: can_submit_for_review true للمدير', async () => {
      const seeded = await seedCalculated('320000');
      const getRes = await getRun(seeded.run.id, adminId, adminUser);
      assert(getRes.status === 200, `get ${getRes.status}`);
      const body = (await getRes.json()) as {
        data?: {
          approval?: {
            can_submit_for_review?: boolean;
            readiness_for_review?: boolean;
          };
        };
      };
      assert(body.data?.approval?.can_submit_for_review === true, 'can_submit true');
      assert(body.data?.approval?.readiness_for_review === true, 'ready');
    });

    await it('27) GET مع HAS_ERRORS: can_submit false و readiness_blockers يتضمن HAS_ERRORS', async () => {
      const seeded = await seedCalculated('330000');
      await query(`UPDATE accounts.payroll_runs SET error_count=1 WHERE id=$1::uuid`, [
        seeded.run.id,
      ]);
      const getRes = await getRun(seeded.run.id, adminId, adminUser);
      assert(getRes.status === 200, `get ${getRes.status}`);
      const body = (await getRes.json()) as {
        data?: {
          approval?: {
            can_submit_for_review?: boolean;
            readiness_blockers?: string[];
          };
        };
      };
      assert(body.data?.approval?.can_submit_for_review === false, 'can_submit false');
      assert(
        (body.data?.approval?.readiness_blockers ?? []).includes('HAS_ERRORS'),
        `blockers ${body.data?.approval?.readiness_blockers?.join(',')}`
      );
    });

    // —— Idempotency ——
    await it('28) إعادة نفس المفتاح → idempotent_replay true', async () => {
      const seeded = await seedCalculated('340000');
      const key = randomUUID();
      const first = await postSubmitReview(seeded.run, adminId, adminUser, { key });
      assert(first.status === 200, `first ${first.status}`);
      const firstBody = (await first.json()) as {
        idempotent_replay?: boolean;
        run?: { status: string; version: number };
      };
      assert(firstBody.idempotent_replay === false, 'first not replay');
      const second = await postSubmitReview(seeded.run, adminId, adminUser, { key });
      assert(second.status === 200, `second ${second.status}`);
      const secondBody = (await second.json()) as { idempotent_replay?: boolean };
      assert(secondBody.idempotent_replay === true, 'replay');
    });

    await it('29) replay بلا تكرار إجراء SUBMITTED_FOR_REVIEW (count=1)', async () => {
      const seeded = await seedCalculated('350000');
      const key = randomUUID();
      const first = await postSubmitReview(seeded.run, adminId, adminUser, { key });
      assert(first.status === 200, `first ${first.status}`);
      assert((await submitActionCount(seeded.run.id)) === 1, 'action=1');
      const second = await postSubmitReview(seeded.run, adminId, adminUser, { key });
      assert(second.status === 200, `replay ${second.status}`);
      assert((await submitActionCount(seeded.run.id)) === 1, 'still 1');
    });

    await it('30) replay بلا تغيّر version/updated_at', async () => {
      const seeded = await seedCalculated('360000');
      const key = randomUUID();
      const first = await postSubmitReview(seeded.run, adminId, adminUser, { key });
      const firstBody = (await first.json()) as {
        run?: { version: number; updated_at: string };
      };
      const second = await postSubmitReview(seeded.run, adminId, adminUser, { key });
      const secondBody = (await second.json()) as {
        idempotent_replay?: boolean;
        run?: { version: number; updated_at: string };
      };
      assert(secondBody.idempotent_replay === true, 'replay');
      assert(secondBody.run?.version === firstBody.run?.version, 'version same');
      assert(
        isoAt(secondBody.run?.updated_at) === isoAt(firstBody.run?.updated_at),
        'updated_at same'
      );
    });

    await it('31) نفس المفتاح + تعليق مختلف → 409 IDEMPOTENCY_CONFLICT', async () => {
      const seeded = await seedCalculated('370000');
      const key = randomUUID();
      const first = await postSubmitReview(seeded.run, adminId, adminUser, {
        key,
        comment: 'التعليق الأول للإرسال',
      });
      assert(first.status === 200, `first ${first.status}`);
      const second = await postSubmitReview(seeded.run, adminId, adminUser, {
        key,
        comment: 'تعليق مختلف تماماً للإرسال',
      });
      assert(second.status === 409, `status ${second.status}`);
      const body = (await second.json()) as { error?: { code?: string }; message?: string };
      assert(
        body.error?.code === 'IDEMPOTENCY_CONFLICT' ||
          body.message?.includes('مفتاح') ||
          body.message?.includes('مختلفة'),
        body.message ?? 'msg'
      );
    });

    // —— Integrity ——
    await it('32) إجراء اعتماد تالف → 409 APPROVAL_INTEGRITY أو CONFLICT؛ بلا طفرة', async () => {
      const seeded = await seedCalculated('380000');
      const key = `corrupt-submit-${token}`;
      const normalizedKey = normalizeApprovalIdempotencyKey(key);
      const keyHash = buildApprovalRequestKeyHash('SUBMIT_FOR_REVIEW', normalizedKey);
      const expectedVersion = seeded.run.version;
      const expectedUpdatedAt = isoAt(seeded.run.updated_at);
      // Core يعيد حساب الحمولة بـ prior.snapshot_hash عند وجود سجل سابق —
      // لذلك نزرع payload_hash متوافقاً مع البصمة التالفة حتى نصل لفحص السلامة.
      const corruptSnapshot = 'incomplete-hash-missing-fields';
      const payloadHash = buildApprovalRequestPayloadHash('SUBMIT_FOR_REVIEW', {
        run_id: seeded.run.id,
        expected_version: expectedVersion,
        expected_updated_at: expectedUpdatedAt,
        snapshot_hash: corruptSnapshot,
        normalized_comment: '',
      });
      await query(
        `INSERT INTO accounts.payroll_run_approval_actions
           (payroll_run_id, payroll_period_id, approval_cycle, action, from_status, to_status,
            actor_id, actor_display_name_snapshot, comment, reason, snapshot_hash,
            version_before, version_after, request_key_hash, request_payload_hash, request_key_masked)
         VALUES ($1::uuid,$2::uuid,1,'SUBMITTED_FOR_REVIEW','CALCULATED','UNDER_REVIEW',
                 $3::uuid,'اختبار تالف',NULL,NULL,$7,
                 $4,$4,$5,$6,'corrupt…key')`,
        [
          seeded.run.id,
          seeded.period.id,
          adminId,
          seeded.run.version,
          keyHash,
          payloadHash,
          corruptSnapshot,
        ]
      );
      const before = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const artsBefore = await withTransaction((c) => loadRunCalculationArtifacts(c, before.id));
      const auditsBefore = await auditCount(seeded.run.id, 'payroll_run.submitted_for_review');
      const res = await postSubmitReview(before, adminId, adminUser, { key });
      assert(res.status === 409, `status ${res.status}`);
      const body = (await res.json()) as { error?: { code?: string }; message?: string };
      assert(
        body.error?.code === 'APPROVAL_INTEGRITY_CONFLICT' ||
          body.error?.code === 'CONFLICT' ||
          body.error?.code === 'IDEMPOTENCY_CONFLICT' ||
          (body.message ?? '').includes('سلامة') ||
          (body.message ?? '').includes('تالف'),
        `code ${body.error?.code}`
      );
      const after = await withTransaction((c) => loadPayrollRun(c, before.id));
      assert(after.status === 'CALCULATED', 'no status mutation');
      assert(after.version === before.version, 'no version bump');
      const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, before.id));
      assert(arts.people.length === artsBefore.people.length, 'people frozen');
      assert(
        (await auditCount(seeded.run.id, 'payroll_run.submitted_for_review')) === auditsBefore,
        'no new success audit'
      );
    });

    // —— Concurrency ——
    await it('33) Concurrent Submit×2 → واحد 200 وواحد 409؛ UNDER_REVIEW؛ إجراء إرسال واحد', async () => {
      const seeded = await seedCalculated('390000');
      const key1 = randomUUID();
      const key2 = randomUUID();
      const settled = await Promise.allSettled([
        postSubmitReview(seeded.run, adminId, adminUser, { key: key1 }),
        postSubmitReview(seeded.run, adminId, adminUser, { key: key2 }),
      ]);
      const responses = [];
      for (const s of settled) {
        assert(s.status === 'fulfilled', 'settled fulfilled');
        if (s.status === 'fulfilled') responses.push(s.value);
      }
      assert(responses.length === 2, 'both settled');
      const statuses = responses.map((r) => r.status);
      const okN = statuses.filter((s) => s === 200).length;
      const conflictN = statuses.filter((s) => s === 409).length;
      assert(okN === 1, `okN ${okN} statuses ${statuses.join(',')}`);
      assert(conflictN === 1, `conflictN ${conflictN}`);
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(after.status === 'UNDER_REVIEW', `final ${after.status}`);
      assert((await submitActionCount(seeded.run.id)) === 1, 'one submit action');
    });

    await it('34) Concurrent Submit×Recalculate → UNDER_REVIEW أو CALCULATED متسق', async () => {
      const seeded = await seedCalculated('400000');
      const settled = await Promise.allSettled([
        postSubmitReview(seeded.run, adminId, adminUser),
        postRecalculate(seeded.run, adminId, adminUser, {
          reason: 'تزامن إعادة احتساب مع إرسال للمراجعة',
        }),
      ]);
      assert(settled.length === 2, 'both settled');
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(
        after.status === 'UNDER_REVIEW' || after.status === 'CALCULATED',
        `status ${after.status}`
      );
      assert(after.status !== 'CALCULATING', 'not stuck');
    });

    await it('35) Concurrent Submit×Cancel → UNDER_REVIEW أو CANCELLED', async () => {
      const seeded = await seedCalculated('410000');
      const settled = await Promise.allSettled([
        postSubmitReview(seeded.run, adminId, adminUser),
        postCancel(seeded.run.id, adminId, adminUser, {
          version: seeded.run.version,
          updated_at: isoAt(seeded.run.updated_at),
          reason: 'إلغاء متزامن مع إرسال للمراجعة',
        }),
      ]);
      assert(settled.length === 2, 'both settled');
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(
        after.status === 'UNDER_REVIEW' || after.status === 'CANCELLED',
        `status ${after.status}`
      );
    });

    // —— IDOR ——
    await it('36) visibility/IDOR: عشوائي submit 404؛ GET مفقود 404', async () => {
      const missing = randomUUID();
      const submitRes = await postSubmitReview(missing, adminId, adminUser, {
        version: 1,
        updated_at: new Date().toISOString(),
        key: randomUUID(),
      });
      assert(submitRes.status === 404, `submit ${submitRes.status}`);
      const getRes = await getRun(missing, viewerId, viewerUser);
      assert(getRes.status === 404, `get ${getRes.status}`);
    });

    // —— Failpoint ——
    await it('37) failpoint submit_after_validation → 500 TECHNICAL_FAILURE عربي بلا تسريب', async () => {
      const seeded = await seedCalculated('420000');
      __setPayrollApprovalFailpointForTests('submit_after_validation');
      try {
        const res = await postSubmitReview(seeded.run, adminId, adminUser);
        assert(res.status === 500, `status ${res.status}`);
        const body = (await res.json()) as { message?: string; error?: { code?: string } };
        const msg = String(body.message ?? '');
        assert(
          body.error?.code === 'TECHNICAL_FAILURE' || msg.includes('خطأ تقني'),
          msg || 'msg'
        );
        assert(msg.includes('دون تغيير') || msg.includes('بقيت'), msg);
        assert(!msg.includes('FAILPOINT'), 'لا تسريب failpoint');
        assert(!msg.includes('SELECT'), 'لا SQL');
        assert(!/relation|pg_|syntax error/i.test(msg), 'no pg leak');
      } finally {
        __clearPayrollApprovalFailpointForTests();
      }
    });

    await it('38) بعد failpoint الحالة CALCULATED و version كما هي', async () => {
      const seeded = await seedCalculated('430000');
      const before = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      __setPayrollApprovalFailpointForTests('submit_after_validation');
      try {
        const res = await postSubmitReview(before, adminId, adminUser);
        assert(res.status === 500, `status ${res.status}`);
      } finally {
        __clearPayrollApprovalFailpointForTests();
      }
      const after = await withTransaction((c) => loadPayrollRun(c, before.id));
      assert(after.status === 'CALCULATED', `status ${after.status}`);
      assert(after.version === before.version, 'version same');
      assert(String(after.snapshot_hash) === String(before.snapshot_hash), 'hash same');
    });

    await it('39) تدقيق فشل submit_review_failed بلا مفتاح خام', async () => {
      const seeded = await seedCalculated('440000');
      const rawKey = `raw-failed-key-${token}-${randomUUID()}`;
      __setPayrollApprovalFailpointForTests('submit_after_validation');
      try {
        const res = await postSubmitReview(seeded.run, adminId, adminUser, { key: rawKey });
        assert(res.status === 500, `status ${res.status}`);
      } finally {
        __clearPayrollApprovalFailpointForTests();
      }
      const audit = await latestAudit(seeded.run.id, 'payroll_run.submit_review_failed');
      assert(audit, 'failed audit exists');
      assert(!jsonHasRawKey(audit?.new_values, rawKey), 'no raw key');
      assert(
        audit?.new_values?.idempotency_key_masked != null ||
          !('idempotency_key' in (audit?.new_values ?? {})),
        'masked or absent'
      );
    });

    // —— Audit safety ——
    await it('40) blocked audit بلا مفتاح خام (حالة USD)', async () => {
      const seeded = await seedCalculated('450000');
      const rawKey = `raw-blocked-key-${token}-${randomUUID()}`;
      await query(
        `UPDATE accounts.payroll_periods SET currency_code='USD' WHERE id=$1::uuid`,
        [seeded.period.id]
      );
      await query(`UPDATE accounts.payroll_runs SET currency_code='USD' WHERE id=$1::uuid`, [
        seeded.run.id,
      ]);
      try {
        const fresh = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
        const res = await postSubmitReview(fresh, adminId, adminUser, { key: rawKey });
        assert(res.status === 422, `status ${res.status}`);
        const audit = await latestAudit(seeded.run.id, 'payroll_run.submit_review_blocked');
        assert(audit, 'blocked audit exists');
        assert(!jsonHasRawKey(audit?.new_values, rawKey), 'no raw key in new_values');
        assert(
          audit?.new_values?.idempotency_key_masked != null ||
            !('idempotency_key' in (audit?.new_values ?? {})),
          'masked or absent'
        );
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

    await it('41) success audit payroll_run.submitted_for_review مرة واحدة', async () => {
      const seeded = await seedCalculated('460000');
      const res = await postSubmitReview(seeded.run, adminId, adminUser);
      assert(res.status === 200, `status ${res.status}`);
      assert((await auditCount(seeded.run.id, 'payroll_run.submitted_for_review')) === 1, 'once');
    });

    await it('42) المفتاح الخام غائب من الاستجابة وتدقيق النجاح', async () => {
      const seeded = await seedCalculated('470000');
      const rawKey = `visible-raw-key-${token}-${randomUUID()}`;
      const res = await postSubmitReview(seeded.run, adminId, adminUser, { key: rawKey });
      assert(res.status === 200, `status ${res.status}`);
      const body = await res.json();
      assert(!jsonHasRawKey(body, rawKey), 'no raw key in API body');
      const audit = await latestAudit(seeded.run.id, 'payroll_run.submitted_for_review');
      assert(audit, 'success audit');
      assert(!jsonHasRawKey(audit?.new_values, rawKey), 'no raw in audit new_values');
      assert(!jsonHasRawKey(audit?.old_values, rawKey), 'no raw in audit old_values');
      assert(!jsonHasRawKey(audit?.description, rawKey), 'no raw in description');
    });

    await it('43) request_key_hash / request_payload_hash غائبان من الاستجابة العامة', async () => {
      const seeded = await seedCalculated('480000');
      const res = await postSubmitReview(seeded.run, adminId, adminUser);
      assert(res.status === 200, `status ${res.status}`);
      const body = await res.json();
      const s = JSON.stringify(body);
      assert(!s.includes('request_key_hash'), 'no request_key_hash');
      assert(!s.includes('request_payload_hash'), 'no request_payload_hash');
    });

    await it('44) بلا snapshot_json في الاستجابة', async () => {
      const seeded = await seedCalculated('490000');
      const res = await postSubmitReview(seeded.run, adminId, adminUser);
      assert(res.status === 200, `status ${res.status}`);
      const body = await res.json();
      assert(!JSON.stringify(body).includes('snapshot_json'), 'no snapshot_json');
    });

    // —— Lock behavior ——
    await it('45) بعد UNDER_REVIEW إعادة احتساب → 409', async () => {
      const seeded = await seedCalculated('500000');
      const submit = await postSubmitReview(seeded.run, adminId, adminUser);
      assert(submit.status === 200, `submit ${submit.status}`);
      const under = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postRecalculate(under, adminId, adminUser, {
        reason: 'محاولة إعادة احتساب بعد الإرسال للمراجعة',
      });
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('46) بعد UNDER_REVIEW إلغاء → 409', async () => {
      const seeded = await seedCalculated('510000');
      const submit = await postSubmitReview(seeded.run, adminId, adminUser);
      assert(submit.status === 200, `submit ${submit.status}`);
      const under = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postCancel(under.id, adminId, adminUser, {
        version: under.version,
        updated_at: isoAt(under.updated_at),
        reason: 'محاولة إلغاء بعد الإرسال للمراجعة',
      });
      assert(res.status === 409, `status ${res.status}`);
    });

    await it('47) بعد UNDER_REVIEW PATCH تشغيل → 409', async () => {
      const seeded = await seedCalculated('520000');
      const submit = await postSubmitReview(seeded.run, adminId, adminUser);
      assert(submit.status === 200, `submit ${submit.status}`);
      const under = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await patchRun(under.id, adminId, adminUser, {
        version: under.version,
        updated_at: isoAt(under.updated_at),
        run_type: 'REGULAR',
      });
      assert(res.status === 409, `status ${res.status}`);
    });

    // —— Period closed ——
    await it('48) إغلاق الفترة → submit 422 PAYROLL_PERIOD_NOT_OPEN؛ التشغيل يبقى CALCULATED', async () => {
      const seeded = await seedCalculated('530000');
      await query(
        `UPDATE accounts.payroll_periods
         SET status='CLOSED', closed_at=NOW(), closed_by=$2::uuid, updated_at=NOW(), version=version+1
         WHERE id=$1::uuid`,
        [seeded.period.id, adminId]
      );
      try {
        const fresh = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
        const res = await postSubmitReview(fresh, adminId, adminUser);
        assert(res.status === 422, `status ${res.status}`);
        const blockedBody = (await res.json()) as { error?: { code?: string } };
        assert(blockedBody.error?.code === 'PAYROLL_PERIOD_NOT_OPEN', blockedBody.error?.code ?? 'code');
        const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
        assert(after.status === 'CALCULATED', `status ${after.status}`);
      } finally {
        await query(
          `UPDATE accounts.payroll_periods
           SET status='OPEN', closed_at=NULL, closed_by=NULL, updated_at=NOW(), version=version+1
           WHERE id=$1::uuid`,
          [seeded.period.id]
        );
      }
    });
  } finally {
    console.log('— تنظيف سجلات الاختبار المملوكة —');
    try {
      await cleanupOwned();
      const left = await countOwned();
      console.log(`cleanup leftover count = ${left}`);
      await it('49) Cleanup leftover = 0', async () => {
        assert(left === 0, `بقايا ${left}`);
      });
    } catch (e) {
      failed('49) Cleanup leftover = 0', e);
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
