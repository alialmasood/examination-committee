/**
 * اختبارات قبول نواة ترحيل الرواتب 9.C.1.
 * npm run test:payroll-posting-core
 *
 * لا تستدعي API للترحيل: postPayrollRunCore داخل withTransaction فقط.
 */
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { generateAccessToken } from '../lib/auth';
import { AccountsHttpError } from '../lib/accounts/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import { createPayrollAccountMapping } from '../lib/accounts/payroll-account-mappings';
import { createPayrollCalendar } from '../lib/accounts/payroll-calendars';
import { createPayrollComponent } from '../lib/accounts/payroll-components';
import { createPayrollComponentAssignment } from '../lib/accounts/payroll-component-assignments';
import { createPayrollContract, transitionPayrollContract } from '../lib/accounts/payroll-contracts';
import { createPayrollPerson } from '../lib/accounts/payroll-people';
import { createPayrollPeriod } from '../lib/accounts/payroll-periods';
import { postPayrollRunCore } from '../lib/accounts/payroll-posting-core';
import {
  __clearPayrollPostingFailpointForTests,
  __setPayrollPostingFailpointForTests,
} from '../lib/accounts/payroll-posting-failpoints';
import { PAYROLL_POSTING_ROUNDING_THRESHOLD_IQD } from '../lib/accounts/payroll-posting-idempotency';
import { loadPayrollRun, createPayrollRun } from '../lib/accounts/payroll-runs';
import { addScopeMember } from '../lib/accounts/payroll-run-scope';
import { verifyPayrollPosting } from '../lib/accounts/verify-payroll-posting';
import { withTransaction } from '../lib/accounts/with-transaction';
import { POST as calculatePost } from '../../app/api/accounts/payroll/runs/[id]/calculate/route';
import { POST as submitReviewPost } from '../../app/api/accounts/payroll/runs/[id]/submit-review/route';
import { POST as approvePost } from '../../app/api/accounts/payroll/runs/[id]/approve/route';
import { POST as cancelPost } from '../../app/api/accounts/payroll/runs/[id]/cancel/route';

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
function statusOf(error: unknown) {
  return error instanceof AccountsHttpError ? error.status : 0;
}
async function it(name: string, test: () => Promise<void>) {
  try {
    await test();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed += 1;
    process.exitCode = 1;
    console.error(`❌ ${name}`, error instanceof Error ? error.message : error);
  } finally {
    __clearPayrollPostingFailpointForTests();
  }
}
async function expectStatus(status: number, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    assert(statusOf(error) === status, `expected ${status}, got ${statusOf(error)}`);
    return;
  }
  throw new Error(`expected error ${status}`);
}

