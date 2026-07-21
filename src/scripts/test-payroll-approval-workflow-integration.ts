/**
 * E2E نهائي لمسار اعتماد الرواتب 9.B.4
 * دورة كاملة: Calculate → Submit1 → Reject → Recalc → Submit2 → Approve
 * ثم حراس الطفرات + posting guard + إثبات غياب endpoint الترحيل.
 * npm run test:payroll-approval-workflow-integration
 */
import bcrypt from 'bcrypt';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { resolve } from 'path';
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { generateAccessToken } from '../lib/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
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
import { assertPayrollRunReadyForPosting } from '../lib/accounts/payroll-posting-guard';
import { withTransaction } from '../lib/accounts/with-transaction';
import { GET as historyGet } from '../../app/api/accounts/payroll/runs/[id]/approval-history/route';
import { POST as submitReviewPost } from '../../app/api/accounts/payroll/runs/[id]/submit-review/route';
import { POST as approvePost } from '../../app/api/accounts/payroll/runs/[id]/approve/route';
import { POST as rejectPost } from '../../app/api/accounts/payroll/runs/[id]/reject/route';
import { POST as calculatePost } from '../../app/api/accounts/payroll/runs/[id]/calculate/route';
import { POST as recalculatePost } from '../../app/api/accounts/payroll/runs/[id]/recalculate/route';
import { POST as cancelPost } from '../../app/api/accounts/payroll/runs/[id]/cancel/route';
import { GET as runGet, PATCH as runPatch } from '../../app/api/accounts/payroll/runs/[id]/route';
import { POST as scopePost } from '../../app/api/accounts/payroll/runs/[id]/scope-members/route';

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
  }
}
function assert(cond: unknown, msg: string): asserts cond {
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
    await query(`DELETE FROM accounts.payroll_calendars WHERE id = ANY($1::uuid[])`, [
      owned.calendarIds,
    ]);
  }
}

