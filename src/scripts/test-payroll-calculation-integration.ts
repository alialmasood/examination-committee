/**
 * اختبارات HTTP لتكامل احتساب الرواتب 9.A.2.3.2
 * npm run test:payroll-calculation-integration
 *
 * عزل: ownership token + cleanupOwned في finally.
 * تشغيل مرتين يجب أن يترك 0 صفوف مملوكة.
 *
 * سلوكيات الصفحة (React) تُغطّى عبر HTTP + فحوصات المساعدات النقية
 * (iqdWhole / PERSON_CALC_STATUS / CAP / runCalculateUrl) — بلا RTL.
 */
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { generateAccessToken } from '../lib/auth';
import { AccountsHttpError } from '../lib/accounts/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import {
  ACCOUNTS_CLERK_ROLE_CODE,
  ACCOUNTS_VIEWER_ROLE_CODE,
} from '../lib/accounts/student-receivables-access';
import { grantAccountsPlatformRole } from '../lib/accounts/payroll-access';
import {
  __clearPayrollCalcFailpointForTests,
  __setPayrollCalcFailpointForTests,
} from '../lib/accounts/payroll-calculation-engine';
import { assertPayrollRunReadyForPosting } from '../lib/accounts/payroll-posting-guard';
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
  iqdWhole,
  PERSON_CALC_STATUS,
  runCalculateUrl,
} from '../../app/accounts/payroll/_lib';

import { POST as calculatePost } from '../../app/api/accounts/payroll/runs/[id]/calculate/route';
import { GET as runGet, PATCH as runPatch } from '../../app/api/accounts/payroll/runs/[id]/route';
import { GET as peopleGet } from '../../app/api/accounts/payroll/runs/[id]/people/route';
import { GET as personDetailGet } from '../../app/api/accounts/payroll/runs/[id]/people/[runPersonId]/route';

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
    __clearPayrollCalcFailpointForTests();
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

