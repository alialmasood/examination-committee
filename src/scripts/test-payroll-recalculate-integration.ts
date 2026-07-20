/**
 * اختبارات HTTP لتكامل إعادة احتساب الرواتب 9.A.2.4.2
 * npm run test:payroll-recalculate-integration
 *
 * عزل: ownership token + cleanupOwned في finally.
 * تشغيل مرتين يجب أن يترك 0 صفوف مملوكة.
 *
 * سلوكيات الصفحة (React) تُغطّى عبر HTTP + فحوصات المساعدات النقية
 * (CAP.RECALCULATE / runRecalculateUrl / runRecalculationsUrl) — بلا RTL.
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
  __clearPayrollRecalcFailpointForTests,
  __setPayrollRecalcFailpointForTests,
} from '../lib/accounts/payroll-recalculate-failpoints';
import {
  buildRecalculateRequestKeyHash,
  buildRecalculateRequestPayloadHash,
  normalizeRecalculateIdempotencyKey,
  normalizeRecalculateReason,
} from '../lib/accounts/payroll-recalculate-idempotency';
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
import {
  CAP,
  runRecalculateUrl,
  runRecalculationsUrl,
} from '../../app/accounts/payroll/_lib';

import { POST as recalculatePost } from '../../app/api/accounts/payroll/runs/[id]/recalculate/route';
import { GET as recalculationsGet } from '../../app/api/accounts/payroll/runs/[id]/recalculations/route';
import { GET as runGet, PATCH as runPatch } from '../../app/api/accounts/payroll/runs/[id]/route';
import { POST as calculatePost } from '../../app/api/accounts/payroll/runs/[id]/calculate/route';
import { POST as cancelPost } from '../../app/api/accounts/payroll/runs/[id]/cancel/route';

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
    __clearPayrollCapabilitiesOverrideForTests();
  }
}
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const DEFAULT_REASON = 'تعديل الراتب الأساسي بعد المراجعة';

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

async function upsertUser(username: string, withAccounts: boolean): Promise<string> {
  const hash = await bcrypt.hash('test-recalc-int-pass', 10);
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

type RecalcBody = {
  confirmation?: boolean;
  version?: unknown;
  updated_at?: unknown;
  idempotency_key?: string;
  reason?: string;
};

type RunLike = { id: string; version: number; updated_at: unknown };

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
    omitKey?: boolean;
    omitReason?: boolean;
  } = {}
) {
  const runId = typeof run === 'string' ? run : run.id;
  const body: RecalcBody = {};
  if (opts.confirmation !== undefined) body.confirmation = opts.confirmation;
  else body.confirmation = true;

  if (opts.version !== undefined) body.version = opts.version;
  else if (typeof run !== 'string') body.version = run.version;

  if (opts.updated_at !== undefined) body.updated_at = opts.updated_at;
  else if (typeof run !== 'string') body.updated_at = isoAt(run.updated_at);

  if (!opts.omitKey) {
    body.idempotency_key = opts.key ?? randomUUID();
  }
  if (!opts.omitReason) {
    body.reason = opts.reason ?? DEFAULT_REASON;
  }

  return recalculatePost(
    authReq(`http://localhost/api/accounts/payroll/runs/${runId}/recalculate`, userId, username, {
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

async function getRun(runId: string, userId: string, username: string) {
  return runGet(authReq(`http://localhost/api/accounts/payroll/runs/${runId}`, userId, username), {
    params: Promise.resolve({ id: runId }),
  });
}

async function getRecalculations(runId: string, userId: string, username: string) {
  return recalculationsGet(
    authReq(`http://localhost/api/accounts/payroll/runs/${runId}/recalculations`, userId, username),
    { params: Promise.resolve({ id: runId }) }
  );
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

function jsonHasForbiddenHashes(obj: unknown): boolean {
  const s = JSON.stringify(obj ?? {});
  return (
    s.includes('request_key_hash') ||
    s.includes('request_payload_hash') ||
    s.includes('snapshot_json')
  );
}

async function main() {
  console.log('===== اختبارات تكامل إعادة احتساب الرواتب 9.A.2.4.2 =====');
  const token = `RI${Date.now().toString(36).toUpperCase()}`;
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

  const clerkUser = `test-ri-clerk-${token.toLowerCase()}`;
  const viewerUser = `test-ri-viewer-${token.toLowerCase()}`;
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
       VALUES ($1,'سنة تكامل إعادة احتساب','2025-01-01','2025-12-31','ACTIVE',FALSE,$2) RETURNING id`,
      [uniq('RIFY'), adminId]
    );
  }
  const fiscalYearId = fy.rows[0].id as string;

  const mkCalendar = async (currency = 'IQD') => {
    const cal = await withTransaction((c) =>
      createPayrollCalendar(c, {
        code: uniq('RICAL'),
        name_ar: 'تقويم تكامل إعادة',
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
        name_ar: 'فترة تكامل إعادة',
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
        full_name_ar: 'شخص تكامل إعادة',
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
        component_code: uniq('RIFIX'),
        name_ar: 'بدل ثابت تكامل إعادة',
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

  /** بذرة CALCULATED عبر API الاحتساب ثم جاهزة لإعادة الاحتساب. */
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
    // —— UI helpers (نقية) ——
    await it('UI: CAP.RECALCULATE === payroll_recalculate', async () => {
      assert(CAP.RECALCULATE === 'payroll_recalculate', CAP.RECALCULATE);
      assert(
        CAP.RECALCULATE === PAYROLL_CAPABILITIES.RECALCULATE,
        'CAP يطابق PAYROLL_CAPABILITIES'
      );
    });
    await it('UI: runRecalculateUrl شكل المسار', async () => {
      const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      assert(
        runRecalculateUrl(id) === `/api/accounts/payroll/runs/${id}/recalculate`,
        runRecalculateUrl(id)
      );
    });
    await it('UI: runRecalculationsUrl شكل المسار', async () => {
      const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      assert(
        runRecalculationsUrl(id) === `/api/accounts/payroll/runs/${id}/recalculations`,
        runRecalculationsUrl(id)
      );
    });

    // —— 1) Admin success ——
    await it('1) Admin نجاح → 200 CALCULATED', async () => {
      const seeded = await seedCalculated('500000');
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
        reason: 'إعادة احتساب ناجحة من المدير',
      });
      assert(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as {
        success?: boolean;
        idempotent_replay?: boolean;
        run?: { status: string };
      };
      assert(body.success === true, 'success');
      assert(body.idempotent_replay === false, 'not replay');
      assert(body.run?.status === 'CALCULATED', `status ${body.run?.status}`);
    });

    // —— 2) Decimal strings ——
    await it('2) totals typeof string (gross_total)', async () => {
      const seeded = await seedCalculated('120000');
      const res = await postRecalculate(seeded.run, adminId, adminUser);
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

    // —— 3) Reason returned ——
    await it('3) السبب يُعاد بأمان في recalculation.reason', async () => {
      const seeded = await seedCalculated('130000');
      const reason = 'سبب واضح لإعادة الاحتساب بعد مراجعة الرواتب';
      const res = await postRecalculate(seeded.run, adminId, adminUser, { reason });
      assert(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as { recalculation?: { reason?: string } };
      assert(body.recalculation?.reason === reason, `reason ${body.recalculation?.reason}`);
    });

    // —— 4) No capability clerk ——
    await it('4) clerk بلا صلاحية → 403', async () => {
      const seeded = await seedCalculated('140000');
      const res = await postRecalculate(seeded.run, clerkId, clerkUser);
      assert(res.status === 403, `status ${res.status}`);
    });

    // —— 5) Calculate-only capability ——
    await it('5) صلاحية احتساب فقط بلا RECALCULATE → 403', async () => {
      const seeded = await seedCalculated('150000');
      __setPayrollCapabilitiesOverrideForTests(adminId, [
        PAYROLL_CAPABILITIES.VIEW,
        PAYROLL_CAPABILITIES.VIEW_RUNS,
        PAYROLL_CAPABILITIES.CALCULATE,
      ]);
      try {
        const res = await postRecalculate(seeded.run, adminId, adminUser);
        assert(res.status === 403, `status ${res.status}`);
      } finally {
        __setPayrollCapabilitiesOverrideForTests(adminId, null);
      }
    });

    // —— 6) Invalid UUID ——
    await it('6) UUID غير صالح → 400', async () => {
      const res = await postRecalculate('not-a-uuid', adminId, adminUser, {
        version: 1,
        updated_at: new Date().toISOString(),
        key: randomUUID(),
        reason: DEFAULT_REASON,
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    // —— 7) Missing confirmation ——
    await it('7) بدون confirmation → 400', async () => {
      const seeded = await seedCalculated('170000');
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
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

    // —— 8) Invalid version ——
    await it('8) version غير صالح → 400', async () => {
      const seeded = await seedCalculated('180000');
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
        version: 'abc',
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    // —— 9) Invalid updated_at ——
    await it('9) updated_at غير صالح → 400', async () => {
      const seeded = await seedCalculated('190000');
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
        updated_at: '',
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    // —— 10) Missing key ——
    await it('10) بدون مفتاح → 400', async () => {
      const seeded = await seedCalculated('200000');
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
        omitKey: true,
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    // —— 11) Missing reason ——
    await it('11) بدون سبب → 400', async () => {
      const seeded = await seedCalculated('210000');
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
        omitReason: true,
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    // —— 12) Short reason ——
    await it('12) سبب قصير → 400', async () => {
      const seeded = await seedCalculated('220000');
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
        reason: 'قصير',
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    // —— 13) Too-long reason ——
    await it('13) سبب أطول من 500 → 400', async () => {
      const seeded = await seedCalculated('230000');
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
        reason: 'س'.repeat(501),
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    // —— 14) DRAFT ——
    await it('14) DRAFT → 409', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      await mkContract(person.id);
      const run = await mkRunWithPerson(period.id, person.id);
      const res = await postRecalculate(run, adminId, adminUser);
      assert(res.status === 409, `status ${res.status}`);
    });

    // —— 15) CANCELLED ——
    await it('15) CANCELLED → 409', async () => {
      const seeded = await seedCalculated('250000');
      const cancelRes = await postCancel(seeded.run.id, adminId, adminUser, {
        version: seeded.run.version,
        updated_at: isoAt(seeded.run.updated_at),
        reason: 'إلغاء لاختبار إعادة الاحتساب',
      });
      assert(cancelRes.status === 200, `cancel ${cancelRes.status}`);
      const cancelled = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postRecalculate(cancelled, adminId, adminUser);
      assert(res.status === 409, `status ${res.status}`);
    });

    // —— 16) stale version ——
    await it('16) نسخة متقادمة → 409', async () => {
      const seeded = await seedCalculated('260000');
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
        version: seeded.run.version - 1,
      });
      assert(res.status === 409, `status ${res.status}`);
    });

    // —— 17) stale updated_at ——
    await it('17) updated_at متقادم → 409', async () => {
      const seeded = await seedCalculated('270000');
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
        updated_at: '2000-01-01T00:00:00.000Z',
      });
      assert(res.status === 409, `status ${res.status}`);
    });

    // —— 18) unsupported currency USD ——
    await it('18) عملة USD → 422 + blocked audit', async () => {
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
        const beforeBlocked = await auditCount(
          seeded.run.id,
          'payroll_run.recalculation_blocked'
        );
        const res = await postRecalculate(fresh, adminId, adminUser, {
          reason: 'محاولة إعادة احتساب بعملة غير مدعومة',
        });
        assert(res.status === 422, `status ${res.status}`);
        const body = (await res.json()) as { message?: string; error?: { code?: string } };
        assert(
          body.error?.code === 'UNSUPPORTED_PAYROLL_CURRENCY' ||
            body.message?.includes('IQD'),
          body.message ?? 'msg'
        );
        const blocked = await auditCount(seeded.run.id, 'payroll_run.recalculation_blocked');
        assert(blocked > beforeBlocked, 'blocked audit written');
        const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
        assert(after.status === 'CALCULATED', 'snapshot survives');
        assert(String(after.snapshot_hash) === String(seeded.run.snapshot_hash), 'hash same');
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

    // —— 19) empty PERSON_LIST ——
    await it('19) PERSON_LIST فارغة → 422 + blocked audit', async () => {
      const seeded = await seedCalculated('290000');
      await query(
        `DELETE FROM accounts.payroll_run_scope_members WHERE payroll_run_id=$1::uuid`,
        [seeded.run.id]
      );
      const fresh = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const beforeBlocked = await auditCount(
        seeded.run.id,
        'payroll_run.recalculation_blocked'
      );
      const res = await postRecalculate(fresh, adminId, adminUser, {
        reason: 'محاولة إعادة احتساب لقائمة أشخاص فارغة',
      });
      assert(res.status === 422, `status ${res.status}`);
      const body = (await res.json()) as { error?: { code?: string }; message?: string };
      assert(
        body.error?.code === 'EMPTY_PERSON_LIST' || body.message?.includes('فارغة'),
        body.message ?? 'msg'
      );
      const blocked = await auditCount(seeded.run.id, 'payroll_run.recalculation_blocked');
      assert(blocked > beforeBlocked, 'blocked audit');
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(after.status === 'CALCULATED', 'still CALCULATED');
    });

    // —— 20) changed totals ——
    await it('20) نجاح مع تغيّر الإجماليات', async () => {
      const seeded = await seedCalculated('80000');
      const beforeGross = seeded.gross_total;
      const beforeHash = String(seeded.run.snapshot_hash);
      await query(
        `UPDATE accounts.payroll_component_assignments
         SET amount = 150000, updated_at=NOW(), version=version+1
         WHERE payroll_person_id=$1::uuid`,
        [seeded.person.id]
      );
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
        reason: 'تعديل مبلغ البدل الثابت بعد الاحتساب',
      });
      assert(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as {
        run?: { gross_total: string; snapshot_hash: string };
        recalculation?: { no_change?: boolean };
        idempotent_replay?: boolean;
      };
      assert(body.idempotent_replay === false, 'not replay');
      assert(body.run?.gross_total !== beforeGross, `gross ${body.run?.gross_total}`);
      assert(body.run?.snapshot_hash !== beforeHash, 'hash changed');
      assert(body.recalculation?.no_change === false, 'no_change false');
    });

    // —— 21) mixed ERROR ——
    await it('21) شخص ERROR بعد عملة عقد USD', async () => {
      const seeded = await seedCalculated('81000');
      await query(
        `UPDATE accounts.payroll_contracts
         SET currency_code='USD', updated_at=NOW(), version=version+1
         WHERE id=$1::uuid`,
        [seeded.contract.id]
      );
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
        reason: 'إعادة احتساب بعد تعارض عملة العقد',
      });
      assert(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as {
        run?: { status: string; error_count: number };
        summary?: { error_people: number };
      };
      assert(body.run?.status === 'CALCULATED', 'CALCULATED');
      assert(Number(body.run?.error_count) > 0, `error_count ${body.run?.error_count}`);
    });

    // —— 22) same-key replay ——
    await it('22) إعادة نفس المفتاح → 200 idempotent_replay', async () => {
      const seeded = await seedCalculated('82000');
      const key = randomUUID();
      // replay يجب أن يعيد نفس جسم الطلب (version/updated_at الأصليين)
      const first = await postRecalculate(seeded.run, adminId, adminUser, {
        key,
        reason: DEFAULT_REASON,
      });
      assert(first.status === 200, `first ${first.status}`);
      const firstBody = (await first.json()) as {
        run?: { version: number; updated_at: string; gross_total: string };
        idempotent_replay?: boolean;
      };
      assert(firstBody.idempotent_replay === false, 'first not replay');
      const second = await postRecalculate(seeded.run, adminId, adminUser, {
        key,
        reason: DEFAULT_REASON,
      });
      assert(second.status === 200, `second ${second.status}`);
      const secondBody = (await second.json()) as {
        idempotent_replay?: boolean;
        run?: { gross_total: string };
      };
      assert(secondBody.idempotent_replay === true, 'replay');
      assert(secondBody.run?.gross_total === firstBody.run?.gross_total, 'same totals');
    });

    // —— 23) replay no duplicate success Audit ——
    await it('23) replay بلا تكرار Audit نجاح', async () => {
      const seeded = await seedCalculated('83000');
      const key = randomUUID();
      const first = await postRecalculate(seeded.run, adminId, adminUser, { key });
      assert(first.status === 200, `first ${first.status}`);
      assert((await auditCount(seeded.run.id, 'payroll_run.recalculated')) === 1, 'audit=1');
      const second = await postRecalculate(seeded.run, adminId, adminUser, { key });
      assert(second.status === 200, `replay ${second.status}`);
      assert((await auditCount(seeded.run.id, 'payroll_run.recalculated')) === 1, 'still 1');
    });

    // —— 24) replay no version/updated_at change ——
    await it('24) replay بلا تغيّر version/updated_at', async () => {
      const seeded = await seedCalculated('84000');
      const key = randomUUID();
      const first = await postRecalculate(seeded.run, adminId, adminUser, { key });
      const firstBody = (await first.json()) as {
        run?: { version: number; updated_at: string };
      };
      const second = await postRecalculate(seeded.run, adminId, adminUser, { key });
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

    // —— 25) same key + changed reason ——
    await it('25) نفس المفتاح + سبب مختلف → 409 IDEMPOTENCY_CONFLICT', async () => {
      const seeded = await seedCalculated('85000');
      const key = randomUUID();
      const first = await postRecalculate(seeded.run, adminId, adminUser, {
        key,
        reason: 'السبب الأول لإعادة الاحتساب هنا',
      });
      assert(first.status === 200, `first ${first.status}`);
      const second = await postRecalculate(seeded.run, adminId, adminUser, {
        key,
        reason: 'سبب مختلف تماماً لإعادة الاحتساب',
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

    // —— 26) corrupt Audit ——
    await it('26) Audit تالف → 409', async () => {
      const seeded = await seedCalculated('86000');
      const key = `corrupt-payload-${token}`;
      const keyHash = buildRecalculateRequestKeyHash(normalizeRecalculateIdempotencyKey(key));
      await query(
        `INSERT INTO accounts.financial_audit_log
           (user_id, action, entity_type, entity_id, old_values, new_values, description)
         VALUES ($1::uuid, 'payroll_run.recalculated', 'payroll_run', $2::uuid,
                 '{"previous_snapshot_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb,
                 $3::jsonb, 'تدقيق تالف للاختبار')`,
        [
          adminId,
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
      const res = await postRecalculate(before, adminId, adminUser, {
        key,
        reason: 'محاولة إعادة احتساب مع تدقيق تالف',
      });
      assert(res.status === 409, `status ${res.status}`);
      const body = (await res.json()) as { error?: { code?: string } };
      assert(
        body.error?.code === 'RECALCULATION_INTEGRITY_CONFLICT' || body.error?.code === 'CONFLICT',
        `code ${body.error?.code}`
      );
      const after = await withTransaction((c) => loadPayrollRun(c, before.id));
      assert(after.version === before.version, 'no version bump');
      assert(String(after.snapshot_hash) === String(before.snapshot_hash), 'hash frozen');
      const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, before.id));
      assert(arts.people.length === artsBefore.people.length, 'people frozen');
      assert(
        (await auditCount(seeded.run.id, 'payroll_run.recalculated')) === auditsBefore,
        'no new success audit'
      );
    });

    // —— 27) duplicate Audit ——
    await it('27) Audit مكرر → 409 DUPLICATE/integrity', async () => {
      const seeded = await seedCalculated('87000');
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
          [adminId, seeded.run.id, JSON.stringify(ov), JSON.stringify(nv), reason]
        );
      }
      const before = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const res = await postRecalculate(before, adminId, adminUser, { key, reason });
      assert(res.status === 409, `status ${res.status}`);
      const body = (await res.json()) as { error?: { code?: string }; message?: string };
      assert(
        body.error?.code === 'RECALCULATION_INTEGRITY_CONFLICT' ||
          body.error?.code === 'CONFLICT' ||
          (body.message ?? '').includes('سلامة') ||
          (body.message ?? '').toUpperCase().includes('DUPLICATE'),
        body.message ?? `code ${body.error?.code}`
      );
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(after.version === before.version, 'no mutation');
    });

    // —— 28) concurrent Recalculate ×2 ——
    await it('28) Concurrent Recalculate×2', async () => {
      const seeded = await seedCalculated('88000');
      const key1 = randomUUID();
      const key2 = randomUUID();
      const settled = await Promise.allSettled([
        postRecalculate(seeded.run, adminId, adminUser, {
          key: key1,
          reason: 'تزامن إعادة احتساب الطرف الأول',
        }),
        postRecalculate(seeded.run, adminId, adminUser, {
          key: key2,
          reason: 'تزامن إعادة احتساب الطرف الثاني',
        }),
      ]);
      const responses = [];
      for (const s of settled) {
        assert(s.status === 'fulfilled', 'settled fulfilled');
        if (s.status === 'fulfilled') responses.push(s.value);
      }
      assert(responses.length === 2, 'both settled as responses');
      const statuses = responses.map((r) => r.status);
      const okN = statuses.filter((s) => s === 200).length;
      const conflictN = statuses.filter((s) => s === 409).length;
      assert(okN >= 1, `statuses ${statuses.join(',')}`);
      assert(okN + conflictN === 2, `unexpected ${statuses.join(',')}`);
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(after.status === 'CALCULATED', 'final CALCULATED');
      assert(after.status !== 'CALCULATING', 'not stuck');
    });

    // —— 29) Recalculate × Cancel ——
    await it('29) Concurrent Recalculate×Cancel', async () => {
      const seeded = await seedCalculated('89000');
      const settled = await Promise.allSettled([
        postRecalculate(seeded.run, adminId, adminUser, {
          reason: 'تزامن إعادة احتساب مع إلغاء',
        }),
        postCancel(seeded.run.id, adminId, adminUser, {
          version: seeded.run.version,
          updated_at: isoAt(seeded.run.updated_at),
          reason: 'إلغاء متزامن مع إعادة الاحتساب',
        }),
      ]);
      assert(settled.length === 2, 'both settled');
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(
        after.status === 'CALCULATED' || after.status === 'CANCELLED',
        `status ${after.status}`
      );
      assert(after.status !== 'CALCULATING', 'not stuck');
    });

    // —— 30) Recalculate × Update (PATCH) ——
    await it('30) Concurrent Recalculate×Update PATCH', async () => {
      const seeded = await seedCalculated('90000');
      const settled = await Promise.allSettled([
        postRecalculate(seeded.run, adminId, adminUser, {
          reason: 'تزامن إعادة احتساب مع تحديث تشغيل',
        }),
        patchRun(seeded.run.id, adminId, adminUser, {
          version: seeded.run.version,
          updated_at: isoAt(seeded.run.updated_at),
          run_type: 'REGULAR',
        }),
      ]);
      const responses = [];
      for (const s of settled) {
        assert(s.status === 'fulfilled', 'settled fulfilled');
        if (s.status === 'fulfilled') responses.push(s.value);
      }
      assert(responses.length === 2, 'both HTTP responses');
      const after = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      assert(after.status === 'CALCULATED', 'CALCULATED');
      assert(after.status !== 'CALCULATING', 'not stuck');
      assert(
        (await auditCount(seeded.run.id, 'payroll_run.recalculated')) <= 1,
        'at most one success'
      );
    });

    // —— 31) visibility / IDOR ——
    await it('31) visibility/IDOR: عشوائي 404؛ تاريخ غير موجود 404', async () => {
      const missing = randomUUID();
      const recalcRes = await postRecalculate(missing, adminId, adminUser, {
        version: 1,
        updated_at: new Date().toISOString(),
        key: randomUUID(),
        reason: DEFAULT_REASON,
      });
      assert(recalcRes.status === 404, `recalc ${recalcRes.status}`);
      const histRes = await getRecalculations(missing, adminId, adminUser);
      assert(histRes.status === 404, `history ${histRes.status}`);
      const getRes = await getRun(missing, viewerId, viewerUser);
      assert(getRes.status === 404, `get ${getRes.status}`);
    });

    // —— 32) technical failure failpoint ——
    await it('32) failpoint after_delete → 500 عربي معقّم بلا SQL', async () => {
      const seeded = await seedCalculated('92000');
      __setPayrollRecalcFailpointForTests('after_delete');
      try {
        const res = await postRecalculate(seeded.run, adminId, adminUser, {
          reason: 'اختبار فشل تقني أثناء إعادة الاحتساب',
        });
        assert(res.status === 500, `status ${res.status}`);
        const body = (await res.json()) as { message?: string; error?: { code?: string } };
        const msg = String(body.message ?? '');
        assert(
          body.error?.code === 'TECHNICAL_FAILURE' || msg.includes('خطأ تقني'),
          msg || 'msg'
        );
        assert(msg.includes('سابقة') || msg.includes('محفوظة'), msg);
        assert(!msg.includes('FAILPOINT'), 'لا تسريب failpoint');
        assert(!msg.includes('SELECT'), 'لا SQL');
        assert(!msg.includes('DELETE'), 'لا SQL delete');
        assert(!/relation|pg_|syntax error/i.test(msg), 'no pg leak');
      } finally {
        __clearPayrollRecalcFailpointForTests();
      }
    });

    // —— 33) old snapshot survives ——
    await it('33) اللقطة السابقة تبقى بعد فشل تقني', async () => {
      const seeded = await seedCalculated('93000');
      const before = await withTransaction((c) => loadPayrollRun(c, seeded.run.id));
      const artsBefore = await withTransaction((c) => loadRunCalculationArtifacts(c, before.id));
      __setPayrollRecalcFailpointForTests('after_delete');
      try {
        const res = await postRecalculate(before, adminId, adminUser, {
          reason: 'فشل تقني للتحقق من بقاء اللقطة',
        });
        assert(res.status === 500, `status ${res.status}`);
      } finally {
        __clearPayrollRecalcFailpointForTests();
      }
      const after = await withTransaction((c) => loadPayrollRun(c, before.id));
      assert(after.status === 'CALCULATED', `status ${after.status}`);
      assert(String(after.snapshot_hash) === String(before.snapshot_hash), 'hash same');
      assert(String(after.gross_total) === String(before.gross_total), 'gross same');
      assert(after.version === before.version, 'version same (tx rolled back)');
      const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, before.id));
      assert(arts.people.length === artsBefore.people.length, 'people intact');
      assert(arts.lines.length === artsBefore.lines.length, 'lines intact');
    });

    // —— 34) blocked Audit safe ——
    await it('34) blocked Audit آمن (بلا مفتاح خام)', async () => {
      const seeded = await seedCalculated('94000');
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
        const res = await postRecalculate(fresh, adminId, adminUser, {
          key: rawKey,
          reason: 'اختبار تدقيق محظور بلا مفتاح خام',
        });
        assert(res.status === 422, `status ${res.status}`);
        const audit = await latestAudit(seeded.run.id, 'payroll_run.recalculation_blocked');
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

    // —— 35) failed Audit safe ——
    await it('35) failed Audit آمن', async () => {
      const seeded = await seedCalculated('95000');
      const rawKey = `raw-failed-key-${token}-${randomUUID()}`;
      __setPayrollRecalcFailpointForTests('after_delete');
      try {
        const res = await postRecalculate(seeded.run, adminId, adminUser, {
          key: rawKey,
          reason: 'اختبار تدقيق فشل تقني بلا مفتاح خام',
        });
        assert(res.status === 500, `status ${res.status}`);
      } finally {
        __clearPayrollRecalcFailpointForTests();
      }
      const audit = await latestAudit(seeded.run.id, 'payroll_run.recalculation_failed');
      assert(audit, 'failed audit exists');
      assert(!jsonHasRawKey(audit?.new_values, rawKey), 'no raw key');
      assert(
        audit?.new_values?.idempotency_key_masked != null ||
          !('idempotency_key' in (audit?.new_values ?? {})),
        'masked or absent'
      );
    });

    // —— 36) success Audit once ——
    await it('36) success Audit مرة واحدة', async () => {
      const seeded = await seedCalculated('96000');
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
        reason: 'إعادة احتساب لتسجيل تدقيق نجاح واحد',
      });
      assert(res.status === 200, `status ${res.status}`);
      assert((await auditCount(seeded.run.id, 'payroll_run.recalculated')) === 1, 'once');
    });

    // —— 37) raw idempotency key absent ——
    await it('37) المفتاح الخام غائب من Audit والاستجابة', async () => {
      const seeded = await seedCalculated('97000');
      const rawKey = `visible-raw-key-${token}-${randomUUID()}`;
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
        key: rawKey,
        reason: 'التحقق من غياب المفتاح الخام من الاستجابة',
      });
      assert(res.status === 200, `status ${res.status}`);
      const body = await res.json();
      assert(!jsonHasRawKey(body, rawKey), 'no raw key in API body');
      const audit = await latestAudit(seeded.run.id, 'payroll_run.recalculated');
      assert(audit, 'success audit');
      assert(!jsonHasRawKey(audit?.new_values, rawKey), 'no raw in audit new_values');
      assert(!jsonHasRawKey(audit?.old_values, rawKey), 'no raw in audit old_values');
      assert(!jsonHasRawKey(audit?.description, rawKey), 'no raw in description');
    });

    // —— 38) request hashes absent from public response ——
    await it('38) بصمات الطلب غائبة من الاستجابة العامة', async () => {
      const seeded = await seedCalculated('98000');
      const res = await postRecalculate(seeded.run, adminId, adminUser);
      assert(res.status === 200, `status ${res.status}`);
      const body = await res.json();
      const s = JSON.stringify(body);
      assert(!s.includes('request_key_hash'), 'no request_key_hash');
      assert(!s.includes('request_payload_hash'), 'no request_payload_hash');
    });

    // —— 39) no snapshot_json ——
    await it('39) بلا snapshot_json في الاستجابة', async () => {
      const seeded = await seedCalculated('99000');
      const res = await postRecalculate(seeded.run, adminId, adminUser);
      assert(res.status === 200, `status ${res.status}`);
      const body = await res.json();
      assert(!JSON.stringify(body).includes('snapshot_json'), 'no snapshot_json');
      assert(!jsonHasForbiddenHashes(body) || !JSON.stringify(body).includes('snapshot_json'), 'ok');
    });

    // —— 40) history visibility OK ——
    await it('40) تاريخ إعادة الاحتساب مرئي للمدير', async () => {
      const seeded = await seedCalculated('100000');
      const recalc = await postRecalculate(seeded.run, adminId, adminUser, {
        reason: 'إعادة احتساب لتغذية سجل التاريخ',
      });
      assert(recalc.status === 200, `recalc ${recalc.status}`);
      const hist = await getRecalculations(seeded.run.id, adminId, adminUser);
      assert(hist.status === 200, `hist ${hist.status}`);
      const body = (await hist.json()) as {
        success?: boolean;
        data?: { items?: unknown[]; total?: number };
      };
      assert(body.success === true, 'success');
      assert((body.data?.total ?? 0) >= 1, `total ${body.data?.total}`);
      assert((body.data?.items?.length ?? 0) >= 1, 'items');
    });

    // —— 41) history sanitized ——
    await it('41) استجابة التاريخ معقّمة بلا request_key_hash', async () => {
      const seeded = await seedCalculated('101000');
      const recalc = await postRecalculate(seeded.run, adminId, adminUser, {
        reason: 'إعادة احتساب لفحص تعقيم سجل التاريخ',
      });
      assert(recalc.status === 200, `recalc ${recalc.status}`);
      const hist = await getRecalculations(seeded.run.id, adminId, adminUser);
      assert(hist.status === 200, `hist ${hist.status}`);
      const body = await hist.json();
      const s = JSON.stringify(body);
      assert(!s.includes('request_key_hash'), 'no request_key_hash');
      assert(!s.includes('request_payload_hash'), 'no request_payload_hash');
      assert(!s.includes('snapshot_json'), 'no snapshot_json');
      const item = (body as { data?: { items?: Array<{ reason?: string }> } }).data?.items?.[0];
      assert(item?.reason, 'reason present');
    });

    // —— 42) no-op recalculation ——
    await it('42) إعادة بلا تغيّر مصادر → no_change أو نفس الـ hash', async () => {
      const seeded = await seedCalculated('102000');
      const beforeHash = String(seeded.run.snapshot_hash);
      const res = await postRecalculate(seeded.run, adminId, adminUser, {
        reason: 'إعادة احتساب بلا تغيّر مصادر حية',
      });
      assert(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as {
        run?: { snapshot_hash: string; gross_total: string };
        recalculation?: { no_change?: boolean };
      };
      assert(
        body.recalculation?.no_change === true || body.run?.snapshot_hash === beforeHash,
        `no_change=${body.recalculation?.no_change} hash=${body.run?.snapshot_hash}`
      );
      assert(body.run?.gross_total === seeded.gross_total, 'same gross');
    });
  } finally {
    console.log('— تنظيف سجلات الاختبار المملوكة —');
    try {
      await cleanupOwned();
      const left = await countOwned();
      console.log(`cleanup leftover count = ${left}`);
      await it('43) Cleanup leftover = 0', async () => {
        assert(left === 0, `بقايا ${left}`);
      });
    } catch (e) {
      failed('43) Cleanup leftover = 0', e);
    }
  }

  console.log(`\n===== النتيجة: ${passCount} ناجح / ${failCount} فاشل =====`);
  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  try {
    __clearPayrollRecalcFailpointForTests();
    __clearPayrollCapabilitiesOverrideForTests();
    await cleanupOwned();
  } catch {
    /* ignore */
  }
  await closePool();
});