async function countOwned() {
  const r = await query(
    `SELECT
      (SELECT COUNT(*)::int FROM accounts.payroll_calendars WHERE id=ANY($1::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_periods WHERE id=ANY($2::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_runs WHERE id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_run_approval_actions WHERE payroll_run_id=ANY($3::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_people WHERE id=ANY($4::uuid[])) +
      (SELECT COUNT(*)::int FROM accounts.payroll_components WHERE id=ANY($5::uuid[])) AS n`,
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

async function upsertUser(username: string): Promise<string> {
  const hash = await bcrypt.hash('test-workflow-e2e-pass', 10);
  const res = await query(
    `INSERT INTO student_affairs.users (username, email, full_name, password_hash, is_active)
     VALUES ($1,$2,$3,$4,TRUE)
     ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, is_active=TRUE
     RETURNING id`,
    [username, `${username}@test.local`, `اختبار ${username}`, hash]
  );
  const userId = res.rows[0].id as string;
  await query(
    `INSERT INTO student_affairs.user_systems (user_id, system_id)
     SELECT $1::uuid, s.id FROM student_affairs.systems s WHERE s.code='ACCOUNTS'
     ON CONFLICT (user_id, system_id) DO NOTHING`,
    [userId]
  );
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

type RunLike = {
  id: string;
  version: number;
  updated_at: unknown;
  status?: string;
  approval_cycle?: number | null;
  snapshot_hash?: string | null;
  approved_snapshot_hash?: string | null;
  error_count?: number | string | null;
};

async function getHistory(runId: string, userId: string, username: string) {
  return historyGet(
    authReq(`http://localhost/api/accounts/payroll/runs/${runId}/approval-history`, userId, username),
    { params: Promise.resolve({ id: runId }) }
  );
}

async function postSubmit(run: RunLike, userId: string, username: string, comment?: string) {
  return submitReviewPost(
    authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/submit-review`, userId, username, {
      method: 'POST',
      body: JSON.stringify({
        confirmation: true,
        version: run.version,
        updated_at: isoAt(run.updated_at),
        idempotency_key: randomUUID(),
        ...(comment != null ? { comment } : {}),
      }),
    }),
    { params: Promise.resolve({ id: run.id }) }
  );
}

async function postApprove(run: RunLike, userId: string, username: string) {
  return approvePost(
    authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/approve`, userId, username, {
      method: 'POST',
      body: JSON.stringify({
        confirmation: true,
        version: run.version,
        updated_at: isoAt(run.updated_at),
        idempotency_key: randomUUID(),
      }),
    }),
    { params: Promise.resolve({ id: run.id }) }
  );
}

async function postReject(run: RunLike, userId: string, username: string) {
  return rejectPost(
    authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/reject`, userId, username, {
      method: 'POST',
      body: JSON.stringify({
        confirmation: true,
        version: run.version,
        updated_at: isoAt(run.updated_at),
        idempotency_key: randomUUID(),
        reason: 'رفض واضح لإعادة التصحيح في اختبار E2E',
      }),
    }),
    { params: Promise.resolve({ id: run.id }) }
  );
}

async function main() {
  console.log('===== E2E مسار اعتماد الرواتب 9.B.4 =====');
  const token = `WF${Date.now().toString(36).toUpperCase()}`;
  let seq = 0;
  const uniq = (p: string) => {
    seq += 1;
    return `${p}-${token}-${seq}`;
  };

  const submitterName = `test-wf-submit-${token.toLowerCase()}`;
  const approverName = `test-wf-approve-${token.toLowerCase()}`;
  const submitterId = await upsertUser(submitterName);
  const approverId = await upsertUser(approverName);
  await grantAccountsAdminRole(submitterId);
  await grantAccountsAdminRole(approverId);

  let fy = await query(
    `SELECT id FROM accounts.fiscal_years WHERE status='ACTIVE' ORDER BY is_default DESC LIMIT 1`
  );
  if (!fy.rows[0]) {
    fy = await query(
      `INSERT INTO accounts.fiscal_years (code,name_ar,start_date,end_date,status,is_default,created_by)
       VALUES ($1,'سنة E2E اعتماد','2025-01-01','2025-12-31','ACTIVE',FALSE,$2) RETURNING id`,
      [uniq('WFFY'), submitterId]
    );
  }
  const fiscalYearId = fy.rows[0].id as string;

  try {
    let run!: RunLike;

    await it('1) إنشاء Period وRun + احتساب', async () => {
      const cal = await withTransaction((c) =>
        createPayrollCalendar(c, {
          code: uniq('WFCAL'),
          name_ar: 'تقويم E2E اعتماد',
          calendar_type: 'MONTHLY',
          currency_code: 'IQD',
          effective_from: '2025-01-01',
          created_by: submitterId,
        })
      );
      owned.calendarIds.push(cal.id);
      const period = await withTransaction((c) =>
        createPayrollPeriod(c, {
          payroll_calendar_id: cal.id,
          name_ar: 'فترة E2E اعتماد',
          start_date: '2025-01-01',
          end_date: '2025-01-31',
          fiscal_year_id: fiscalYearId,
          created_by: submitterId,
        })
      );
      owned.periodIds.push(period.id);
      const person = await withTransaction((c) =>
        createPayrollPerson(c, {
          full_name_ar: 'شخص E2E اعتماد',
          person_type: 'EMPLOYEE',
          default_currency_code: 'IQD',
          effective_from: '2025-01-01',
          created_by: submitterId,
        })
      );
      owned.personIds.push(person.id);
      const contract = await withTransaction(async (client) => {
        const draft = await createPayrollContract(client, {
          payroll_person_id: person.id,
          compensation_basis: 'MONTHLY_FIXED',
          base_amount: '1000000',
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
      const fix = await withTransaction((c) =>
        createPayrollComponent(c, {
          component_code: uniq('WFFIX'),
          name_ar: 'بدل E2E',
          component_type: 'EARNING',
          calculation_method: 'FIXED_AMOUNT',
          calculation_base_type: 'NONE',
          default_amount: '88000',
          effective_from: '2025-01-01',
          created_by: submitterId,
        })
      );
      owned.componentIds.push(fix.id);
      const pca = await withTransaction((c) =>
        createPayrollComponentAssignment(c, {
          payroll_person_id: person.id,
          payroll_component_id: fix.id,
          payroll_contract_id: contract.id,
          amount: '88000',
          effective_from: '2025-01-01',
          created_by: submitterId,
        })
      );
      owned.pcaIds.push(pca.id);

      let draft = await withTransaction((c) =>
        createPayrollRun(c, {
          payroll_period_id: period.id,
          run_type: 'REGULAR',
          scope_type: 'PERSON_LIST',
          created_by: submitterId,
        })
      );
      owned.runIds.push(draft.id);
      draft = await withTransaction(async (c) => {
        const r = await addScopeMember(c, {
          runId: draft.id,
          personId: person.id,
          userId: submitterId,
          version: draft.version,
          updated_at: draft.updated_at,
        });
        return r.run;
      });

      const calcRes = await calculatePost(
        authReq(`http://localhost/api/accounts/payroll/runs/${draft.id}/calculate`, submitterId, submitterName, {
          method: 'POST',
          body: JSON.stringify({
            confirmation: true,
            version: draft.version,
            updated_at: isoAt(draft.updated_at),
            idempotency_key: randomUUID(),
          }),
        }),
        { params: Promise.resolve({ id: draft.id }) }
      );
      assert(calcRes.status === 200, `calc ${calcRes.status}`);
      run = await withTransaction((c) => loadPayrollRun(c, draft.id));
      assert(run.status === 'CALCULATED', 'CALCULATED');
    });

    await it('2) Submit الدورة 1', async () => {
      const res = await postSubmit(run, submitterId, submitterName, 'إرسال الدورة الأولى');
      assert(res.status === 200, `submit1 ${res.status}`);
      run = await withTransaction((c) => loadPayrollRun(c, run.id));
      assert(run.status === 'UNDER_REVIEW', 'UNDER_REVIEW');
      assert(Number(run.approval_cycle) === 1, 'cycle1');
    });

    await it('3) History يعرض Submit', async () => {
      const res = await getHistory(run.id, approverId, approverName);
      assert(res.status === 200, `hist ${res.status}`);
      const body = await res.json();
      assert(body.history.items.some((x: { action: string }) => x.action === 'SUBMITTED_FOR_REVIEW'), 'submit in history');
    });

    await it('4) Submitter لا يعتمد (SoD)', async () => {
      const res = await postApprove(run, submitterId, submitterName);
      assert(res.status === 403 || res.status === 409, `sod approve ${res.status}`);
      run = await withTransaction((c) => loadPayrollRun(c, run.id));
      assert(run.status === 'UNDER_REVIEW', 'still under review');
    });

    await it('5) Reviewer يرفض', async () => {
      const res = await postReject(run, approverId, approverName);
      assert(res.status === 200, `reject ${res.status}`);
      run = await withTransaction((c) => loadPayrollRun(c, run.id));
      assert(run.status === 'CALCULATED', 'back CALCULATED');
    });

    await it('6) History يعرض Reject', async () => {
      const body = await (await getHistory(run.id, approverId, approverName)).json();
      assert(body.history.items.some((x: { action: string }) => x.action === 'REJECTED'), 'reject in history');
    });

    await it('7) Recalculate بعد الرفض', async () => {
      const res = await recalculatePost(
        authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/recalculate`, submitterId, submitterName, {
          method: 'POST',
          body: JSON.stringify({
            confirmation: true,
            version: run.version,
            updated_at: isoAt(run.updated_at),
            idempotency_key: randomUUID(),
            reason: 'تصحيح بعد رفض المراجعة في E2E',
          }),
        }),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(res.status === 200, `recalc ${res.status}`);
      run = await withTransaction((c) => loadPayrollRun(c, run.id));
      assert(run.status === 'CALCULATED', 'still CALCULATED');
    });

    await it('8) Submit الدورة 2', async () => {
      const res = await postSubmit(run, submitterId, submitterName, 'إرسال الدورة الثانية');
      assert(res.status === 200, `submit2 ${res.status}`);
      run = await withTransaction((c) => loadPayrollRun(c, run.id));
      assert(run.status === 'UNDER_REVIEW', 'under review 2');
      assert(Number(run.approval_cycle) === 2, `cycle2 got ${run.approval_cycle}`);
    });

    await it('9) History يعرض الدورة الثانية', async () => {
      const body = await (await getHistory(run.id, approverId, approverName)).json();
      const cycles = new Set(body.history.items.map((x: { approval_cycle: number }) => x.approval_cycle));
      assert(cycles.has(1) && cycles.has(2), 'both cycles');
    });

    await it('10) Approver مختلف يعتمد', async () => {
      const res = await postApprove(run, approverId, approverName);
      assert(res.status === 200, `approve ${res.status}`);
      run = await withTransaction((c) => loadPayrollRun(c, run.id));
      assert(run.status === 'APPROVED', 'APPROVED');
    });

    await it('11) History يعرض Approve', async () => {
      const body = await (await getHistory(run.id, approverId, approverName)).json();
      assert(body.history.items[0].action === 'APPROVED', 'latest approve');
      assert(Number(body.history.items[0].approval_cycle) === 2, 'approve cycle 2');
    });

    await it('12) جميع mutation APIs مرفوضة بعد APPROVED', async () => {
      const calc = await calculatePost(
        authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/calculate`, submitterId, submitterName, {
          method: 'POST',
          body: JSON.stringify({
            confirmation: true,
            version: run.version,
            updated_at: isoAt(run.updated_at),
            idempotency_key: randomUUID(),
          }),
        }),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(calc.status >= 400, `calc blocked ${calc.status}`);

      const recalc = await recalculatePost(
        authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/recalculate`, submitterId, submitterName, {
          method: 'POST',
          body: JSON.stringify({
            confirmation: true,
            version: run.version,
            updated_at: isoAt(run.updated_at),
            idempotency_key: randomUUID(),
            reason: 'محاولة غير مسموحة بعد الاعتماد',
          }),
        }),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(recalc.status >= 400, `recalc blocked ${recalc.status}`);

      const patch = await runPatch(
        authReq(`http://localhost/api/accounts/payroll/runs/${run.id}`, submitterId, submitterName, {
          method: 'PATCH',
          body: JSON.stringify({
            version: run.version,
            updated_at: isoAt(run.updated_at),
            run_type: 'CORRECTION',
          }),
        }),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(patch.status >= 400, `patch blocked ${patch.status}`);

      const cancel = await cancelPost(
        authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/cancel`, submitterId, submitterName, {
          method: 'POST',
          body: JSON.stringify({
            version: run.version,
            updated_at: isoAt(run.updated_at),
            reason: 'محاولة إلغاء بعد الاعتماد غير مسموحة',
          }),
        }),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(cancel.status >= 400, `cancel blocked ${cancel.status}`);

      const submit = await postSubmit(run, submitterId, submitterName);
      assert(submit.status >= 400, `submit blocked ${submit.status}`);

      const approve = await postApprove(run, approverId, approverName);
      assert(approve.status >= 400, `approve blocked ${approve.status}`);

      const reject = await postReject(run, approverId, approverName);
      assert(reject.status >= 400, `reject blocked ${reject.status}`);

      // scope mutation — يُرفض لأن التشغيل ليس DRAFT
      const scope = await scopePost(
        authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/scope-members`, submitterId, submitterName, {
          method: 'POST',
          body: JSON.stringify({
            payroll_person_id: owned.personIds[0],
            version: run.version,
            updated_at: isoAt(run.updated_at),
          }),
        }),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(scope.status >= 400, `scope blocked ${scope.status}`);
    });

    await it('13) posting guard يقبل APPROVED السليم', async () => {
      const fresh = await withTransaction((c) => loadPayrollRun(c, run.id));
      assertPayrollRunReadyForPosting(
        {
          status: fresh.status,
          error_count: fresh.error_count,
          snapshot_hash: fresh.snapshot_hash,
          approved_snapshot_hash: fresh.approved_snapshot_hash,
        },
        { approval_fields_complete: true, artifacts_match: true, blocking_issues_count: 0 }
      );
    });

    await it('14) لا يوجد Posting/Payments/Payslips endpoint', async () => {
      for (const route of ['post', 'posting', 'payments', 'payslips', 'journal']) {
        assert(
          !existsSync(
            resolve(__dirname, `../../app/api/accounts/payroll/runs/[id]/${route}/route.ts`)
          ),
          `endpoint موجود: ${route}`
        );
      }
    });

    await it('15) GET run يعرض can_view_history ولا mutation flags', async () => {
      const res = await runGet(
        authReq(`http://localhost/api/accounts/payroll/runs/${run.id}`, approverId, approverName),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(res.status === 200, `get ${res.status}`);
      const body = await res.json();
      const a = body.data?.approval ?? body.approval;
      assert(a?.can_view_history === true, 'can_view_history');
      assert(a?.can_submit_for_review === false, 'no submit');
      assert(a?.can_approve === false, 'no approve');
      assert(a?.can_reject === false, 'no reject');
      assert(a?.can_recalculate === false, 'no recalc');
    });
  } finally {
    await cleanupOwned();
    await it('16) cleanup صفر', async () => {
      assert((await countOwned()) === 0, 'leftovers');
    });
    console.log(`===== النتيجة: ${passCount} ناجح / ${failCount} فاشل =====`);
    await closePool();
  }
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
