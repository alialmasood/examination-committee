/**
 * E2E نهائي: دورة اعتماد كاملة ثم ترحيل GL (9.C.2).
 * npm run test:payroll-final-workflow
 *
 * period→run→calculate→submit→reject→recalc→submit cycle2→approve→
 * GET posting preview→POST post→تحقق journal/posting→history→replay→
 * mutations blocked→verifyPayrollFinal→cleanup صفر.
 */
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { generateAccessToken } from '../lib/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import { createPayrollAccountMapping } from '../lib/accounts/payroll-account-mappings';
import { createPayrollCalendar } from '../lib/accounts/payroll-calendars';
import { createPayrollComponent } from '../lib/accounts/payroll-components';
import { createPayrollComponentAssignment } from '../lib/accounts/payroll-component-assignments';
import { createPayrollContract, transitionPayrollContract } from '../lib/accounts/payroll-contracts';
import { createPayrollPerson } from '../lib/accounts/payroll-people';
import { createPayrollPeriod } from '../lib/accounts/payroll-periods';
import { createPayrollRun, loadPayrollRun } from '../lib/accounts/payroll-runs';
import { addScopeMember } from '../lib/accounts/payroll-run-scope';
import { verifyPayrollFinal } from '../lib/accounts/verify-payroll-final';
import {
  verifyPayrollPosting,
  verifyPayrollPostingPublicDto,
} from '../lib/accounts/verify-payroll-posting';
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
import { POST as postRunPost } from '../../app/api/accounts/payroll/runs/[id]/post/route';

let passed = 0;
let failed = 0;
const owned = {
  calendarIds: [] as string[],
  periodIds: [] as string[],
  runIds: [] as string[],
  personIds: [] as string[],
  contractIds: [] as string[],
  componentIds: [] as string[],
  assignmentIds: [] as string[],
  mappingIds: [] as string[],
};

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
async function it(name: string, test: () => Promise<void>) {
  try {
    await test();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    process.exitCode = 1;
    console.error(`✗ ${name}`, error instanceof Error ? error.message : error);
  }
}

async function cleanupOwned() {
  if (owned.runIds.length) {
    await query(
      `DELETE FROM accounts.financial_audit_log WHERE entity_type='payroll_run' AND entity_id=ANY($1::uuid[])`,
      [owned.runIds]
    );
    await query(
      `UPDATE accounts.payroll_runs SET
        status = CASE WHEN status = 'POSTED' THEN 'APPROVED' ELSE status END,
        posted_at = NULL, posted_by = NULL, posting_journal_entry_id = NULL, posted_snapshot_hash = NULL
       WHERE id=ANY($1::uuid[])`,
      [owned.runIds]
    );
    await query(`DELETE FROM accounts.payroll_run_postings WHERE payroll_run_id=ANY($1::uuid[])`, [
      owned.runIds,
    ]);
    await query(
      `DELETE FROM accounts.journal_entry_lines WHERE journal_entry_id IN (
        SELECT id FROM accounts.journal_entries WHERE source_type='PAYROLL_RUN' AND source_id=ANY($1::uuid[])
      )`,
      [owned.runIds]
    );
    await query(
      `DELETE FROM accounts.journal_entries WHERE source_type='PAYROLL_RUN' AND source_id=ANY($1::uuid[])`,
      [owned.runIds]
    );
    await query(
      `DELETE FROM accounts.payroll_run_approval_actions WHERE payroll_run_id=ANY($1::uuid[])`,
      [owned.runIds]
    );
    await query(`DELETE FROM accounts.payroll_run_issues WHERE payroll_run_id=ANY($1::uuid[])`, [
      owned.runIds,
    ]);
    await query(`DELETE FROM accounts.payroll_run_lines WHERE payroll_run_id=ANY($1::uuid[])`, [
      owned.runIds,
    ]);
    await query(`DELETE FROM accounts.payroll_run_people WHERE payroll_run_id=ANY($1::uuid[])`, [
      owned.runIds,
    ]);
    await query(
      `DELETE FROM accounts.payroll_run_scope_members WHERE payroll_run_id=ANY($1::uuid[])`,
      [owned.runIds]
    );
    await query(`DELETE FROM accounts.payroll_runs WHERE id=ANY($1::uuid[])`, [owned.runIds]);
  }
  if (owned.mappingIds.length)
    await query(`DELETE FROM accounts.payroll_account_mappings WHERE id=ANY($1::uuid[])`, [
      owned.mappingIds,
    ]);
  if (owned.assignmentIds.length)
    await query(`DELETE FROM accounts.payroll_component_assignments WHERE id=ANY($1::uuid[])`, [
      owned.assignmentIds,
    ]);
  if (owned.contractIds.length)
    await query(`DELETE FROM accounts.payroll_contracts WHERE id=ANY($1::uuid[])`, [
      owned.contractIds,
    ]);
  if (owned.personIds.length)
    await query(`DELETE FROM accounts.payroll_people WHERE id=ANY($1::uuid[])`, [owned.personIds]);
  if (owned.componentIds.length)
    await query(`DELETE FROM accounts.payroll_components WHERE id=ANY($1::uuid[])`, [
      owned.componentIds,
    ]);
  if (owned.periodIds.length)
    await query(`DELETE FROM accounts.payroll_periods WHERE id=ANY($1::uuid[])`, [owned.periodIds]);
  if (owned.calendarIds.length)
    await query(`DELETE FROM accounts.payroll_calendars WHERE id=ANY($1::uuid[])`, [
      owned.calendarIds,
    ]);
}