async function cleanupOwned() {
  if (owned.runIds.length) {
    await query(`DELETE FROM accounts.financial_audit_log WHERE entity_type='payroll_run' AND entity_id=ANY($1::uuid[])`, [owned.runIds]);
    // 1) صفّر حقول POSTED وخفّض الحالة قبل حذف سجل الترحيل/القيد
    await query(`UPDATE accounts.payroll_runs SET
      status = CASE WHEN status = 'POSTED' THEN 'APPROVED' ELSE status END,
      posted_at = NULL, posted_by = NULL, posting_journal_entry_id = NULL, posted_snapshot_hash = NULL
      WHERE id=ANY($1::uuid[])`, [owned.runIds]);
    await query(`DELETE FROM accounts.payroll_run_postings WHERE payroll_run_id=ANY($1::uuid[])`, [owned.runIds]);
    await query(`DELETE FROM accounts.journal_entry_lines WHERE journal_entry_id IN (
      SELECT id FROM accounts.journal_entries WHERE source_type='PAYROLL_RUN' AND source_id=ANY($1::uuid[])
    )`, [owned.runIds]);
    await query(`DELETE FROM accounts.journal_entries WHERE source_type='PAYROLL_RUN' AND source_id=ANY($1::uuid[])`, [owned.runIds]);
    await query(`DELETE FROM accounts.payroll_run_approval_actions WHERE payroll_run_id=ANY($1::uuid[])`, [owned.runIds]);
    await query(`DELETE FROM accounts.payroll_run_issues WHERE payroll_run_id=ANY($1::uuid[])`, [owned.runIds]);
    await query(`DELETE FROM accounts.payroll_run_lines WHERE payroll_run_id=ANY($1::uuid[])`, [owned.runIds]);
    await query(`DELETE FROM accounts.payroll_run_people WHERE payroll_run_id=ANY($1::uuid[])`, [owned.runIds]);
    await query(`DELETE FROM accounts.payroll_run_scope_members WHERE payroll_run_id=ANY($1::uuid[])`, [owned.runIds]);
    await query(`DELETE FROM accounts.payroll_runs WHERE id=ANY($1::uuid[])`, [owned.runIds]);
  }
  if (owned.mappingIds.length) await query(`DELETE FROM accounts.payroll_account_mappings WHERE id=ANY($1::uuid[])`, [owned.mappingIds]);
  if (owned.assignmentIds.length) await query(`DELETE FROM accounts.payroll_component_assignments WHERE id=ANY($1::uuid[])`, [owned.assignmentIds]);
  if (owned.contractIds.length) await query(`DELETE FROM accounts.payroll_contracts WHERE id=ANY($1::uuid[])`, [owned.contractIds]);
  if (owned.personIds.length) await query(`DELETE FROM accounts.payroll_people WHERE id=ANY($1::uuid[])`, [owned.personIds]);
  if (owned.componentIds.length) await query(`DELETE FROM accounts.payroll_components WHERE id=ANY($1::uuid[])`, [owned.componentIds]);
  if (owned.periodIds.length) await query(`DELETE FROM accounts.payroll_periods WHERE id=ANY($1::uuid[])`, [owned.periodIds]);
  if (owned.calendarIds.length) await query(`DELETE FROM accounts.payroll_calendars WHERE id=ANY($1::uuid[])`, [owned.calendarIds]);
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
    [owned.calendarIds, owned.periodIds, owned.runIds, owned.personIds, owned.componentIds, owned.mappingIds]
  );
  return Number(r.rows[0].n);
}
function authReq(url: string, userId: string, username: string, body: object) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { cookie: `access_token=${generateAccessToken(userId, username)}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function upsertAdmin(username: string) {
  const r = await query(
    `INSERT INTO student_affairs.users (username,email,full_name,password_hash,is_active)
     VALUES ($1,$2,$3,$4,TRUE)
     ON CONFLICT (username) DO UPDATE SET is_active=TRUE
     RETURNING id`,
    [username, `${username}@test.local`, `اختبار ${username}`, await bcrypt.hash('payroll-posting-test', 8)]
  );
  const id = r.rows[0].id as string;
  await query(`INSERT INTO student_affairs.user_systems (user_id,system_id)
    SELECT $1::uuid,id FROM student_affairs.systems WHERE code='ACCOUNTS'
    ON CONFLICT DO NOTHING`, [id]);
  await grantAccountsAdminRole(id);
  return id;
}

type Run = Awaited<ReturnType<typeof loadPayrollRun>>;
type Accounts = { expense: string; liability: string; payable: string; rounding: string };

async function main() {
  console.log('===== اختبارات قبول نواة ترحيل الرواتب 9.C.1 =====');
  const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  let seq = 0;
  const code = (prefix: string) => `${prefix}-${suffix}-${++seq}`;
  const submitterName = `test-post-submit-${suffix}`;
  const approverName = `test-post-approve-${suffix}`;
  const submitterId = await upsertAdmin(submitterName);
  const approverId = await upsertAdmin(approverName);

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
  if (!fiscal.rows[0]) throw new Error('إعداد متجاوز: لا توجد فترة مالية OPEN ضمن سنة ACTIVE');
  if (!expense || liabilities.length < 1) {
    throw new Error('إعداد متجاوز: يلزم حساب ترحيل EXPENSE وحساب LIABILITY فعّالان وغير تجميعيين');
  }
  const gl: Accounts = {
    expense,
    liability: liabilities[0],
    payable: liabilities[1] ?? liabilities[0],
    rounding: liabilities[2] ?? liabilities[0],
  };
  const fiscalContext = fiscal.rows[0] as { fiscal_period_id: string; fiscal_year_id: string; start_date: string; end_date: string };
  const from = fiscalContext.start_date.slice(0, 10);
  const to = fiscalContext.end_date.slice(0, 10);

  const post = (
    run: Run,
    key: string = randomUUID(),
    overrides: Partial<Record<string, unknown>> = {}
  ) =>
    withTransaction((client) => postPayrollRunCore(client, {
      runId: run.id, userId: approverId, version: run.version, updated_at: iso(run.updated_at),
      idempotency_key: key, posting_date: from, confirmation: true, ...overrides,
    }));
  const fresh = (id: string) => withTransaction((c) => loadPayrollRun(c, id));

  async function seedReady(opts: { missingExpense?: boolean; currency?: string } = {}) {
    const calendar = await withTransaction((c) => createPayrollCalendar(c, {
      code: code('P9CAL'), name_ar: 'تقويم اختبار ترحيل', calendar_type: 'MONTHLY',
      currency_code: opts.currency ?? 'IQD', effective_from: from, created_by: submitterId,
    }));
    owned.calendarIds.push(calendar.id);
    const period = await withTransaction((c) => createPayrollPeriod(c, {
      payroll_calendar_id: calendar.id, name_ar: 'فترة اختبار ترحيل', start_date: from, end_date: to,
      fiscal_year_id: fiscalContext.fiscal_year_id, fiscal_period_id: fiscalContext.fiscal_period_id, created_by: submitterId,
    }));
    owned.periodIds.push(period.id);
    const person = await withTransaction((c) => createPayrollPerson(c, {
      full_name_ar: 'موظف اختبار ترحيل', person_type: 'EMPLOYEE', default_currency_code: opts.currency ?? 'IQD',
      effective_from: from, created_by: submitterId,
    }));
    owned.personIds.push(person.id);
    const contract = await withTransaction(async (c) => {
      const draft = await createPayrollContract(c, {
        payroll_person_id: person.id, compensation_basis: 'MONTHLY_FIXED', base_amount: '100000',
        currency_code: opts.currency ?? 'IQD', effective_from: from, created_by: submitterId,
      });
      owned.contractIds.push(draft.id);
      return transitionPayrollContract(c, { id: draft.id, userId: submitterId, version: draft.version, updated_at: draft.updated_at, action: 'activate' });
    });
    const component = async (type: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION', amount: string, name: string) => {
      const x = await withTransaction((c) => createPayrollComponent(c, {
        component_code: code(`P9${type.slice(0, 3)}`), name_ar: name, component_type: type,
        calculation_method: 'FIXED_AMOUNT', calculation_base_type: 'NONE', default_amount: amount,
        expense_account_id: opts.missingExpense && type === 'EARNING' ? undefined : gl.expense,
        liability_account_id: type === 'EARNING' ? undefined : gl.liability,
        effective_from: from, created_by: submitterId,
      }));
      owned.componentIds.push(x.id);
      const assignment = await withTransaction((c) => createPayrollComponentAssignment(c, {
        payroll_person_id: person.id, payroll_component_id: x.id, payroll_contract_id: contract.id,
        amount, effective_from: from, created_by: submitterId,
      }));
      owned.assignmentIds.push(assignment.id);
    };
    await component('EARNING', '10000', 'بدل استحقاق');
    await component('DEDUCTION', '1000', 'استقطاع اختبار');
    await component('EMPLOYER_CONTRIBUTION', '500', 'مساهمة صاحب العمل');
    const mapping = await withTransaction((c) => createPayrollAccountMapping(c, {
      mapping_code: code('P9DEF'), mapping_scope: 'DEFAULT', payable_account_id: gl.payable,
      rounding_account_id: gl.rounding, priority: 10000 + seq, effective_from: from, created_by: submitterId,
    }));
    owned.mappingIds.push(mapping.id);
    let run = await withTransaction((c) => createPayrollRun(c, {
      payroll_period_id: period.id, run_type: 'REGULAR', scope_type: 'PERSON_LIST', created_by: submitterId,
    }));
    owned.runIds.push(run.id);
    run = (await withTransaction(async (c) => (await addScopeMember(c, {
      runId: run.id, personId: person.id, userId: submitterId, version: run.version, updated_at: run.updated_at,
    })).run));
    const calc = await calculatePost(authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/calculate`, submitterId, submitterName, {
      confirmation: true, version: run.version, updated_at: iso(run.updated_at), idempotency_key: randomUUID(),
    }), { params: Promise.resolve({ id: run.id }) });
    assert(calc.status === 200, `calculate ${calc.status}`);
    run = await fresh(run.id);
    const review = await submitReviewPost(authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/submit-review`, submitterId, submitterName, {
      confirmation: true, version: run.version, updated_at: iso(run.updated_at), idempotency_key: randomUUID(),
    }), { params: Promise.resolve({ id: run.id }) });
    assert(review.status === 200, `submit ${review.status}`);
    run = await fresh(run.id);
    const approve = await approvePost(authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/approve`, approverId, approverName, {
      confirmation: true, version: run.version, updated_at: iso(run.updated_at), idempotency_key: randomUUID(),
    }), { params: Promise.resolve({ id: run.id }) });
    assert(approve.status === 200, `approve ${approve.status}`);
    return { run: await fresh(run.id), period };
  }

  try {
    await it('1) migration: جدول وأعمدة ترحيل 098 موجودة', async () => {
      const r = await query(`SELECT column_name FROM information_schema.columns WHERE table_schema='accounts'
        AND table_name IN ('payroll_runs','payroll_run_postings')`);
      const cols = new Set(r.rows.map((x) => x.column_name));
      for (const col of ['posted_at', 'posted_by', 'posting_journal_entry_id', 'request_key_hash', 'journal_entry_id']) assert(cols.has(col), col);
    });
    await it('2) ثابت حد التقريب هو 1.000', async () => assert(PAYROLL_POSTING_ROUNDING_THRESHOLD_IQD === '1.000', 'threshold'));
    await it('3) happy path: APPROVED إلى POSTED وقيد SALARY', async () => {
      const { run } = await seedReady();
      const result = await post(run);
      assert(!result.replayed && result.run.status === 'POSTED', 'posted');
      const j = await query(`SELECT entry_type,status,source_type,source_id::text FROM accounts.journal_entries WHERE id=$1::uuid`, [result.posting.journal_entry_id]);
      assert(j.rows[0]?.entry_type === 'SALARY' && j.rows[0]?.status === 'POSTED', 'journal SALARY POSTED');
      assert(j.rows[0]?.source_type === 'PAYROLL_RUN' && j.rows[0]?.source_id === run.id, 'journal source');
    });
    await it('4) القيد متوازن (Debit = Credit)', async () => {
      const { run } = await seedReady(); const x = await post(run);
      assert(x.posting.total_debit === x.posting.total_credit, `${x.posting.total_debit}/${x.posting.total_credit}`);
    });
    await it('5) مساهمة رب العمل تنشئ سطر مصروف وسطر التزام', async () => {
      const { run } = await seedReady(); const x = await post(run);
      const r = await query(`SELECT debit_amount::text,credit_amount::text FROM accounts.journal_entry_lines WHERE journal_entry_id=$1::uuid AND account_id=ANY($2::uuid[])`, [x.posting.journal_entry_id, [gl.expense, gl.liability]]);
      assert(r.rows.some((l) => Number(l.debit_amount) > 0) && r.rows.some((l) => Number(l.credit_amount) > 0), 'employer debit/credit');
    });
    await it('6) الاستقطاع يقيد حساب الالتزام دائناً', async () => {
      const { run } = await seedReady(); const x = await post(run);
      const r = await query(`SELECT COALESCE(SUM(credit_amount),0)::text n FROM accounts.journal_entry_lines WHERE journal_entry_id=$1::uuid AND account_id=$2::uuid`, [x.posting.journal_entry_id, gl.liability]);
      assert(Number(r.rows[0].n) >= 1000, 'deduction credit');
    });
    await it('7) صافي الراتب يقيد حساب payable دائناً', async () => {
      const { run } = await seedReady(); const x = await post(run);
      const r = await query(`SELECT COALESCE(SUM(credit_amount),0)::text n FROM accounts.journal_entry_lines
        WHERE journal_entry_id=$1::uuid AND description LIKE '%صافي الرواتب المستحقة%'`, [x.posting.journal_entry_id]);
      assert(Number(r.rows[0].n) >= 9000, 'net payable');
    });
    await it('8) replay بنفس المفتاح: قيد واحد والنسخة ثابتة', async () => {
      const { run } = await seedReady(); const key = randomUUID(); const first = await post(run, key); const second = await post(run, key);
      assert(second.replayed && second.run.version === first.run.version, 'replay/version');
      const r = await query(`SELECT COUNT(*)::int n FROM accounts.payroll_run_postings WHERE payroll_run_id=$1::uuid`, [run.id]);
      assert(Number(r.rows[0].n) === 1, 'one posting');
    });
    await it('9) نفس المفتاح مع payload مختلف يسبب 409', async () => {
      const { run } = await seedReady(); const key = randomUUID(); await post(run, key);
      await expectStatus(409, () => post(run, key, { comment: 'حمولة مختلفة' }));
    });
    await it('10) النسخة المتقادمة تسبب 409', async () => {
      const { run } = await seedReady();
      await expectStatus(409, () => post(run, randomUUID(), { version: run.version - 1 }));
    });
    await it('11) تشغيل غير APPROVED يسبب 409', async () => {
      const { run } = await seedReady();
      await post(run);
      const posted = await fresh(run.id);
      await expectStatus(409, () => post(posted));
    });
    await it('12) failpoint بعد رأس القيد يتراجع كلياً', async () => {
      const { run } = await seedReady(); __setPayrollPostingFailpointForTests('post_after_journal_header');
      await expectStatus(0, () => post(run));
      const r = await fresh(run.id); const n = await query(`SELECT COUNT(*)::int n FROM accounts.payroll_run_postings WHERE payroll_run_id=$1::uuid`, [run.id]);
      assert(r.status === 'APPROVED' && Number(n.rows[0].n) === 0, 'rollback');
    });
    await it('13) failpoint بعد sequence يتراجع كلياً', async () => {
      const { run } = await seedReady(); __setPayrollPostingFailpointForTests('post_after_document_sequence');
      await expectStatus(0, () => post(run));
      const r = await query(`SELECT COUNT(*)::int n FROM accounts.journal_entries WHERE source_type='PAYROLL_RUN' AND source_id=$1::uuid`, [run.id]);
      assert(Number(r.rows[0].n) === 0 && (await fresh(run.id)).status === 'APPROVED', 'rollback');
    });
    await it('14) نقص حساب المصروف يسبب 422', async () => {
      const { run } = await seedReady({ missingExpense: true });
      await expectStatus(422, () => post(run));
    });
    await it('15) عملة غير IQD مرفوضة بـ422', async () => {
      const { run } = await seedReady(); await query(`UPDATE accounts.payroll_runs SET currency_code='USD' WHERE id=$1::uuid`, [run.id]);
      const usd = await fresh(run.id);
      await expectStatus(422, () => post(usd));
    });
    await it('16) verifyPayrollPosting سليم بعد الترحيل', async () => {
      const { run } = await seedReady(); await post(run);
      const v = await withTransaction((c) => verifyPayrollPosting(c, { strict: true }));
      const related = v.mismatches.filter((m) => m.entity_id === run.id);
      assert(related.length === 0, JSON.stringify(related));
    });
    await it('17) Post×Post متزامن: نجاح واحد وتعـارض/Replay واحد', async () => {
      const { run } = await seedReady();
      const r = await Promise.allSettled([post(run, randomUUID()), post(run, randomUUID())]);
      const ok = r.filter((x) => x.status === 'fulfilled').length;
      const conflicts = r.filter((x) => x.status === 'rejected' && statusOf((x as PromiseRejectedResult).reason) === 409).length;
      assert(ok === 1 && conflicts === 1, `ok=${ok}, conflicts=${conflicts}`);
    });
    await it('18) تدقيق النجاح لا يحفظ idempotency_key الخام', async () => {
      const { run } = await seedReady(); const key = `visible-${randomUUID()}`; await post(run, key);
      const r = await query(`SELECT new_values FROM accounts.financial_audit_log WHERE entity_type='payroll_run' AND entity_id=$1::uuid AND action='payroll_run.posted' ORDER BY created_at DESC LIMIT 1`, [run.id]);
      assert(!JSON.stringify(r.rows[0]?.new_values).includes(key), 'raw key leaked');
    });
    await it('19) posting_date مطلوب', async () => {
      const { run } = await seedReady();
      await expectStatus(400, () => post(run, randomUUID(), { posting_date: '' }));
    });
    await it('20) الفترة المالية المغلقة ترفض الترحيل ثم تستعاد', async () => {
      const { run } = await seedReady();
      await query(`UPDATE accounts.fiscal_periods SET status='CLOSED' WHERE id=$1::uuid`, [fiscalContext.fiscal_period_id]);
      try { await expectStatus(409, () => post(run)); } finally {
        await query(`UPDATE accounts.fiscal_periods SET status='OPEN' WHERE id=$1::uuid`, [fiscalContext.fiscal_period_id]);
      }
    });
    await it('21) POSTED يمنع cancelPayrollRun', async () => {
      const { run } = await seedReady(); const result = await post(run);
      const response = await cancelPost(authReq(`http://localhost/api/accounts/payroll/runs/${run.id}/cancel`, submitterId, submitterName, {
        version: result.run.version, updated_at: iso(result.run.updated_at), reason: 'محاولة إلغاء بعد الترحيل',
      }), { params: Promise.resolve({ id: run.id }) });
      assert(response.status === 409, `cancel ${response.status}`);
    });
    await it('22) فهرس request_key_hash الفريد موجود', async () => {
      const r = await query(`SELECT 1 FROM pg_indexes WHERE schemaname='accounts' AND indexname='uq_payroll_run_postings_request_key'`);
      assert(r.rows.length === 1, 'missing unique key index');
    });
    await it('23) confirmation غير المؤكد يرفض 400', async () => {
      const { run } = await seedReady();
      await expectStatus(400, () => post(run, randomUUID(), { confirmation: false }));
    });
    await it('24) updated_at متقادم يرفض 409', async () => {
      const { run } = await seedReady();
      await expectStatus(409, () => post(run, randomUUID(), { updated_at: '2000-01-01T00:00:00.000Z' }));
    });
    await it('25) POSTED يحتفظ بسجل ترحيل واحد وبصمة مطابقة', async () => {
      const { run } = await seedReady(); await post(run);
      const r = await query(`SELECT p.snapshot_hash=p.approved_snapshot_hash ok, p.version_after=p.version_before+1 version_ok
        FROM accounts.payroll_run_postings p WHERE p.payroll_run_id=$1::uuid`, [run.id]);
      assert(r.rows.length === 1 && r.rows[0].ok && r.rows[0].version_ok, 'posting invariants');
    });
  } finally {
    __clearPayrollPostingFailpointForTests();
    await cleanupOwned();
    await it('26) cleanup: لا صفوف مملوكة متبقية', async () => assert((await countOwned()) === 0, `left=${await countOwned()}`));
    console.log(`===== النتيجة: ${passed} ناجح / ${failed} فاشل =====`);
    await closePool();
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  __clearPayrollPostingFailpointForTests();
  try { await cleanupOwned(); } finally { await closePool(); }
});
