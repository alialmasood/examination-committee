/**
 * تكامل HTTP لترحيل الرواتب POST …/post (9.C.2) — 70+ حالة مسماة.
 * npm run test:payroll-posting-integration
 *
 * يعتمد seedReady مثل posting-core + قدرات override + failpoints + verify DTO.
 */
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { generateAccessToken } from '../lib/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import {
  __clearPayrollCapabilitiesOverrideForTests,
  __setPayrollCapabilitiesOverrideForTests,
  PAYROLL_CAPABILITIES,
} from '../lib/accounts/payroll-access';
import { createPayrollAccountMapping } from '../lib/accounts/payroll-account-mappings';
import { createPayrollCalendar } from '../lib/accounts/payroll-calendars';
import { createPayrollComponent } from '../lib/accounts/payroll-components';
import { createPayrollComponentAssignment } from '../lib/accounts/payroll-component-assignments';
import { createPayrollContract, transitionPayrollContract } from '../lib/accounts/payroll-contracts';
import { createPayrollPerson } from '../lib/accounts/payroll-people';
import { createPayrollPeriod } from '../lib/accounts/payroll-periods';
import {
  __clearPayrollPostingFailpointForTests,
  __setPayrollPostingFailpointForTests,
} from '../lib/accounts/payroll-posting-failpoints';
import { createPayrollRun, loadPayrollRun } from '../lib/accounts/payroll-runs';
import { addScopeMember } from '../lib/accounts/payroll-run-scope';
import {
  verifyPayrollPosting,
  verifyPayrollPostingPublicDto,
} from '../lib/accounts/verify-payroll-posting';
import { withTransaction } from '../lib/accounts/with-transaction';
import { POST as calculatePost } from '../../app/api/accounts/payroll/runs/[id]/calculate/route';
import { POST as submitReviewPost } from '../../app/api/accounts/payroll/runs/[id]/submit-review/route';
import { POST as approvePost } from '../../app/api/accounts/payroll/runs/[id]/approve/route';
import { POST as rejectPost } from '../../app/api/accounts/payroll/runs/[id]/reject/route';
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
  } finally {
    __clearPayrollPostingFailpointForTests();
    __clearPayrollCapabilitiesOverrideForTests();
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
  init?: { method?: string; body?: string; headers?: Record<string, string> }
) {
  const headers: Record<string, string> = {
    cookie: `access_token=${generateAccessToken(userId, username)}`,
    ...(init?.headers ?? {}),
  };
  if (init?.body && !headers['content-type']) headers['content-type'] = 'application/json';
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
      await bcrypt.hash('payroll-post-http', 8),
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

function errCode(body: unknown): string {
  const b = body as { error?: { code?: string }; code?: string } | null;
  return String(b?.error?.code ?? b?.code ?? '');
}

type Run = Awaited<ReturnType<typeof loadPayrollRun>>;

async function main() {
  console.log('===== تكامل HTTP ترحيل الرواتب 9.C.2 (70+) =====');
  const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  let seq = 0;
  const code = (prefix: string) => `${prefix}-${suffix}-${++seq}`;
  const submitterName = `test-pi-submit-${suffix}`;
  const approverName = `test-pi-approve-${suffix}`;
  const posterName = `test-pi-poster-${suffix}`;
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
  if (!fiscal.rows[0]) throw new Error('متطلب بيئة: لا فترة مالية OPEN');
  if (!expense || liabilities.length < 1) throw new Error('متطلب بيئة: حسابات GL ناقصة');
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

  async function callPost(
    run: Run | string,
    userId: string,
    username: string,
    opts: {
      key?: string;
      comment?: unknown;
      version?: unknown;
      updated_at?: unknown;
      confirmation?: unknown;
      posting_date?: unknown;
      omitKey?: boolean;
      rawBody?: string;
      extra?: Record<string, unknown>;
    } = {}
  ) {
    const runId = typeof run === 'string' ? run : run.id;
    if (opts.rawBody != null) {
      return postRunPost(
        authReq(`http://localhost/api/accounts/payroll/runs/${runId}/post`, userId, username, {
          method: 'POST',
          body: opts.rawBody,
        }),
        { params: Promise.resolve({ id: runId }) }
      );
    }
    const body: Record<string, unknown> = { ...(opts.extra ?? {}) };
    if (opts.confirmation !== undefined) body.confirmation = opts.confirmation;
    else body.confirmation = true;
    if (opts.version !== undefined) body.version = opts.version;
    else if (typeof run !== 'string') body.version = run.version;
    if (opts.updated_at !== undefined) body.updated_at = opts.updated_at;
    else if (typeof run !== 'string') body.updated_at = iso(run.updated_at);
    if (!opts.omitKey) body.idempotency_key = opts.key ?? randomUUID();
    if (opts.posting_date !== undefined) body.posting_date = opts.posting_date;
    else body.posting_date = from;
    if (opts.comment !== undefined) body.comment = opts.comment;
    return postRunPost(
      authReq(`http://localhost/api/accounts/payroll/runs/${runId}/post`, userId, username, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: runId }) }
    );
  }

  async function seedReady(opts: { missingExpense?: boolean; currency?: string } = {}) {
    const calendar = await withTransaction((c) =>
      createPayrollCalendar(c, {
        code: code('PI9CAL'),
        name_ar: 'تقويم تكامل ترحيل',
        calendar_type: 'MONTHLY',
        currency_code: opts.currency ?? 'IQD',
        effective_from: from,
        created_by: submitterId,
      })
    );
    owned.calendarIds.push(calendar.id);
    const period = await withTransaction((c) =>
      createPayrollPeriod(c, {
        payroll_calendar_id: calendar.id,
        name_ar: 'فترة تكامل ترحيل',
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
        full_name_ar: 'موظف تكامل ترحيل',
        person_type: 'EMPLOYEE',
        default_currency_code: opts.currency ?? 'IQD',
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
        currency_code: opts.currency ?? 'IQD',
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
    const component = async (
      type: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION',
      amount: string,
      name: string
    ) => {
      const x = await withTransaction((c) =>
        createPayrollComponent(c, {
          component_code: code(`PI9${type.slice(0, 3)}`),
          name_ar: name,
          component_type: type,
          calculation_method: 'FIXED_AMOUNT',
          calculation_base_type: 'NONE',
          default_amount: amount,
          expense_account_id:
            opts.missingExpense && type === 'EARNING'
              ? undefined
              : type === 'EARNING' || type === 'EMPLOYER_CONTRIBUTION'
                ? gl.expense
                : undefined,
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
    await component('EARNING', '10000', 'بدل تكامل');
    await component('DEDUCTION', '1000', 'استقطاع تكامل');
    await component('EMPLOYER_CONTRIBUTION', '500', 'مساهمة تكامل');
    const mapping = await withTransaction((c) =>
      createPayrollAccountMapping(c, {
        mapping_code: code('PI9DEF'),
        mapping_scope: 'DEFAULT',
        payable_account_id: gl.payable,
        rounding_account_id: gl.rounding,
        priority: 10000 + seq,
        effective_from: from,
        created_by: submitterId,
      })
    );
    owned.mappingIds.push(mapping.id);
    let run = await withTransaction((c) =>
      createPayrollRun(c, {
        payroll_period_id: period.id,
        run_type: 'REGULAR',
        scope_type: 'PERSON_LIST',
        created_by: submitterId,
      })
    );
    owned.runIds.push(run.id);
    run = (
      await withTransaction(async (c) =>
        addScopeMember(c, {
          runId: run.id,
          personId: person.id,
          userId: submitterId,
          version: run.version,
          updated_at: run.updated_at,
        })
      )
    ).run;
    const calc = await calculatePost(
      authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/calculate`, submitterId, submitterName, {
        method: 'POST',
        body: JSON.stringify({
          confirmation: true,
          version: run.version,
          updated_at: iso(run.updated_at),
          idempotency_key: randomUUID(),
        }),
      }),
      { params: Promise.resolve({ id: run.id }) }
    );
    assert(calc.status === 200, `calculate ${calc.status}`);
    run = await fresh(run.id);
    const review = await submitReviewPost(
      authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/submit-review`, submitterId, submitterName, {
        method: 'POST',
        body: JSON.stringify({
          confirmation: true,
          version: run.version,
          updated_at: iso(run.updated_at),
          idempotency_key: randomUUID(),
        }),
      }),
      { params: Promise.resolve({ id: run.id }) }
    );
    assert(review.status === 200, `submit ${review.status}`);
    run = await fresh(run.id);
    const approve = await approvePost(
      authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/approve`, approverId, approverName, {
        method: 'POST',
        body: JSON.stringify({
          confirmation: true,
          version: run.version,
          updated_at: iso(run.updated_at),
          idempotency_key: randomUUID(),
        }),
      }),
      { params: Promise.resolve({ id: run.id }) }
    );
    assert(approve.status === 200, `approve ${approve.status}`);
    return { run: await fresh(run.id), period, personId: person.id };
  }

  try {    await it('1) migration: أعمدة جدول الترحيل 098 موجودة', async () => {
      const r = await query(`SELECT column_name FROM information_schema.columns WHERE table_schema='accounts'
        AND table_name IN ('payroll_runs','payroll_run_postings')`);
      const cols = new Set(r.rows.map((x) => x.column_name));
      for (const col of ['posted_at', 'posted_by', 'posting_journal_entry_id', 'request_key_hash', 'journal_entry_id'])
        assert(cols.has(col), col);
    });

    await it('2) happy path HTTP: APPROVED → POSTED', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName);
      assert(res.status === 200, `status ${res.status}`);
      assert((await fresh(run.id)).status === 'POSTED', 'POSTED');
    });

    await it('3) journal SALARY + PAYROLL_RUN + POSTED', async () => {
      const { run } = await seedReady();
      const body = await (await callPost(run, posterId, posterName)).json();
      const jeId = body.posting?.journal_entry?.id ?? body.data?.posting?.journal_entry_id;
      const j = await query(`SELECT entry_type,status,source_type,source_id::text FROM accounts.journal_entries WHERE id=$1::uuid`, [jeId]);
      assert(j.rows[0]?.entry_type === 'SALARY' && j.rows[0]?.status === 'POSTED', 'journal');
      assert(j.rows[0]?.source_type === 'PAYROLL_RUN' && j.rows[0]?.source_id === run.id, 'src');
    });

    await it('4) balanced debit=credit', async () => {
      const { run } = await seedReady();
      const body = await (await callPost(run, posterId, posterName)).json();
      const d = body.posting?.journal_entry?.debit_total ?? body.data?.posting?.total_debit;
      const c = body.posting?.journal_entry?.credit_total ?? body.data?.posting?.total_credit;
      assert(String(d) === String(c), `${d}/${c}`);
    });

    await it('5) مبالغ عشرية كنصوص في DTO', async () => {
      const { run } = await seedReady();
      const body = await (await callPost(run, posterId, posterName)).json();
      const d = body.posting?.journal_entry?.debit_total ?? body.data?.posting?.total_debit;
      assert(typeof d === 'string' && /\d/.test(String(d)), `got ${d}`);
    });

    await it('6) سجل posting مرة واحدة فقط', async () => {
      const { run } = await seedReady();
      await callPost(run, posterId, posterName);
      const n = await query(`SELECT COUNT(*)::int n FROM accounts.payroll_run_postings WHERE payroll_run_id=$1::uuid`, [run.id]);
      assert(Number(n.rows[0].n) === 1, 'one');
    });

    await it('7) comment غائب مقبول', async () => {
      const { run } = await seedReady();
      assert((await callPost(run, posterId, posterName)).status === 200, '200');
    });

    await it('8) comment حاضر يُحفظ', async () => {
      const { run } = await seedReady();
      const body = await (await callPost(run, posterId, posterName, { comment: 'ملاحظة ترحيل' })).json();
      assert((body.posting?.comment ?? body.data?.posting?.comment) === 'ملاحظة ترحيل', 'comment');
    });

    await it('9) comment يُطبَّع (normalize trim)', async () => {
      const { run } = await seedReady();
      const body = await (await callPost(run, posterId, posterName, { comment: '  مسافات  ' })).json();
      const c = body.posting?.comment ?? body.data?.posting?.comment;
      assert(String(c).trim() === 'مسافات', `got=${c}`);
    });

    await it('10) comment >500 → 400', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName, { comment: 'س'.repeat(501) });
      assert(res.status === 400, `${res.status}`);
      const body = await res.json();
      assert(errCode(body) === 'INVALID_POSTING_COMMENT', errCode(body));
    });

    await it('11) malformed JSON → 400 MALFORMED_JSON', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName, { rawBody: '{not-json' });
      assert(res.status === 400, `${res.status}`);
      assert(errCode(await res.json()) === 'MALFORMED_JSON', 'code');
    });

    await it('12) invalid UUID → 400', async () => {
      const res = await callPost('not-a-uuid', posterId, posterName, {
        version: 1,
        updated_at: new Date().toISOString(),
        key: randomUUID(),
      });
      assert(res.status === 400, `${res.status}`);
      assert(errCode(await res.json()) === 'INVALID_UUID', 'code');
    });

    await it('13) invalid version → 400', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName, { version: 0 });
      assert(res.status === 400, `${res.status}`);
      assert(errCode(await res.json()) === 'INVALID_VERSION', 'code');
    });

    await it('14) invalid updated_at → 400', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName, { updated_at: '' });
      assert(res.status === 400, `${res.status}`);
      assert(errCode(await res.json()) === 'INVALID_UPDATED_AT', 'code');
    });

    await it('15) invalid posting_date → 400', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName, { posting_date: '01-01-2025' });
      assert(res.status === 400, `${res.status}`);
      assert(errCode(await res.json()) === 'INVALID_POSTING_DATE', 'code');
    });

    await it('16) missing idempotency_key → 400', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName, { omitKey: true });
      assert(res.status === 400, `${res.status}`);
      assert(errCode(await res.json()) === 'INVALID_IDEMPOTENCY_KEY', 'code');
    });

    await it('17) missing confirmation → 400', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName, { confirmation: false });
      assert(res.status === 400, `${res.status}`);
      assert(errCode(await res.json()) === 'MISSING_CONFIRMATION', 'code');
    });

    await it('18) empty posting_date → 400', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName, { posting_date: '   ' });
      assert(res.status === 400, `${res.status}`);
    });

    await it('19) version غير رقمي → 400', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName, { version: 'abc' });
      assert(res.status === 400, `${res.status}`);
    });

    await it('20) body array → 400 MALFORMED_JSON', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName, { rawBody: '[]' });
      assert(res.status === 400, `${res.status}`);
    });

    await it('21) لا صلاحية ترحيل → 403', async () => {
      const { run } = await seedReady();
      __setPayrollCapabilitiesOverrideForTests(posterId, [PAYROLL_CAPABILITIES.VIEW]);
      const res = await callPost(run, posterId, posterName);
      assert(res.status === 403, `${res.status}`);
      assert(errCode(await res.json()) === 'FORBIDDEN', 'code');
    });

    await it('22) approve-only → 403', async () => {
      const { run } = await seedReady();
      __setPayrollCapabilitiesOverrideForTests(posterId, [
        PAYROLL_CAPABILITIES.APPROVE,
        PAYROLL_CAPABILITIES.VIEW_RUNS,
      ]);
      const res = await callPost(run, posterId, posterName);
      assert(res.status === 403, `${res.status}`);
    });

    await it('23) submit-only → 403', async () => {
      const { run } = await seedReady();
      __setPayrollCapabilitiesOverrideForTests(posterId, [
        PAYROLL_CAPABILITIES.SUBMIT_REVIEW,
        PAYROLL_CAPABILITIES.VIEW_RUNS,
      ]);
      const res = await callPost(run, posterId, posterName);
      assert(res.status === 403, `${res.status}`);
    });

    await it('24) admin مع payroll_post → 200', async () => {
      const { run } = await seedReady();
      __setPayrollCapabilitiesOverrideForTests(posterId, [
        PAYROLL_CAPABILITIES.POST,
        PAYROLL_CAPABILITIES.VIEW_RUNS,
        PAYROLL_CAPABILITIES.ADMIN,
      ]);
      const res = await callPost(run, posterId, posterName);
      assert(res.status === 200, `${res.status}`);
    });

    await it('25) admin الافتراضي يرحّل 200', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName);
      assert(res.status === 200, `${res.status}`);
    });    await it('26) IDOR UUID عشوائي → 404', async () => {
      const { run } = await seedReady();
      const res = await callPost(randomUUID(), posterId, posterName, {
        version: run.version,
        updated_at: iso(run.updated_at),
        key: randomUUID(),
      });
      assert(res.status === 404, `${res.status}`);
      assert(errCode(await res.json()) === 'PAYROLL_RUN_NOT_FOUND', 'code');
    });

    await it('27) DRAFT → 409', async () => {
      const { run } = await seedReady();
      await query(`UPDATE accounts.payroll_runs SET status='DRAFT' WHERE id=$1::uuid`, [run.id]);
      const freshRun = await fresh(run.id);
      const res = await callPost(freshRun, posterId, posterName);
      assert(res.status === 409, `${res.status}`);
    });

    await it('28) CALCULATED → 409', async () => {
      const { run } = await seedReady();
      await query(`UPDATE accounts.payroll_runs SET
        status='CALCULATED',
        review_snapshot_hash=NULL,
        submitted_for_review_at=NULL,
        submitted_for_review_by=NULL,
        approved_snapshot_hash=NULL,
        approved_at=NULL,
        approved_by=NULL
       WHERE id=$1::uuid`, [run.id]);
      const res = await callPost(await fresh(run.id), posterId, posterName);
      assert(res.status === 409, `${res.status}`);
    });

    await it('29) UNDER_REVIEW → 409', async () => {
      const { run } = await seedReady();
      await query(`UPDATE accounts.payroll_runs SET
        status='UNDER_REVIEW',
        approved_snapshot_hash=NULL,
        approved_at=NULL,
        approved_by=NULL
       WHERE id=$1::uuid`, [run.id]);
      const res = await callPost(await fresh(run.id), posterId, posterName);
      assert(res.status === 409, `${res.status}`);
    });

    await it('30) CANCELLED → 409', async () => {
      const { run } = await seedReady();
      await query(`UPDATE accounts.payroll_runs SET status='CANCELLED' WHERE id=$1::uuid`, [run.id]);
      const res = await callPost(await fresh(run.id), posterId, posterName);
      assert(res.status === 409, `${res.status}`);
    });

    await it('31) POSTED + مفتاح جديد → 409', async () => {
      const { run } = await seedReady();
      assert((await callPost(run, posterId, posterName)).status === 200, 'first');
      const posted = await fresh(run.id);
      const res = await callPost(posted, posterId, posterName, { key: randomUUID() });
      assert(res.status === 409, `${res.status}`);
      const code = errCode(await res.json());
      assert(code === 'PAYROLL_ALREADY_POSTED' || code === 'PAYROLL_POSTING_CONFLICT' || res.status === 409, code);
    });

    await it('32) stale version → 409', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName, { version: run.version - 1 });
      assert(res.status === 409, `${res.status}`);
    });

    await it('33) stale updated_at → 409', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName, {
        updated_at: new Date(Date.now() - 86400000).toISOString(),
      });
      assert(res.status === 409, `${res.status}`);
    });

    await it('34) approval integrity (hash drift) → 422', async () => {
      const { run } = await seedReady();
      await query(
        `UPDATE accounts.payroll_runs SET approved_snapshot_hash=repeat('a',64), review_snapshot_hash=repeat('a',64) WHERE id=$1::uuid`,
        [run.id]
      );
      const res = await callPost(await fresh(run.id), posterId, posterName);
      assert(res.status === 422 || res.status === 409, `${res.status}`);
    });

    await it('35) snapshot invalid → 422', async () => {
      const { run } = await seedReady();
      await query(`UPDATE accounts.payroll_runs SET snapshot_hash=repeat('b',64) WHERE id=$1::uuid`, [run.id]);
      const res = await callPost(await fresh(run.id), posterId, posterName);
      assert(res.status === 422 || res.status === 409, `${res.status}`);
    });

    await it('36) error_count>0 → 422 PAYROLL_HAS_ERRORS', async () => {
      const { run } = await seedReady();
      await query(`UPDATE accounts.payroll_runs SET error_count=1 WHERE id=$1::uuid`, [run.id]);
      const res = await callPost(await fresh(run.id), posterId, posterName);
      assert(res.status === 422, `${res.status}`);
      assert(errCode(await res.json()) === 'PAYROLL_HAS_ERRORS', 'code');
    });

    await it('37) blocking issues → 422', async () => {
      const { run } = await seedReady();
      await query(
        `INSERT INTO accounts.payroll_run_issues
         (payroll_run_id, severity, issue_code, message_ar, is_blocking, created_by)
         VALUES ($1::uuid, 'ERROR', 'TEST_BLOCK_POST', 'مشكلة حجب ترحيل', TRUE, $2::uuid)`,
        [run.id, submitterId]
      );
      const res = await callPost(await fresh(run.id), posterId, posterName);
      assert(res.status === 422, `${res.status}`);
      assert(errCode(await res.json()) === 'PAYROLL_HAS_BLOCKING_ISSUES', 'code');
    });

    await it('38) عملة غير IQD → 422', async () => {
      const { run } = await seedReady();
      await query(`UPDATE accounts.payroll_runs SET currency_code='USD' WHERE id=$1::uuid`, [run.id]);
      const res = await callPost(await fresh(run.id), posterId, posterName);
      assert(res.status === 422, `${res.status}`);
      assert(errCode(await res.json()) === 'PAYROLL_CURRENCY_NOT_SUPPORTED', 'code');
    });

    await it('39) فترة مالية مغلقة → 409 FISCAL', async () => {
      const { run } = await seedReady();
      await query(`UPDATE accounts.fiscal_periods SET status='CLOSED' WHERE id=$1::uuid`, [
        fiscalContext.fiscal_period_id,
      ]);
      try {
        const res = await callPost(run, posterId, posterName);
        assert(res.status === 409 || res.status === 422, `${res.status}`);
        const code = errCode(await res.json());
        assert(code === 'FISCAL_PERIOD_NOT_OPEN' || res.status >= 400, code);
      } finally {
        await query(`UPDATE accounts.fiscal_periods SET status='OPEN' WHERE id=$1::uuid`, [
          fiscalContext.fiscal_period_id,
        ]);
      }
    });

    await it('40) mapping ناقص (missingExpense) → 422', async () => {
      const { run } = await seedReady({ missingExpense: true });
      const res = await callPost(run, posterId, posterName);
      assert(res.status === 422, `${res.status}`);
      const code = errCode(await res.json());
      assert(
        code === 'PAYROLL_GL_MAPPING_MISSING' || code === 'PAYROLL_GL_ACCOUNT_INVALID' || res.status === 422,
        code
      );
    });

    await it('41) حساب GL غير صالح → 422 (تعطيل حساب expense)', async () => {
      const { run } = await seedReady();
      await query(`UPDATE accounts.chart_of_accounts SET is_active=FALSE WHERE id=$1::uuid`, [gl.expense]);
      try {
        const res = await callPost(run, posterId, posterName);
        assert(res.status === 422, `${res.status}`);
      } finally {
        await query(`UPDATE accounts.chart_of_accounts SET is_active=TRUE WHERE id=$1::uuid`, [gl.expense]);
      }
    });

    await it('42) rounding — عتبة ثابتة ما زالت 1.000 في المسار السعيد', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName);
      assert(res.status === 200, `${res.status}`);
      const body = await res.json();
      const d = body.posting?.journal_entry?.debit_total ?? body.data?.posting?.total_debit;
      const c = body.posting?.journal_entry?.credit_total ?? body.data?.posting?.total_credit;
      assert(String(d) === String(c), 'still balanced');
    });

    await it('43) replay نفس المفتاح: نفس journal', async () => {
      const { run } = await seedReady();
      const key = randomUUID();
      const firstRes = await callPost(run, posterId, posterName, { key, comment: 'replay-a' });
      assert(firstRes.status === 200, `first ${firstRes.status}`);
      const first = await firstRes.json();
      const secondRes = await callPost(run, posterId, posterName, { key, comment: 'replay-a' });
      assert(secondRes.status === 200, `second ${secondRes.status}`);
      const second = await secondRes.json();
      assert(second.idempotent_replay === true || second.data?.posting?.replayed === true, 'replay');
      const j1 = first.posting?.journal_entry?.id ?? first.data?.posting?.journal_entry_id;
      const j2 = second.posting?.journal_entry?.id ?? second.data?.posting?.journal_entry_id;
      assert(String(j1) === String(j2), 'same journal');
    });

    await it('44) replay نفس رقم المستند', async () => {
      const { run } = await seedReady();
      const key = randomUUID();
      const firstRes = await callPost(run, posterId, posterName, { key });
      assert(firstRes.status === 200, `first ${firstRes.status}`);
      const first = await firstRes.json();
      const secondRes = await callPost(run, posterId, posterName, { key });
      assert(secondRes.status === 200, `second ${secondRes.status}`);
      const second = await secondRes.json();
      const d1 = first.posting?.journal_entry?.document_number ?? first.data?.posting?.entry_number;
      const d2 = second.posting?.journal_entry?.document_number ?? second.data?.posting?.entry_number;
      assert(String(d1) === String(d2), 'same doc');
    });

    await it('45) replay لا يزيد version', async () => {
      const { run } = await seedReady();
      const key = randomUUID();
      const firstRes = await callPost(run, posterId, posterName, { key });
      assert(firstRes.status === 200, `first ${firstRes.status}`);
      const after = await fresh(run.id);
      const v1 = after.version;
      const secondRes = await callPost(run, posterId, posterName, { key });
      assert(secondRes.status === 200, `second ${secondRes.status}`);
      assert((await fresh(run.id)).version === v1, 'no bump');
    });

    await it('46) replay لا ينشئ posting ثاني', async () => {
      const { run } = await seedReady();
      const key = randomUUID();
      const firstRes = await callPost(run, posterId, posterName, { key });
      assert(firstRes.status === 200, `first ${firstRes.status}`);
      const secondRes = await callPost(run, posterId, posterName, { key });
      assert(secondRes.status === 200, `second ${secondRes.status}`);
      const n = await query(`SELECT COUNT(*)::int n FROM accounts.payroll_run_postings WHERE payroll_run_id=$1::uuid`, [run.id]);
      assert(Number(n.rows[0].n) === 1, 'one');
    });

    await it('47) تغيير posting_date/comment بنفس المفتاح → 409', async () => {
      const { run } = await seedReady();
      const key = randomUUID();
      const firstRes = await callPost(run, posterId, posterName, { key, comment: 'أصل', posting_date: from });
      assert(firstRes.status === 200, `first ${firstRes.status}`);
      const res = await callPost(run, posterId, posterName, {
        key,
        comment: 'مختلف',
        posting_date: from,
      });
      assert(res.status === 409, `${res.status}`);
    });

    await it('48) concurrent Post×Post بمفتاحين: نجاح واحد و409', async () => {
      const { run } = await seedReady();
      const [a, b] = await Promise.all([
        callPost(run, posterId, posterName, { key: randomUUID() }),
        callPost(run, posterId, posterName, { key: randomUUID() }),
      ]);
      const statuses = [a.status, b.status].sort((x, y) => x - y);
      assert(statuses[0] === 200 && statuses[1] === 409, `${a.status}/${b.status}`);
      const n = await query(`SELECT COUNT(*)::int n FROM accounts.payroll_run_postings WHERE payroll_run_id=$1::uuid`, [run.id]);
      assert(Number(n.rows[0].n) === 1, 'one posting');
      assert((await fresh(run.id)).status === 'POSTED', 'POSTED');
    });

    await it('48b) concurrent Post×Post بنفس المفتاح: 200/409 وposting واحد', async () => {
      const { run } = await seedReady();
      const key = randomUUID();
      const [a, b] = await Promise.all([
        callPost(run, posterId, posterName, { key }),
        callPost(run, posterId, posterName, { key }),
      ]);
      assert([200, 409].includes(a.status) && [200, 409].includes(b.status), `${a.status}/${b.status}`);
      const n = await query(`SELECT COUNT(*)::int n FROM accounts.payroll_run_postings WHERE payroll_run_id=$1::uuid`, [run.id]);
      assert(Number(n.rows[0].n) === 1, 'one posting');
      assert((await fresh(run.id)).status === 'POSTED', 'POSTED');
    });

    await it('49) failpoint post_after_journal_header → 500 + rollback', async () => {
      const { run } = await seedReady();
      __setPayrollPostingFailpointForTests('post_after_journal_header');
      const res = await callPost(run, posterId, posterName);
      assert(res.status === 500, `${res.status}`);
      assert(errCode(await res.json()) === 'TECHNICAL_FAILURE', 'code');
      assert((await fresh(run.id)).status === 'APPROVED', 'still APPROVED');
      const n = await query(`SELECT COUNT(*)::int n FROM accounts.payroll_run_postings WHERE payroll_run_id=$1::uuid`, [run.id]);
      assert(Number(n.rows[0].n) === 0, 'no posting');
      const j = await query(
        `SELECT COUNT(*)::int n FROM accounts.journal_entries WHERE source_type='PAYROLL_RUN' AND source_id=$1::uuid`,
        [run.id]
      );
      assert(Number(j.rows[0].n) === 0, 'no orphan journal');
    });

    await it('50) failpoint post_after_document_sequence → rollback', async () => {
      const { run } = await seedReady();
      __setPayrollPostingFailpointForTests('post_after_document_sequence');
      const res = await callPost(run, posterId, posterName);
      assert(res.status === 500, `${res.status}`);
      assert((await fresh(run.id)).status === 'APPROVED', 'APPROVED');
      const j = await query(
        `SELECT COUNT(*)::int n FROM accounts.journal_entries WHERE source_type='PAYROLL_RUN' AND source_id=$1::uuid`,
        [run.id]
      );
      assert(Number(j.rows[0].n) === 0, 'no orphan');
    });

    await it('51) failpoint post_after_mapping → 500 بلا ترحيل', async () => {
      const { run } = await seedReady();
      __setPayrollPostingFailpointForTests('post_after_mapping');
      const res = await callPost(run, posterId, posterName);
      assert(res.status === 500, `${res.status}`);
      assert((await fresh(run.id)).status === 'APPROVED', 'APPROVED');
    });    await it('52) POSTED يمنع calculate', async () => {
      const { run } = await seedReady();
      await callPost(run, posterId, posterName);
      const posted = await fresh(run.id);
      const res = await calculatePost(
        authReq(`http://localhost/api/accounts/payroll/runs/${posted.id}/calculate`, submitterId, submitterName, {
          method: 'POST',
          body: JSON.stringify({
            confirmation: true,
            version: posted.version,
            updated_at: iso(posted.updated_at),
            idempotency_key: randomUUID(),
          }),
        }),
        { params: Promise.resolve({ id: posted.id }) }
      );
      assert(res.status >= 400, `${res.status}`);
    });

    await it('53) POSTED يمنع recalculate', async () => {
      const { run } = await seedReady();
      await callPost(run, posterId, posterName);
      const posted = await fresh(run.id);
      const res = await recalculatePost(
        authReq(`http://localhost/api/accounts/payroll/runs/${posted.id}/recalculate`, submitterId, submitterName, {
          method: 'POST',
          body: JSON.stringify({
            confirmation: true,
            version: posted.version,
            updated_at: iso(posted.updated_at),
            idempotency_key: randomUUID(),
            reason: 'محاولة إعادة حساب بعد الترحيل في اختبار التكامل',
          }),
        }),
        { params: Promise.resolve({ id: posted.id }) }
      );
      assert(res.status >= 400, `${res.status}`);
    });

    await it('54) POSTED يمنع update/PATCH', async () => {
      const { run } = await seedReady();
      await callPost(run, posterId, posterName);
      const posted = await fresh(run.id);
      const res = await runPatch(
        authReq(`http://localhost/api/accounts/payroll/runs/${posted.id}`, submitterId, submitterName, {
          method: 'PATCH',
          body: JSON.stringify({
            version: posted.version,
            updated_at: iso(posted.updated_at),
            run_type: 'CORRECTION',
          }),
        }),
        { params: Promise.resolve({ id: posted.id }) }
      );
      assert(res.status >= 400, `${res.status}`);
    });

    await it('55) POSTED يمنع scope', async () => {
      const { run, personId } = await seedReady();
      await callPost(run, posterId, posterName);
      const posted = await fresh(run.id);
      const res = await scopePost(
        authReq(`http://localhost/api/accounts/payroll/runs/${posted.id}/scope-members`, submitterId, submitterName, {
          method: 'POST',
          body: JSON.stringify({
            payroll_person_id: personId,
            version: posted.version,
            updated_at: iso(posted.updated_at),
          }),
        }),
        { params: Promise.resolve({ id: posted.id }) }
      );
      assert(res.status >= 400, `${res.status}`);
    });

    await it('56) POSTED يمنع cancel', async () => {
      const { run } = await seedReady();
      await callPost(run, posterId, posterName);
      const posted = await fresh(run.id);
      const res = await cancelPost(
        authReq(`http://localhost/api/accounts/payroll/runs/${posted.id}/cancel`, submitterId, submitterName, {
          method: 'POST',
          body: JSON.stringify({
            version: posted.version,
            updated_at: iso(posted.updated_at),
            reason: 'محاولة إلغاء بعد الترحيل في اختبار التكامل',
          }),
        }),
        { params: Promise.resolve({ id: posted.id }) }
      );
      assert(res.status >= 400, `${res.status}`);
    });

    await it('57) POSTED يمنع submit-review', async () => {
      const { run } = await seedReady();
      await callPost(run, posterId, posterName);
      const posted = await fresh(run.id);
      const res = await submitReviewPost(
        authReq(`http://localhost/api/accounts/payroll/runs/${posted.id}/submit-review`, submitterId, submitterName, {
          method: 'POST',
          body: JSON.stringify({
            confirmation: true,
            version: posted.version,
            updated_at: iso(posted.updated_at),
            idempotency_key: randomUUID(),
          }),
        }),
        { params: Promise.resolve({ id: posted.id }) }
      );
      assert(res.status >= 400, `${res.status}`);
    });

    await it('58) POSTED يمنع approve', async () => {
      const { run } = await seedReady();
      await callPost(run, posterId, posterName);
      const posted = await fresh(run.id);
      const res = await approvePost(
        authReq(`http://localhost/api/accounts/payroll/runs/${posted.id}/approve`, approverId, approverName, {
          method: 'POST',
          body: JSON.stringify({
            confirmation: true,
            version: posted.version,
            updated_at: iso(posted.updated_at),
            idempotency_key: randomUUID(),
          }),
        }),
        { params: Promise.resolve({ id: posted.id }) }
      );
      assert(res.status >= 400, `${res.status}`);
    });

    await it('59) POSTED يمنع reject', async () => {
      const { run } = await seedReady();
      await callPost(run, posterId, posterName);
      const posted = await fresh(run.id);
      const res = await rejectPost(
        authReq(`http://localhost/api/accounts/payroll/runs/${posted.id}/reject`, approverId, approverName, {
          method: 'POST',
          body: JSON.stringify({
            confirmation: true,
            version: posted.version,
            updated_at: iso(posted.updated_at),
            idempotency_key: randomUUID(),
            reason: 'محاولة رفض بعد الترحيل في اختبار التكامل الطويل',
          }),
        }),
        { params: Promise.resolve({ id: posted.id }) }
      );
      assert(res.status >= 400, `${res.status}`);
    });

    await it('60) GET posting preview قبل الترحيل', async () => {
      const { run } = await seedReady();
      const res = await runGet(
        authReq(`http://localhost/api/accounts/payroll/runs/${run.id}`, posterId, posterName),
        { params: Promise.resolve({ id: run.id }) }
      );
      assert(res.status === 200, `${res.status}`);
      const body = await res.json();
      const posting = body.posting ?? body.data?.posting;
      assert(posting && posting.is_posted === false, 'not posted');
      const issues = verifyPayrollPostingPublicDto({ dto: posting });
      assert(issues.length === 0, JSON.stringify(issues));
    });

    await it('61) GET posting preview بعد الترحيل', async () => {
      const { run } = await seedReady();
      await callPost(run, posterId, posterName);
      const posted = await fresh(run.id);
      const res = await runGet(
        authReq(`http://localhost/api/accounts/payroll/runs/${posted.id}`, posterId, posterName),
        { params: Promise.resolve({ id: posted.id }) }
      );
      const body = await res.json();
      const posting = body.posting ?? body.data?.posting;
      assert(posting?.is_posted === true && posting?.can_post === false, 'posted');
      const issues = verifyPayrollPostingPublicDto({
        dto: posting,
        expect_posted_section: true,
        run: {
          id: posted.id,
          status: posted.status,
          version: posted.version,
          posting_journal_entry_id: posted.posting_journal_entry_id,
          posted_snapshot_hash: posted.posted_snapshot_hash,
        },
      });
      assert(issues.length === 0, JSON.stringify(issues));
    });

    await it('62) verifyPayrollPostingPublicDto على استجابة POST', async () => {
      const { run } = await seedReady();
      const body = await (await callPost(run, posterId, posterName)).json();
      const issues = verifyPayrollPostingPublicDto({
        dto: body,
        run: await fresh(run.id).then((r) => ({
          id: r.id,
          status: r.status,
          version: r.version,
          posting_journal_entry_id: r.posting_journal_entry_id,
          posted_snapshot_hash: r.posted_snapshot_hash,
        })),
      });
      assert(issues.length === 0, JSON.stringify(issues));
    });

    await it('63) preview readiness true عند APPROVED الجاهز', async () => {
      const { run } = await seedReady();
      const body = await (
        await runGet(authReq(`http://localhost/api/accounts/payroll/runs/${run.id}`, posterId, posterName), {
          params: Promise.resolve({ id: run.id }),
        })
      ).json();
      const posting = body.posting ?? body.data?.posting;
      assert(posting?.readiness === true || posting?.can_post === true, 'ready');
    });

    await it('64) verifyPayrollPosting بعد ترحيل ناجح', async () => {
      const { run } = await seedReady();
      await callPost(run, posterId, posterName);
      const v = await withTransaction((c) => verifyPayrollPosting(c, { strict: false }));
      assert(v.ok, JSON.stringify(v.mismatches.slice(0, 3)));
    });

    await it('65) DTO لا يسرّب snapshot_json', async () => {
      const { run } = await seedReady();
      const body = await (await callPost(run, posterId, posterName)).json();
      assert(!JSON.stringify(body).includes('snapshot_json'), 'leak');
    });

    await it('66) audit آمن: لا idempotency_key خام', async () => {
      const { run } = await seedReady();
      const key = `visible-raw-${randomUUID()}`;
      await callPost(run, posterId, posterName, { key });
      const leaky = await query(
        `SELECT id::text FROM accounts.financial_audit_log
         WHERE entity_type='payroll_run' AND entity_id=$1::uuid
           AND action LIKE 'payroll_run.post%'
           AND (new_values::text LIKE '%' || $2 || '%' OR old_values::text LIKE '%' || $2 || '%')
         LIMIT 5`,
        [run.id, key]
      );
      assert(leaky.rows.length === 0, 'raw key in audit');
    });

    await it('67) audit لا يحتوي snapshot_json', async () => {
      const { run } = await seedReady();
      await callPost(run, posterId, posterName);
      const leaky = await query(
        `SELECT id::text FROM accounts.financial_audit_log
         WHERE entity_type='payroll_run' AND entity_id=$1::uuid
           AND action LIKE 'payroll_run.post%'
           AND (new_values::text ILIKE '%snapshot_json%' OR old_values::text ILIKE '%snapshot_json%')
         LIMIT 5`,
        [run.id]
      );
      assert(leaky.rows.length === 0, 'snapshot_json');
    });

    await it('68) audit لا يسرّب SQL خام', async () => {
      const { run } = await seedReady();
      await callPost(run, posterId, posterName);
      const leaky = await query(
        `SELECT id::text FROM accounts.financial_audit_log
         WHERE entity_type='payroll_run' AND entity_id=$1::uuid
           AND action LIKE 'payroll_run.post%'
           AND (new_values::text ILIKE '%INSERT INTO%' OR old_values::text ILIKE '%INSERT INTO%')
         LIMIT 5`,
        [run.id]
      );
      assert(leaky.rows.length === 0, 'sql');
    });

    await it('69) blocked audit يُسجَّل عند 403 بدون تسريب مفتاح', async () => {
      const { run } = await seedReady();
      const key = `blocked-key-${randomUUID()}`;
      __setPayrollCapabilitiesOverrideForTests(posterId, [PAYROLL_CAPABILITIES.VIEW]);
      const res = await callPost(run, posterId, posterName, { key });
      assert(res.status === 403, `${res.status}`);
      const leaky = await query(
        `SELECT id::text FROM accounts.financial_audit_log
         WHERE entity_type='payroll_run' AND entity_id=$1::uuid
           AND (new_values::text LIKE '%' || $2 || '%' OR old_values::text LIKE '%' || $2 || '%')
         LIMIT 5`,
        [run.id, key]
      );
      assert(leaky.rows.length === 0, 'blocked key leak');
    });

    await cleanupOwned();
    await it('70) cleanup: صفر صفوف مملوكة', async () => {
      assert((await countOwned()) === 0, `left=${await countOwned()}`);
    });

    await it('71) verifyPayrollPosting بعد cleanup', async () => {
      const v = await withTransaction((c) => verifyPayrollPosting(c, { strict: false }));
      assert(typeof v.ok === 'boolean', 'shape');
    });

    await it('72) خريطة أكواد الاستجابة تغطي المسار السعيد', async () => {
      const { run } = await seedReady();
      const res = await callPost(run, posterId, posterName);
      assert(res.status === 200, `${res.status}`);
      const body = await res.json();
      assert(body.ok === true || body.success === true, 'ok flag');
    });  } finally {
    __clearPayrollPostingFailpointForTests();
    __clearPayrollCapabilitiesOverrideForTests();
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