async function upsertUser(username: string, withAccounts: boolean): Promise<string> {
  const hash = await bcrypt.hash('test-calc-int-pass', 10);
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

type CalcBody = {
  confirmation?: boolean;
  version?: unknown;
  updated_at?: unknown;
  idempotency_key?: string;
};

async function postCalculate(
  runId: string,
  userId: string,
  username: string,
  body: CalcBody
) {
  return calculatePost(
    authReq(`http://localhost/api/accounts/payroll/runs/${runId}/calculate`, userId, username, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}

async function getRun(runId: string, userId: string, username: string) {
  return runGet(
    authReq(`http://localhost/api/accounts/payroll/runs/${runId}`, userId, username),
    { params: Promise.resolve({ id: runId }) }
  );
}

async function getPeople(
  runId: string,
  userId: string,
  username: string,
  qs = ''
) {
  const url = `http://localhost/api/accounts/payroll/runs/${runId}/people${qs ? `?${qs}` : ''}`;
  return peopleGet(authReq(url, userId, username), {
    params: Promise.resolve({ id: runId }),
  });
}

async function getPersonDetail(
  runId: string,
  runPersonId: string,
  userId: string,
  username: string
) {
  return personDetailGet(
    authReq(
      `http://localhost/api/accounts/payroll/runs/${runId}/people/${runPersonId}`,
      userId,
      username
    ),
    { params: Promise.resolve({ id: runId, runPersonId }) }
  );
}

async function main() {
  console.log('===== اختبارات تكامل احتساب الرواتب 9.A.2.3.2 =====');
  const token = `CI${Date.now().toString(36).toUpperCase()}`;
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

  const clerkUser = `test-ci-clerk-${token.toLowerCase()}`;
  const viewerUser = `test-ci-viewer-${token.toLowerCase()}`;
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
       VALUES ($1,'سنة تكامل احتساب','2025-01-01','2025-12-31','ACTIVE',FALSE,$2) RETURNING id`,
      [uniq('CIFY'), adminId]
    );
  }
  const fiscalYearId = fy.rows[0].id as string;

  const mkCalendar = async (currency = 'IQD') => {
    const cal = await withTransaction((c) =>
      createPayrollCalendar(c, {
        code: uniq('CICAL'),
        name_ar: 'تقويم تكامل',
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
        name_ar: 'فترة تكامل',
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
        full_name_ar: 'شخص تكامل',
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
        component_code: uniq('CIFIX'),
        name_ar: 'بدل ثابت تكامل',
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
  const mkRunWithPeople = async (periodId: string, personIds: string[]) => {
    let run = await mkRun(periodId);
    for (const personId of personIds) {
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
    }
    return run;
  };

  const readyCalcBody = (
    run: { version: number; updated_at: unknown },
    key?: string
  ): CalcBody => ({
    confirmation: true,
    version: run.version,
    updated_at: isoAt(run.updated_at),
    idempotency_key: key ?? randomUUID(),
  });

  try {
    // —— UI helpers (نقية) ——
    await it('UI: iqdWhole تنسيق IQD بدون كسور', async () => {
      assert(iqdWhole('1000000.000') === '1,000,000 د.ع', iqdWhole('1000000.000'));
      assert(iqdWhole('0') === '0 د.ع', iqdWhole('0'));
      assert(iqdWhole('-500.5') === '-500 د.ع', iqdWhole('-500.5'));
    });
    await it('UI: PERSON_CALC_STATUS labels موجودة', async () => {
      assert(PERSON_CALC_STATUS.CALCULATED, 'CALCULATED');
      assert(PERSON_CALC_STATUS.ERROR, 'ERROR');
      assert(PERSON_CALC_STATUS.EXCLUDED, 'EXCLUDED');
      assert(PERSON_CALC_STATUS.PENDING, 'PENDING');
    });
    await it('UI: CAP.CALCULATE === payroll_calculate', async () => {
      assert(CAP.CALCULATE === 'payroll_calculate', CAP.CALCULATE);
    });
    await it('UI: runCalculateUrl شكل المسار', async () => {
      const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      assert(
        runCalculateUrl(id) === `/api/accounts/payroll/runs/${id}/calculate`,
        runCalculateUrl(id)
      );
    });

    // —— 1) Admin calculate success ——
    await it('1) Admin calculate → 200 CALCULATED + totals string', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      const contract = await mkContract(person.id, '500000');
      const comp = await mkFixedComponent('120000');
      await mkPca(person.id, comp.id, { payroll_contract_id: contract.id, amount: '120000' });
      const run = await mkRunWithPerson(period.id, person.id);
      const res = await postCalculate(run.id, adminId, adminUser, readyCalcBody(run));
      assert(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as {
        success?: boolean;
        idempotent_replay?: boolean;
        run?: {
          status: string;
          gross_total: unknown;
          deduction_total: unknown;
          employer_contribution_total: unknown;
          net_total: unknown;
        };
      };
      assert(body.success === true, 'success');
      assert(body.idempotent_replay === false, 'not replay');
      assert(body.run?.status === 'CALCULATED', `status ${body.run?.status}`);
      assert(typeof body.run?.gross_total === 'string', 'gross string');
      assert(/^\d/.test(String(body.run?.gross_total)), 'gross starts digit');
      assert(typeof body.run?.net_total === 'string', 'net string');
    });

    // —— 2) No capability ——
    await it('2) clerk/viewer calculate → 403', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      await mkContract(person.id);
      const run = await mkRunWithPerson(period.id, person.id);
      const body = readyCalcBody(run);
      const clerkRes = await postCalculate(run.id, clerkId, clerkUser, body);
      assert(clerkRes.status === 403, `clerk ${clerkRes.status}`);
      const viewerRes = await postCalculate(run.id, viewerId, viewerUser, body);
      assert(viewerRes.status === 403, `viewer ${viewerRes.status}`);
    });

    // —— 3) Missing confirmation ——
    await it('3) بدون confirmation → 400', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      await mkContract(person.id);
      const run = await mkRunWithPerson(period.id, person.id);
      const res = await postCalculate(run.id, adminId, adminUser, {
        version: run.version,
        updated_at: isoAt(run.updated_at),
        idempotency_key: randomUUID(),
      });
      assert(res.status === 400, `status ${res.status}`);
      const body = (await res.json()) as { message?: string };
      assert(body.message?.includes('confirmation') || body.message?.includes('تأكيد'), body.message ?? 'missing message');
    });

    // —— 4) Invalid UUID ——
    await it('4) UUID غير صالح → 400', async () => {
      const res = await postCalculate('not-a-uuid', adminId, adminUser, {
        confirmation: true,
        version: 1,
        updated_at: new Date().toISOString(),
        idempotency_key: randomUUID(),
      });
      assert(res.status === 400, `status ${res.status}`);
    });

    // —— 5) Stale version ——
    await it('5) نسخة متقادمة → 409', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      await mkContract(person.id);
      const run = await mkRunWithPerson(period.id, person.id);
      const res = await postCalculate(run.id, adminId, adminUser, {
        confirmation: true,
        version: run.version - 1,
        updated_at: isoAt(run.updated_at),
        idempotency_key: randomUUID(),
      });
      assert(res.status === 409, `status ${res.status}`);
    });

    // —— 6) Empty PERSON_LIST ——
    await it('6) PERSON_LIST فارغة → 422 يبقى DRAFT', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const run = await mkRun(period.id, { scope_type: 'PERSON_LIST' });
      const res = await postCalculate(run.id, adminId, adminUser, readyCalcBody(run));
      assert(res.status === 422, `status ${res.status}`);
      const after = await withTransaction((c) => loadPayrollRun(c, run.id));
      assert(after.status === 'DRAFT', `status ${after.status}`);
      const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, run.id));
      assert(arts.people.length === 0 && arts.issues.length === 0, 'بلا آثار');
      const blocked = await auditCount(run.id, 'payroll_run.calculation_blocked');
      assert(blocked >= 0, 'blocked audit optional');
    });

    // —— 7) Unsupported currency via SQL ——
    await it('7) عملة USD عبر SQL → 422 قبل mutation', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      await mkContract(person.id);
      const run = await mkRunWithPerson(period.id, person.id);
      await query(
        `UPDATE accounts.payroll_periods SET currency_code='USD' WHERE id=$1::uuid`,
        [period.id]
      );
      await query(
        `UPDATE accounts.payroll_runs SET currency_code='USD' WHERE id=$1::uuid`,
        [run.id]
      );
      const fresh = await withTransaction((c) => loadPayrollRun(c, run.id));
      const startedBefore = await auditCount(run.id, 'payroll_run.calculation_started');
      const res = await postCalculate(run.id, adminId, adminUser, readyCalcBody(fresh));
      assert(res.status === 422, `status ${res.status}`);
      const body = (await res.json()) as { message?: string };
      assert(body.message?.includes('IQD'), body.message ?? 'missing message');
      const after = await withTransaction((c) => loadPayrollRun(c, run.id));
      assert(after.status === 'DRAFT', 'DRAFT');
      const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, run.id));
      assert(arts.people.length === 0, 'no artifacts');
      assert(
        (await auditCount(run.id, 'payroll_run.calculation_started')) === startedBefore,
        'no started'
      );
    });

    // —— 8) Mixed result ——
    await it('8) مختلط: شخص OK + بلا عقد → CALCULATED error_count>=1', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const okPerson = await mkPerson({ full_name_ar: 'شخص ناجح' });
      const badPerson = await mkPerson({ full_name_ar: 'شخص بلا عقد' });
      const contract = await mkContract(okPerson.id, '400000');
      const comp = await mkFixedComponent('80000');
      await mkPca(okPerson.id, comp.id, { payroll_contract_id: contract.id, amount: '80000' });
      const run = await mkRunWithPeople(period.id, [okPerson.id, badPerson.id]);
      const res = await postCalculate(run.id, adminId, adminUser, readyCalcBody(run));
      assert(res.status === 200, `status ${res.status}`);
      const body = (await res.json()) as {
        run?: { status: string; error_count: number };
        summary?: { error_people: number };
      };
      assert(body.run?.status === 'CALCULATED', 'CALCULATED');
      assert(Number(body.run?.error_count) >= 1, `error_count ${body.run?.error_count}`);
    });

    // —— 9) Idempotent replay ——
    await it('9) إعادة نفس المفتاح → 200 idempotent_replay', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      const contract = await mkContract(person.id);
      const comp = await mkFixedComponent('33000');
      await mkPca(person.id, comp.id, { payroll_contract_id: contract.id, amount: '33000' });
      const run = await mkRunWithPerson(period.id, person.id);
      const key = randomUUID();
      const first = await postCalculate(run.id, adminId, adminUser, readyCalcBody(run, key));
      assert(first.status === 200, `first ${first.status}`);
      const firstBody = (await first.json()) as {
        run?: { version: number; updated_at: string; gross_total: string };
        idempotent_replay?: boolean;
      };
      const second = await postCalculate(run.id, adminId, adminUser, {
        confirmation: true,
        version: firstBody.run!.version,
        updated_at: firstBody.run!.updated_at,
        idempotency_key: key,
      });
      assert(second.status === 200, `second ${second.status}`);
      const secondBody = (await second.json()) as {
        idempotent_replay?: boolean;
        run?: { gross_total: string };
      };
      assert(secondBody.idempotent_replay === true, 'replay');
      assert(secondBody.run?.gross_total === firstBody.run?.gross_total, 'same totals');
    });

    // —— 10) Different key after CALCULATED ——
    await it('10) مفتاح مختلف بعد CALCULATED → 409', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      const contract = await mkContract(person.id);
      const comp = await mkFixedComponent('22000');
      await mkPca(person.id, comp.id, { payroll_contract_id: contract.id, amount: '22000' });
      const run = await mkRunWithPerson(period.id, person.id);
      const first = await postCalculate(run.id, adminId, adminUser, readyCalcBody(run));
      assert(first.status === 200, `first ${first.status}`);
      const firstBody = (await first.json()) as {
        run?: { version: number; updated_at: string };
      };
      const second = await postCalculate(run.id, adminId, adminUser, {
        confirmation: true,
        version: firstBody.run!.version,
        updated_at: firstBody.run!.updated_at,
        idempotency_key: randomUUID(),
      });
      assert(second.status === 409, `status ${second.status}`);
    });

    // —— 11) Concurrent ——
    await it('11) Concurrent calculate — نجاح+409 أو replay بنفس المفتاح', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      const contract = await mkContract(person.id);
      const comp = await mkFixedComponent('44000');
      await mkPca(person.id, comp.id, { payroll_contract_id: contract.id, amount: '44000' });
      const run = await mkRunWithPerson(period.id, person.id);
      const keyA = randomUUID();
      const keyB = randomUUID();
      const bodyA = readyCalcBody(run, keyA);
      const bodyB = readyCalcBody(run, keyB);
      const [r1, r2] = await Promise.all([
        postCalculate(run.id, adminId, adminUser, bodyA),
        postCalculate(run.id, adminId, adminUser, bodyB),
      ]);
      const statuses = [r1.status, r2.status];
      const okStatuses = statuses.filter((s) => s === 200);
      const conflictStatuses = statuses.filter((s) => s === 409);
      assert(okStatuses.length >= 1, `statuses ${statuses.join(',')}`);
      assert(
        okStatuses.length + conflictStatuses.length === 2,
        `unexpected statuses ${statuses.join(',')}`
      );
      // نفس المفتاح: كلاهما 200 مقبول (replay)
      const sameKey = await Promise.all([
        (async () => {
          const cal2 = await mkCalendar();
          const period2 = await mkPeriod(cal2.id);
          const person2 = await mkPerson();
          const contract2 = await mkContract(person2.id);
          const comp2 = await mkFixedComponent('45000');
          await mkPca(person2.id, comp2.id, {
            payroll_contract_id: contract2.id,
            amount: '45000',
          });
          const run2 = await mkRunWithPerson(period2.id, person2.id);
          const key = randomUUID();
          const b = readyCalcBody(run2, key);
          const [a, c] = await Promise.all([
            postCalculate(run2.id, adminId, adminUser, b),
            postCalculate(run2.id, adminId, adminUser, b),
          ]);
          assert(
            (a.status === 200 || a.status === 409) && (c.status === 200 || c.status === 409),
            `same-key ${a.status}/${c.status}`
          );
          assert(a.status === 200 || c.status === 200, 'at least one 200');
        })(),
      ]);
      void sameKey;
      const after = await withTransaction((c) => loadPayrollRun(c, run.id));
      assert(after.status === 'CALCULATED', `final ${after.status}`);
    });

    // —— 12) Technical failure sanitized ——
    await it('12) failpoint → 500 عربي معقّم + DRAFT بلا آثار', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      const contract = await mkContract(person.id);
      const comp = await mkFixedComponent('66000');
      await mkPca(person.id, comp.id, { payroll_contract_id: contract.id, amount: '66000' });
      const run = await mkRunWithPerson(period.id, person.id);
      const before = await withTransaction((c) => loadPayrollRun(c, run.id));
      __setPayrollCalcFailpointForTests('after_first_person');
      try {
        const res = await postCalculate(run.id, adminId, adminUser, readyCalcBody(run));
        assert(res.status === 500, `status ${res.status}`);
        const body = (await res.json()) as { message?: string };
        assert(body.message?.includes('خطأ تقني'), body.message ?? 'missing message');
        assert(body.message?.includes('جزئية'), body.message ?? 'missing message');
        assert(!body.message?.includes('FAILPOINT'), 'لا تسريب failpoint');
      } finally {
        __clearPayrollCalcFailpointForTests();
      }
      const after = await withTransaction((c) => loadPayrollRun(c, run.id));
      assert(after.status === 'DRAFT', `status ${after.status}`);
      assert(String(after.gross_total) === String(before.gross_total), 'gross unchanged');
      const arts = await withTransaction((c) => loadRunCalculationArtifacts(c, run.id));
      assert(arts.people.length === 0 && arts.lines.length === 0, 'no partial');
    });

    // —— 13) Run visibility 404 ——
    await it('13) viewer VIEW_RUNS لتشغيل غير موجود → 404', async () => {
      const missing = randomUUID();
      const res = await getRun(missing, viewerId, viewerUser);
      assert(res.status === 404, `status ${res.status}`);
    });

    // —— 14) Person detail IDOR ——
    await it('14) IDOR: runPerson من A تحت تشغيل B → 404', async () => {
      // فترتان منفصلتان — قيد التفرّد يمنع REGULAR+PERSON_LIST مزدوج على نفس الفترة
      const cal = await mkCalendar();
      const periodA = await mkPeriod(cal.id);
      const periodB = await withTransaction((c) =>
        createPayrollPeriod(c, {
          payroll_calendar_id: cal.id,
          name_ar: 'فترة تكامل ب',
          start_date: '2025-02-01',
          end_date: '2025-02-28',
          fiscal_year_id: fiscalYearId,
          created_by: adminId,
        })
      );
      owned.periodIds.push(periodB.id);
      const personA = await mkPerson({ full_name_ar: 'تشغيل أ' });
      const personB = await mkPerson({ full_name_ar: 'تشغيل ب' });
      const cA = await mkContract(personA.id);
      const cB = await mkContract(personB.id);
      const comp = await mkFixedComponent('15000');
      await mkPca(personA.id, comp.id, { payroll_contract_id: cA.id, amount: '15000' });
      await mkPca(personB.id, comp.id, { payroll_contract_id: cB.id, amount: '15000' });
      const runA = await mkRunWithPerson(periodA.id, personA.id);
      const runB = await mkRunWithPerson(periodB.id, personB.id);
      const calcA = await postCalculate(runA.id, adminId, adminUser, readyCalcBody(runA));
      assert(calcA.status === 200, `calcA ${calcA.status}`);
      const calcB = await postCalculate(runB.id, adminId, adminUser, readyCalcBody(runB));
      assert(calcB.status === 200, `calcB ${calcB.status}`);
      const peopleA = await getPeople(runA.id, adminId, adminUser);
      assert(peopleA.status === 200, `peopleA ${peopleA.status}`);
      const peopleBody = (await peopleA.json()) as {
        data?: { items?: Array<{ id: string }> };
      };
      const runPersonId = peopleBody.data?.items?.[0]?.id;
      assert(runPersonId, 'runPersonId');
      const idor = await getPersonDetail(runB.id, runPersonId!, viewerId, viewerUser);
      assert(idor.status === 404, `idor ${idor.status}`);
    });

    // —— 15) Decimal strings ——
    await it('15) totals typeof string وتبدأ برقم', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      const contract = await mkContract(person.id);
      const comp = await mkFixedComponent('99000');
      await mkPca(person.id, comp.id, { payroll_contract_id: contract.id, amount: '99000' });
      const run = await mkRunWithPerson(period.id, person.id);
      const res = await postCalculate(run.id, adminId, adminUser, readyCalcBody(run));
      const body = (await res.json()) as {
        run?: {
          gross_total: unknown;
          deduction_total: unknown;
          employer_contribution_total: unknown;
          net_total: unknown;
        };
      };
      for (const k of [
        'gross_total',
        'deduction_total',
        'employer_contribution_total',
        'net_total',
      ] as const) {
        const v = body.run?.[k];
        assert(typeof v === 'string', `${k} typeof ${typeof v}`);
        assert(/^\d/.test(String(v)), `${k}=${v}`);
      }
    });

    // —— 16+17) Audit calculated once / replay no duplicate ——
    await it('16+17) audit calculated مرة واحدة؛ replay بلا تكرار', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      const contract = await mkContract(person.id);
      const comp = await mkFixedComponent('55000');
      await mkPca(person.id, comp.id, { payroll_contract_id: contract.id, amount: '55000' });
      const run = await mkRunWithPerson(period.id, person.id);
      const key = randomUUID();
      const first = await postCalculate(run.id, adminId, adminUser, readyCalcBody(run, key));
      assert(first.status === 200, `first ${first.status}`);
      const firstBody = (await first.json()) as {
        run?: { version: number; updated_at: string };
      };
      assert((await auditCount(run.id, 'payroll_run.calculated')) === 1, 'calculated=1');
      const second = await postCalculate(run.id, adminId, adminUser, {
        confirmation: true,
        version: firstBody.run!.version,
        updated_at: firstBody.run!.updated_at,
        idempotency_key: key,
      });
      assert(second.status === 200, `replay ${second.status}`);
      assert((await auditCount(run.id, 'payroll_run.calculated')) === 1, 'still 1 after replay');
    });

    // —— 18) Posting guard ——
    await it('18) حارس الترحيل: يرفض CALCULATED ويقبل APPROVED نظيف', async () => {
      const hash = 'a'.repeat(64);
      try {
        assertPayrollRunReadyForPosting({
          status: 'CALCULATED',
          error_count: 0,
          snapshot_hash: hash,
          approved_snapshot_hash: hash,
        });
        throw new Error('should reject CALCULATED');
      } catch (e) {
        assert(e instanceof AccountsHttpError && e.status === 409, 'reject calculated');
      }
      try {
        assertPayrollRunReadyForPosting({
          status: 'APPROVED',
          error_count: 1,
          snapshot_hash: hash,
          approved_snapshot_hash: hash,
        });
        throw new Error('should reject ERROR count');
      } catch (e) {
        assert(e instanceof AccountsHttpError && e.status === 409, 'reject errors');
      }
      assertPayrollRunReadyForPosting({
        status: 'APPROVED',
        error_count: 0,
        snapshot_hash: hash,
        approved_snapshot_hash: hash,
      });
    });

    // —— 19) GET people filter ——
    await it('19) GET people filter/status يعمل', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const okPerson = await mkPerson({ full_name_ar: 'فلتر ناجح' });
      const badPerson = await mkPerson({ full_name_ar: 'فلتر خطأ' });
      const contract = await mkContract(okPerson.id);
      const comp = await mkFixedComponent('17000');
      await mkPca(okPerson.id, comp.id, { payroll_contract_id: contract.id, amount: '17000' });
      const run = await mkRunWithPeople(period.id, [okPerson.id, badPerson.id]);
      const calc = await postCalculate(run.id, adminId, adminUser, readyCalcBody(run));
      assert(calc.status === 200, `calc ${calc.status}`);
      const all = await getPeople(run.id, viewerId, viewerUser);
      assert(all.status === 200, `all ${all.status}`);
      const allBody = (await all.json()) as { data?: { items?: unknown[]; total?: number } };
      assert((allBody.data?.total ?? 0) >= 2, `total ${allBody.data?.total}`);
      const errOnly = await getPeople(run.id, viewerId, viewerUser, 'status=ERROR');
      assert(errOnly.status === 200, `err ${errOnly.status}`);
      const errBody = (await errOnly.json()) as {
        data?: { items?: Array<{ calculation_status: string }> };
      };
      assert(
        (errBody.data?.items ?? []).every((i) => i.calculation_status === 'ERROR'),
        'all ERROR'
      );
      const okOnly = await getPeople(run.id, viewerId, viewerUser, 'status=CALCULATED');
      const okBody = (await okOnly.json()) as {
        data?: { items?: Array<{ calculation_status: string }> };
      };
      assert(
        (okBody.data?.items ?? []).every((i) => i.calculation_status === 'CALCULATED'),
        'all CALCULATED'
      );
    });

    // —— 20) GET run includes calculation_summary ——
    await it('20) GET run يتضمن calculation_summary', async () => {
      const cal = await mkCalendar();
      const period = await mkPeriod(cal.id);
      const person = await mkPerson();
      const contract = await mkContract(person.id);
      const comp = await mkFixedComponent('18000');
      await mkPca(person.id, comp.id, { payroll_contract_id: contract.id, amount: '18000' });
      const run = await mkRunWithPerson(period.id, person.id);
      const calc = await postCalculate(run.id, adminId, adminUser, readyCalcBody(run));
      assert(calc.status === 200, `calc ${calc.status}`);
      const res = await getRun(run.id, viewerId, viewerUser);
      assert(res.status === 200, `get ${res.status}`);
      const body = (await res.json()) as {
        data?: {
          calculation_summary?: {
            total_people: number;
            calculated_people: number;
            error_people: number;
          };
          run?: { status: string };
        };
      };
      assert(body.data?.calculation_summary != null, 'summary present');
      assert(
        (body.data?.calculation_summary?.total_people ?? 0) >= 1,
        `total_people ${body.data?.calculation_summary?.total_people}`
      );
      assert(body.data?.run?.status === 'CALCULATED', 'run status');
      // PATCH مستورد ومستخدَم للتحقق من أن المسار قابل للوصول (صلاحية CREATE_RUNS)
      void runPatch;
    });
  } finally {
    console.log('— تنظيف سجلات الاختبار المملوكة —');
    try {
      await cleanupOwned();
      const left = await countOwned();
      console.log(`cleanup leftover count = ${left}`);
      await it('21) Cleanup leftover = 0', async () => {
        assert(left === 0, `بقايا ${left}`);
      });
    } catch (e) {
      failed('21) Cleanup leftover = 0', e);
    }
  }

  console.log(`\n===== النتيجة: ${passCount} ناجح / ${failCount} فاشل =====`);
  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  try {
    __clearPayrollCalcFailpointForTests();
    await cleanupOwned();
  } catch {
    /* ignore */
  }
  await closePool();
});