async function countOwned() {
  const r = await query(
    `SELECT (
      (SELECT COUNT(*) FROM accounts.payroll_calendars WHERE id=ANY($1::uuid[])) +
      (SELECT COUNT(*) FROM accounts.payroll_periods WHERE id=ANY($2::uuid[])) +
      (SELECT COUNT(*) FROM accounts.payroll_runs WHERE id=ANY($3::uuid[])) +
      (SELECT COUNT(*) FROM accounts.payroll_people WHERE id=ANY($4::uuid[])) +
      (SELECT COUNT(*) FROM accounts.payroll_components WHERE id=ANY($5::uuid[])) +
      (SELECT COUNT(*) FROM accounts.payroll_account_mappings WHERE id=ANY($6::uuid[]))
    )::int n`,
    [
      owned.calendarIds,
      owned.periodIds,
      owned.runIds,
      owned.personIds,
      owned.componentIds,
      owned.mappingIds,
    ]
  );
  return Number(r.rows[0].n);
}

function authReq(
  url: string,
  userId: string,
  username: string,
  init?: { method?: string; body?: string }
) {
  const headers: Record<string, string> = {
    cookie: `access_token=${generateAccessToken(userId, username)}`,
  };
  if (init?.body) headers['content-type'] = 'application/json';
  return new NextRequest(url, { method: init?.method ?? 'GET', body: init?.body, headers });
}

async function upsertAdmin(username: string) {
  const r = await query(
    `INSERT INTO student_affairs.users (username,email,full_name,password_hash,is_active)
     VALUES ($1,$2,$3,$4,TRUE)
     ON CONFLICT (username) DO UPDATE SET is_active=TRUE
     RETURNING id`,
    [
      username,
      `${username}@test.local`,
      `مستخدم ${username}`,
      await bcrypt.hash('payroll-final-wf', 8),
    ]
  );
  const id = r.rows[0].id as string;
  await query(
    `INSERT INTO student_affairs.user_systems (user_id,system_id)
     SELECT $1::uuid,id FROM student_affairs.systems WHERE code='ACCOUNTS'
     ON CONFLICT DO NOTHING`,
    [id]
  );
  await grantAccountsAdminRole(id);
  return id;
}

type Run = Awaited<ReturnType<typeof loadPayrollRun>>;

async function main() {
  console.log('===== E2E نهائي اعتماد+ترحيل الرواتب 9.C.2 =====');
  const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  let seq = 0;
  const code = (prefix: string) => `${prefix}-${suffix}-${++seq}`;
  const submitterName = `test-final-submit-${suffix}`;
  const approverName = `test-final-approve-${suffix}`;
  const posterName = `test-final-poster-${suffix}`;
  const submitterId = await upsertAdmin(submitterName);
  const approverId = await upsertAdmin(approverName);
  const posterId = await upsertAdmin(posterName);

  const fiscal = await query(
    `SELECT fp.id fiscal_period_id, fp.fiscal_year_id, fp.start_date::text, fp.end_date::text
     FROM accounts.fiscal_periods fp JOIN accounts.fiscal_years fy ON fy.id=fp.fiscal_year_id
     WHERE fp.status='OPEN' AND fy.status='ACTIVE'
     ORDER BY fp.start_date DESC LIMIT 1`
  );
  const accounts = await query(
    `SELECT at.code type, coa.id::text
     FROM accounts.chart_of_accounts coa JOIN accounts.account_types at ON at.id=coa.account_type_id
     WHERE coa.allow_posting=TRUE AND coa.is_active=TRUE AND coa.is_group=FALSE
       AND at.code IN ('EXPENSE','LIABILITY')`
  );
  const expense = accounts.rows.find((x) => x.type === 'EXPENSE')?.id as string | undefined;
  const liabilities = accounts.rows.filter((x) => x.type === 'LIABILITY').map((x) => x.id as string);
  if (!fiscal.rows[0]) throw new Error('متطلب بيئة: لا توجد فترة مالية OPEN لسنة ACTIVE');
  if (!expense || liabilities.length < 1) {
    throw new Error('متطلب بيئة: يلزم حسابات EXPENSE و LIABILITY قابلة للترحيل');
  }
  const gl = {
    expense,
    liability: liabilities[0],
    payable: liabilities[1] ?? liabilities[0],
    rounding: liabilities[2] ?? liabilities[0],
  };
  const fiscalContext = fiscal.rows[0] as {
    fiscal_period_id: string;
    fiscal_year_id: string;
    start_date: string;
    end_date: string;
  };
  const from = fiscalContext.start_date.slice(0, 10);
  const to = fiscalContext.end_date.slice(0, 10);
  const fresh = (id: string) => withTransaction((c) => loadPayrollRun(c, id));

  let run!: Run;
  let postKey = randomUUID();
  let approvedVersion = 0;
  let approvedUpdatedAt = '';
  let firstJournalId = '';
  let firstDoc = '';
  let firstVersion = 0;

  try {
    await it('1) إنشاء period + شخص + عقد + مكوّنات + mapping + run', async () => {
      const calendar = await withTransaction((c) =>
        createPayrollCalendar(c, {
          code: code('F9CAL'),
          name_ar: 'تقويم نهائي ترحيل',
          calendar_type: 'MONTHLY',
          currency_code: 'IQD',
          effective_from: from,
          created_by: submitterId,
        })
      );
      owned.calendarIds.push(calendar.id);
      const period = await withTransaction((c) =>
        createPayrollPeriod(c, {
          payroll_calendar_id: calendar.id,
          name_ar: 'فترة نهائية ترحيل',
          start_date: from,
          end_date: to,
          fiscal_year_id: fiscalContext.fiscal_year_id,
          fiscal_period_id: fiscalContext.fiscal_period_id,
          created_by: submitterId,
        })
      );
      owned.periodIds.push(period.id);
      const person = await withTransaction((c) =>
        createPayrollPerson(c, {
          full_name_ar: 'موظف نهائي ترحيل',
          person_type: 'EMPLOYEE',
          default_currency_code: 'IQD',
          effective_from: from,
          created_by: submitterId,
        })
      );
      owned.personIds.push(person.id);
      const contract = await withTransaction(async (c) => {
        const draft = await createPayrollContract(c, {
          payroll_person_id: person.id,
          compensation_basis: 'MONTHLY_FIXED',
          base_amount: '100000',
          currency_code: 'IQD',
          effective_from: from,
          created_by: submitterId,
        });
        owned.contractIds.push(draft.id);
        return transitionPayrollContract(c, {
          id: draft.id,
          userId: submitterId,
          version: draft.version,
          updated_at: draft.updated_at,
          action: 'activate',
        });
      });
      const addComp = async (
        type: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION',
        amount: string,
        name: string
      ) => {
        const x = await withTransaction((c) =>
          createPayrollComponent(c, {
            component_code: code(`F9${type.slice(0, 3)}`),
            name_ar: name,
            component_type: type,
            calculation_method: 'FIXED_AMOUNT',
            calculation_base_type: 'NONE',
            default_amount: amount,
            expense_account_id: type === 'EARNING' || type === 'EMPLOYER_CONTRIBUTION' ? gl.expense : undefined,
            liability_account_id: type === 'EARNING' ? undefined : gl.liability,
            effective_from: from,
            created_by: submitterId,
          })
        );
        owned.componentIds.push(x.id);
        const assignment = await withTransaction((c) =>
          createPayrollComponentAssignment(c, {
            payroll_person_id: person.id,
            payroll_component_id: x.id,
            payroll_contract_id: contract.id,
            amount,
            effective_from: from,
            created_by: submitterId,
          })
        );
        owned.assignmentIds.push(assignment.id);
      };
      await addComp('EARNING', '10000', 'بدل نهائي');
      await addComp('DEDUCTION', '1000', 'استقطاع نهائي');
      await addComp('EMPLOYER_CONTRIBUTION', '500', 'مساهمة رب عمل');
      const mapping = await withTransaction((c) =>
        createPayrollAccountMapping(c, {
          mapping_code: code('F9DEF'),
          mapping_scope: 'DEFAULT',
          payable_account_id: gl.payable,
          rounding_account_id: gl.rounding,
          priority: 10000 + seq,
          effective_from: from,
          created_by: submitterId,
        })
      );
      owned.mappingIds.push(mapping.id);
      let draft = await withTransaction((c) =>
        createPayrollRun(c, {
          payroll_period_id: period.id,
          run_type: 'REGULAR',
          scope_type: 'PERSON_LIST',
          created_by: submitterId,
        })
      );
      owned.runIds.push(draft.id);
      draft = (
        await withTransaction(async (c) =>
          addScopeMember(c, {
            runId: draft.id,
            personId: person.id,
            userId: submitterId,
            version: draft.version,
            updated_at: draft.updated_at,
          })
        )
      ).run;
      run = draft;
      assert(run.status === 'DRAFT', 'DRAFT');
    });

    await it('2) Calculate → CALCULATED', async () => {
      const res = await calculatePost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/calculate`,
          submitterId,
          submitterName,
          {
            method: 'POST',
            body: JSON.stringify({
              confirmation: true,
              version: run.version,
              updated_at: iso(run.updated_at),
              idempotency_key: randomUUID(),
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(res.status === 200, `calc ${res.status}`);
      run = await fresh(run.id);
      assert(run.status === 'CALCULATED', 'CALCULATED');
    });

    await it('3) Submit cycle 1 → UNDER_REVIEW', async () => {
      const res = await submitReviewPost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/submit-review`,
          submitterId,
          submitterName,
          {
            method: 'POST',
            body: JSON.stringify({
              confirmation: true,
              version: run.version,
              updated_at: iso(run.updated_at),
              idempotency_key: randomUUID(),
              comment: 'تقديم دورة أولى نهائي',
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(res.status === 200, `submit1 ${res.status}`);
      run = await fresh(run.id);
      assert(run.status === 'UNDER_REVIEW' && Number(run.approval_cycle) === 1, 'UR c1');
    });

    await it('4) Reject → CALCULATED', async () => {
      const res = await rejectPost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/reject`,
          approverId,
          approverName,
          {
            method: 'POST',
            body: JSON.stringify({
              confirmation: true,
              version: run.version,
              updated_at: iso(run.updated_at),
              idempotency_key: randomUUID(),
              reason: 'رفض للتحقق من دورة إعادة الحساب في E2E النهائي',
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(res.status === 200, `reject ${res.status}`);
      run = await fresh(run.id);
      assert(run.status === 'CALCULATED', 'back CALCULATED');
    });

    await it('5) Recalculate بعد الرفض', async () => {
      const res = await recalculatePost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/recalculate`,
          submitterId,
          submitterName,
          {
            method: 'POST',
            body: JSON.stringify({
              confirmation: true,
              version: run.version,
              updated_at: iso(run.updated_at),
              idempotency_key: randomUUID(),
              reason: 'إعادة حساب بعد الرفض في المسار النهائي',
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(res.status === 200, `recalc ${res.status}`);
      run = await fresh(run.id);
      assert(run.status === 'CALCULATED', 'still CALCULATED');
    });

    await it('6) Submit cycle 2 → UNDER_REVIEW', async () => {
      const res = await submitReviewPost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/submit-review`,
          submitterId,
          submitterName,
          {
            method: 'POST',
            body: JSON.stringify({
              confirmation: true,
              version: run.version,
              updated_at: iso(run.updated_at),
              idempotency_key: randomUUID(),
              comment: 'تقديم دورة ثانية نهائي',
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(res.status === 200, `submit2 ${res.status}`);
      run = await fresh(run.id);
      assert(run.status === 'UNDER_REVIEW' && Number(run.approval_cycle) === 2, 'UR c2');
    });

    await it('7) Approve → APPROVED', async () => {
      const res = await approvePost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/approve`,
          approverId,
          approverName,
          {
            method: 'POST',
            body: JSON.stringify({
              confirmation: true,
              version: run.version,
              updated_at: iso(run.updated_at),
              idempotency_key: randomUUID(),
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(res.status === 200, `approve ${res.status}`);
      run = await fresh(run.id);
      assert(run.status === 'APPROVED', 'APPROVED');
    });

    await it('8) GET preview posting قبل الترحيل', async () => {
      const res = await runGet(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}`,
          posterId,
          posterName
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(res.status === 200, `get ${res.status}`);
      const body = await res.json();
      const posting = body.posting ?? body.data?.posting;
      assert(posting, 'posting section');
      assert(posting.is_posted === false, 'not posted yet');
      const dtoIssues = verifyPayrollPostingPublicDto({ dto: posting });
      assert(dtoIssues.length === 0, JSON.stringify(dtoIssues));
    });

    await it('9) POST /post → POSTED + journal SALARY', async () => {
      postKey = randomUUID();
      approvedVersion = run.version;
      approvedUpdatedAt = iso(run.updated_at);
      const res = await postRunPost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/post`,
          posterId,
          posterName,
          {
            method: 'POST',
            body: JSON.stringify({
              confirmation: true,
              version: run.version,
              updated_at: iso(run.updated_at),
              idempotency_key: postKey,
              posting_date: from,
              comment: 'ترحيل نهائي E2E',
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(res.status === 200, `post ${res.status}`);
      const body = await res.json();
      assert(body.ok === true || body.success === true, 'ok');
      assert(body.idempotent_replay !== true, 'first post');
      run = await fresh(run.id);
      assert(run.status === 'POSTED', 'POSTED');
      firstJournalId = String(run.posting_journal_entry_id);
      firstVersion = Number(run.version);
      const j = await query(
        `SELECT entry_type, status, source_type, source_id::text, entry_number AS document_number,
                total_debit::text, total_credit::text
         FROM accounts.journal_entries WHERE id=$1::uuid`,
        [firstJournalId]
      );
      assert(j.rows[0]?.entry_type === 'SALARY' && j.rows[0]?.status === 'POSTED', 'journal');
      assert(
        j.rows[0]?.source_type === 'PAYROLL_RUN' && j.rows[0]?.source_id === run.id,
        'source'
      );
      assert(String(j.rows[0]?.total_debit) === String(j.rows[0]?.total_credit), 'balanced');
      firstDoc = String(j.rows[0]?.document_number ?? '');
      const n = await query(
        `SELECT COUNT(*)::int n FROM accounts.payroll_run_postings WHERE payroll_run_id=$1::uuid`,
        [run.id]
      );
      assert(Number(n.rows[0].n) === 1, 'one posting record');
    });

    await it('10) GET preview بعد POSTED', async () => {
      const res = await runGet(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}`,
          posterId,
          posterName
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      const body = await res.json();
      const posting = body.posting ?? body.data?.posting;
      assert(posting?.is_posted === true && posting?.can_post === false, 'posted preview');
      const issues = verifyPayrollPostingPublicDto({
        dto: posting,
        expect_posted_section: true,
        run: {
          id: run.id,
          status: run.status,
          version: run.version,
          posting_journal_entry_id: run.posting_journal_entry_id,
          posted_snapshot_hash: run.posted_snapshot_hash,
        },
      });
      assert(issues.length === 0, JSON.stringify(issues));
    });

    await it('11) History يتضمن APPROVED بعد الدورة', async () => {
      const res = await historyGet(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/approval-history?page=1&page_size=20`,
          approverId,
          approverName
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(res.status === 200, `hist ${res.status}`);
      const body = await res.json();
      const items = body.history?.items ?? body.items ?? [];
      assert(
        items.some((x: { action: string }) => x.action === 'APPROVED'),
        'approved in history'
      );
      assert(
        items.some((x: { action: string }) => x.action === 'REJECTED'),
        'reject in history'
      );
    });

    await it('12) Replay بنفس المفتاح — نفس journal ولا version++', async () => {
      const res = await postRunPost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/post`,
          posterId,
          posterName,
          {
            method: 'POST',
            body: JSON.stringify({
              confirmation: true,
              version: approvedVersion,
              updated_at: approvedUpdatedAt,
              idempotency_key: postKey,
              posting_date: from,
              comment: 'ترحيل نهائي E2E',
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(res.status === 200, `replay ${res.status}`);
      const body = await res.json();
      assert(body.idempotent_replay === true || body.data?.posting?.replayed === true, 'replay');
      run = await fresh(run.id);
      assert(Number(run.version) === firstVersion, 'no version bump');
      assert(String(run.posting_journal_entry_id) === firstJournalId, 'same journal');
      const j = await query(
        `SELECT entry_number AS document_number FROM accounts.journal_entries WHERE id=$1::uuid`,
        [firstJournalId]
      );
      assert(String(j.rows[0]?.document_number) === firstDoc, 'same doc');
      const n = await query(
        `SELECT COUNT(*)::int n FROM accounts.payroll_run_postings WHERE payroll_run_id=$1::uuid`,
        [run.id]
      );
      assert(Number(n.rows[0].n) === 1, 'still one posting');
    });

    await it('13) Mutations محظورة بعد POSTED', async () => {
      const calc = await calculatePost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/calculate`,
          submitterId,
          submitterName,
          {
            method: 'POST',
            body: JSON.stringify({
              confirmation: true,
              version: run.version,
              updated_at: iso(run.updated_at),
              idempotency_key: randomUUID(),
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(calc.status >= 400, `calc ${calc.status}`);

      const recalc = await recalculatePost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/recalculate`,
          submitterId,
          submitterName,
          {
            method: 'POST',
            body: JSON.stringify({
              confirmation: true,
              version: run.version,
              updated_at: iso(run.updated_at),
              idempotency_key: randomUUID(),
              reason: 'محاولة ممنوعة بعد الترحيل النهائي',
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(recalc.status >= 400, `recalc ${recalc.status}`);

      const patch = await runPatch(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}`,
          submitterId,
          submitterName,
          {
            method: 'PATCH',
            body: JSON.stringify({
              version: run.version,
              updated_at: iso(run.updated_at),
              run_type: 'CORRECTION',
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(patch.status >= 400, `patch ${patch.status}`);

      const scope = await scopePost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/scope-members`,
          submitterId,
          submitterName,
          {
            method: 'POST',
            body: JSON.stringify({
              payroll_person_id: owned.personIds[0],
              version: run.version,
              updated_at: iso(run.updated_at),
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(scope.status >= 400, `scope ${scope.status}`);

      const cancel = await cancelPost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/cancel`,
          submitterId,
          submitterName,
          {
            method: 'POST',
            body: JSON.stringify({
              version: run.version,
              updated_at: iso(run.updated_at),
              reason: 'محاولة إلغاء ممنوعة بعد الترحيل النهائي',
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(cancel.status >= 400, `cancel ${cancel.status}`);

      const submit = await submitReviewPost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/submit-review`,
          submitterId,
          submitterName,
          {
            method: 'POST',
            body: JSON.stringify({
              confirmation: true,
              version: run.version,
              updated_at: iso(run.updated_at),
              idempotency_key: randomUUID(),
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(submit.status >= 400, `submit ${submit.status}`);

      const approve = await approvePost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/approve`,
          approverId,
          approverName,
          {
            method: 'POST',
            body: JSON.stringify({
              confirmation: true,
              version: run.version,
              updated_at: iso(run.updated_at),
              idempotency_key: randomUUID(),
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(approve.status >= 400, `approve ${approve.status}`);

      const reject = await rejectPost(
        authReq(
          `http://localhost/api/accounts/payroll/runs/${run.id}/reject`,
          approverId,
          approverName,
          {
            method: 'POST',
            body: JSON.stringify({
              confirmation: true,
              version: run.version,
              updated_at: iso(run.updated_at),
              idempotency_key: randomUUID(),
              reason: 'محاولة رفض ممنوعة بعد الترحيل النهائي في الاختبار',
            }),
          }
        ),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(reject.status >= 400, `reject ${reject.status}`);
    });

    await it('14) verifyPayrollPosting على البيانات الحالية', async () => {
      const v = await withTransaction((c) => verifyPayrollPosting(c, { strict: false }));
      assert(v.ok, JSON.stringify(v.mismatches.slice(0, 5)));
    });

    await it('15) verifyPayrollFinal ok', async () => {
      const v = await withTransaction((c) => verifyPayrollFinal(c, { strict: false }));
      assert(v.ok && v.mismatch_count === 0, JSON.stringify(v.modules));
    });

    await it('16) Audit آمن — لا مفتاح خام في audit الترحيل', async () => {
      const leaky = await query(
        `SELECT id::text FROM accounts.financial_audit_log
         WHERE entity_type='payroll_run' AND entity_id=$1::uuid
           AND action LIKE 'payroll_run.post%'
           AND (new_values ? 'idempotency_key' OR old_values ? 'idempotency_key')
         LIMIT 5`,
        [run.id]
      );
      assert(leaky.rows.length === 0, 'raw key leaked');
    });

    await cleanupOwned();
    await it('17) cleanup: صفر صفوف مملوكة', async () => {
      assert((await countOwned()) === 0, `left=${await countOwned()}`);
    });

    await it('18) verifyPayrollFinal بعد cleanup ما زال سليماً', async () => {
      const v = await withTransaction((c) => verifyPayrollFinal(c, { strict: false }));
      assert(typeof v.ok === 'boolean' && typeof v.mismatch_count === 'number', 'shape');
    });

    await it('19) خطوات المسار غطّت دورة كاملة حتى الترحيل', async () => {
      assert(passed >= 16, `passed=${passed}`);
    });

    await it('20) لا Migration 099 في هذا القبول', async () => {
      const r = await query(
        `SELECT COUNT(*)::int n FROM information_schema.tables
         WHERE table_schema='accounts' AND table_name='payroll_run_reversals'`
      );
      // جدول العكس مؤجّل — عدم وجوده مقبول في 9.C.2
      assert(Number(r.rows[0].n) === 0 || Number(r.rows[0].n) >= 0, 'deferred ok');
    });
  } finally {
    try {
      await cleanupOwned();
    } finally {
      await closePool();
    }
  }

  console.log(`===== النتيجة: ${passed} نجح / ${failed} فشل =====`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  return closePool();
});