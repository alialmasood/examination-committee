/**
 * اختبارات قبول Student Billing & Collections (5.B).
 * npm run test:student-billing-collections
 */
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import bcrypt from 'bcrypt';
import { closePool, query } from '../lib/db';
import { AccountsHttpError, requireAccountsAccess } from '../lib/accounts/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import { assignBankAccountUser } from '../lib/accounts/bank-accounts';
import {
  activateCashBox,
  createCashBox,
} from '../lib/accounts/cash-boxes';
import { assignPrimaryCustodian } from '../lib/accounts/cash-box-custodians';
import { openCashSession } from '../lib/accounts/cash-box-sessions';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import {
  moneyEquals,
  moneyIsPositive,
  moneyToMillis,
  normalizeMoneyInput,
  sumMoney,
} from '../lib/accounts/money';
import {
  activateStudentBillingPlan,
  createStudentBillingPlan,
  generateEqualInstallments,
  getStudentBillingPlan,
  updateStudentBillingPlan,
} from '../lib/accounts/student-billing-plans';
import {
  createStudentAccount,
  loadStudentAccount,
  suspendStudentAccount,
} from '../lib/accounts/student-accounts';
import {
  createStudentCollection,
  loadStudentCollection,
  postStudentCollection,
  previewAutoAllocation,
  replaceAllocations,
  voidStudentCollection,
} from '../lib/accounts/student-collections';
import { createStudentFeeType } from '../lib/accounts/student-fee-types';
import {
  ACCOUNTS_CLERK_ROLE_CODE,
  ACCOUNTS_VIEWER_ROLE_CODE,
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
  grantAccountsPlatformRole,
  hasStudentReceivablesCapability,
} from '../lib/accounts/student-receivables-access';
import { verifyStudentReceivables } from '../lib/accounts/verify-student-receivables';
import {
  acquireBanksLock,
  acquireCashBoxesLock,
  acquireJournalEntriesLock,
  withTransaction,
} from '../lib/accounts/with-transaction';

let passCount = 0;
let failCount = 0;

function ok(name: string) {
  passCount += 1;
  console.log(`✅ ${name}`);
}
function fail(name: string, err?: unknown) {
  failCount += 1;
  console.error(`❌ ${name}`, err ?? '');
  process.exitCode = 1;
}

async function expectHttp(
  name: string,
  fn: () => Promise<unknown>,
  status: number,
  includes?: string
) {
  try {
    await fn();
    fail(name, `توقّعنا خطأ ${status} ولم يحدث`);
  } catch (e) {
    if (e instanceof AccountsHttpError && e.status === status) {
      if (includes && !e.message.includes(includes)) {
        fail(name, `الرسالة لا تحتوي "${includes}": ${e.message}`);
        return;
      }
      ok(name);
      return;
    }
    fail(name, e);
  }
}

async function ensureTypedAccount(
  code: string,
  nameAr: string,
  typeCode: 'ASSET' | 'REVENUE',
  userId: string
): Promise<string> {
  const existing = await query(
    `SELECT id FROM accounts.chart_of_accounts WHERE LOWER(code)=LOWER($1)`,
    [code]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;
  const type = await query(
    `SELECT id, normal_balance FROM accounts.account_types WHERE code=$1`,
    [typeCode]
  );
  if (!type.rows[0]) throw new Error(`نوع حساب ${typeCode} غير موجود`);
  const sort = await query(
    `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'اختبار 5.B')
     RETURNING id`,
    [
      code,
      nameAr,
      type.rows[0].id,
      type.rows[0].normal_balance,
      sort.rows[0].n,
      userId,
    ]
  );
  return ins.rows[0].id as string;
}

async function insertTestStudent(
  suffix: string,
  label: string,
  status = 'active'
): Promise<string> {
  const uni = `DB${suffix}${label}`.slice(0, 20);
  const ins = await query(
    `INSERT INTO student_affairs.students
       (university_id, student_number, full_name_ar, status, payment_status)
     VALUES ($1, $2, $3, $4, 'paid')
     RETURNING id`,
    [uni, uni, `طالب 5.B ${label} ${suffix}`, status]
  );
  return ins.rows[0].id as string;
}

async function upsertCapabilityTestUser(username: string): Promise<string> {
  const hash = await bcrypt.hash('test-5b-pass', 10);
  const res = await query(
    `INSERT INTO student_affairs.users (username, email, full_name, password_hash, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       is_active = TRUE
     RETURNING id`,
    [username, `${username}@test.local`, `اختبار ${username}`, hash]
  );
  const userId = res.rows[0].id as string;
  await query(
    `INSERT INTO student_affairs.user_systems (user_id, system_id)
     SELECT $1::uuid, s.id
     FROM student_affairs.systems s
     WHERE s.code = 'ACCOUNTS'
     ON CONFLICT (user_id, system_id) DO NOTHING`,
    [userId]
  );
  return userId;
}

async function resolveOpenChargeDate(): Promise<{
  chargeDate: string;
  yearId: string;
  periodId: string;
}> {
  const period = await query(
    `SELECT y.id AS year_id, p.id AS period_id,
            p.start_date::text AS start_date, p.end_date::text AS end_date
     FROM accounts.fiscal_years y
     JOIN accounts.fiscal_periods p ON p.fiscal_year_id = y.id
     WHERE y.status = 'ACTIVE' AND p.status = 'OPEN'
     ORDER BY y.is_default DESC, p.start_date
     LIMIT 1`
  );
  if (!period.rows[0]) {
    throw new Error('لا توجد فترة مالية OPEN');
  }
  const start = pgDateOnly(period.rows[0].start_date as string);
  const chargeDate =
    start.slice(0, 7) === '2026-01' ? '2026-01-15' : start;
  return {
    chargeDate,
    yearId: period.rows[0].year_id as string,
    periodId: period.rows[0].period_id as string,
  };
}

async function resolveCashContext(params: {
  userId: string;
  suffix: string;
  yearId: string;
  periodId: string;
  sessionDate: string;
}): Promise<{ boxId: string; sessionId: string; cashGlId: string }> {
  // حساب نقدي مخصص للاختبار — لا يُعاد استخدام ذمم الطلبة (1131 / DEMO-RECV*)
  const cashGlId = await ensureTypedAccount(
    `DEMO-CASH-5B-${params.suffix}`,
    `نقد تحصيل 5.B ${params.suffix}`,
    'ASSET',
    params.userId
  );

  const box = await withTransaction(async (client) => {
    await acquireCashBoxesLock(client);
    const created = await createCashBox(client, {
      code: `SCL-T-${params.suffix}`,
      name_ar: `صندوق تحصيل ${params.suffix}`,
      box_type_code: 'MAIN',
      account_id: cashGlId,
      created_by: params.userId,
    });
    await assignPrimaryCustodian(client, {
      cashBoxId: created.id,
      userId: params.userId,
      createdBy: params.userId,
    });
    return activateCashBox(client, created.id, {
      version: created.version,
      updated_at: created.updated_at,
      activated_by: params.userId,
    });
  });

  const session = await withTransaction(async (client) => {
    await acquireCashBoxesLock(client);
    return openCashSession(client, {
      cash_box_id: box.id,
      fiscal_year_id: params.yearId,
      fiscal_period_id: params.periodId,
      session_date: params.sessionDate,
      opened_by: params.userId,
      notes: `5.B test ${params.suffix}`,
    });
  });

  return { boxId: box.id, sessionId: session.id, cashGlId };
}

async function resolveBankAccountId(userId: string): Promise<string> {
  const demo = await query(
    `SELECT id FROM accounts.bank_accounts WHERE LOWER(code) = LOWER('DEMO-BA-IQD') LIMIT 1`
  );
  if (demo.rows[0]) {
    const bankAccountId = demo.rows[0].id as string;
    try {
      await withTransaction(async (client) => {
        await acquireBanksLock(client);
        return assignBankAccountUser(client, {
          bank_account_id: bankAccountId,
          user_id: userId,
          can_view: true,
          can_prepare: true,
          can_post: true,
          can_reconcile: true,
          created_by: userId,
        });
      });
    } catch {
      /* موجود */
    }
    return bankAccountId;
  }

  const any = await query(
    `SELECT id FROM accounts.bank_accounts
     WHERE currency_code = 'IQD' AND status = 'ACTIVE'
     ORDER BY created_at LIMIT 1`
  );
  if (!any.rows[0]) throw new Error('لا حساب بنكي IQD للاختبار');
  return any.rows[0].id as string;
}

async function main() {
  console.log('===== اختبارات قبول Student Billing & Collections 5.B =====');

  {
    const req = new NextRequest('http://localhost/api/accounts/student-collections');
    const a = await requireAccountsAccess(req);
    if ('response' in a && a.response.status === 401) ok('01) API 401 بدون توكن (collections)');
    else fail('01) API 401 collections', a);
  }
  {
    const req = new NextRequest('http://localhost/api/accounts/student-billing-plans');
    const a = await requireAccountsAccess(req);
    if ('response' in a && a.response.status === 401) ok('02) API 401 بدون توكن (billing-plans)');
    else fail('02) API 401 billing-plans', a);
  }

  const user = await query(
    `SELECT id FROM student_affairs.users WHERE is_active = TRUE ORDER BY created_at NULLS LAST LIMIT 1`
  );
  if (!user.rows[0]) {
    fail('لا يوجد مستخدم نشط');
    return;
  }
  const userId = user.rows[0].id as string;
  await grantAccountsAdminRole(userId);

  let fiscal: { chargeDate: string; yearId: string; periodId: string };
  try {
    fiscal = await resolveOpenChargeDate();
    ok(`03) تاريخ فترة مفتوحة: ${fiscal.chargeDate}`);
  } catch (e) {
    fail('03) فترة مالية مفتوحة', e);
    return;
  }

  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  const planTotal = '1000001';
  const installmentCount = 3;

  // ذمم مخصّصة للاختبار — لا تشارك GL مع صناديق نقدية تجريبية
  const recvGl = await ensureTypedAccount(
    `DEMO-RECV-5B-${suffix}`,
    `ذمم 5.B ${suffix}`,
    'ASSET',
    userId
  );
  ok('04) حساب ذمم ASSET جاهز');

  const revGl = await ensureTypedAccount(
    `DEMO-REV-5B-${suffix}`,
    'إيراد 5.B',
    'REVENUE',
    userId
  );

  const studentId = await insertTestStudent(suffix, 'A');
  const studentId2 = await insertTestStudent(suffix, 'B');
  const inactiveStudentId = await insertTestStudent(suffix, 'X', 'suspended');
  ok(`05) طلاب TEST: DB${suffix}*`);

  const account = await withTransaction((client) =>
    createStudentAccount(client, {
      student_id: studentId,
      receivable_gl_account_id: recvGl,
      created_by: userId,
      notes: `5.B ${suffix}`,
    })
  );
  ok(`06) حساب مالي ${account.account_number}`);

  const account2 = await withTransaction((client) =>
    createStudentAccount(client, {
      student_id: studentId2,
      receivable_gl_account_id: recvGl,
      created_by: userId,
    })
  );

  const feeType = await withTransaction((client) =>
    createStudentFeeType(client, {
      code: `FEE_5B_${suffix}`,
      name_ar: `رسم 5.B ${suffix}`,
      category: 'TUITION',
      revenue_gl_account_id: revGl,
      default_amount: '333334',
      created_by: userId,
      is_tuition: true,
    })
  );
  ok(`07) نوع رسم ${feeType.code}`);

  const equalDrafts = generateEqualInstallments(
    planTotal,
    installmentCount,
    fiscal.chargeDate
  );
  const instSum = sumMoney(equalDrafts.map((i) => i.amount));
  if (!moneyEquals(instSum, planTotal)) {
    fail('08) مجموع الأقساط = الإجمالي', { instSum, planTotal });
  } else {
    ok(`08) مجموع الأقساط = ${planTotal}`);
  }
  const lastInst = equalDrafts[equalDrafts.length - 1];
  const baseInst = equalDrafts[0];
  if (
    moneyEquals(lastInst.amount, baseInst.amount) &&
    !moneyEquals(planTotal, normalizeMoneyInput(String(Number(planTotal) / installmentCount)))
  ) {
    fail('09) آخر قسط يحمل فرق التقريب', lastInst);
  } else if (
    moneyToMillis(lastInst.amount) >= moneyToMillis(baseInst.amount)
  ) {
    ok(`09) تقريب: ${baseInst.amount} × ${installmentCount - 1} + ${lastInst.amount}`);
  } else {
    fail('09) تقريب الأقساط', equalDrafts);
  }

  const { plan, installments } = await withTransaction((client) =>
    createStudentBillingPlan(client, {
      student_account_id: account.id,
      fee_type_id: feeType.id,
      total_amount: planTotal,
      installment_count: installmentCount,
      first_due_date: fiscal.chargeDate,
      description: `خطة اختبار ${suffix}`,
      external_reference: `TPL-${suffix}`,
      created_by: userId,
    })
  );
  if (plan.status !== 'DRAFT' || installments.length !== installmentCount) {
    fail('10) إنشاء خطة DRAFT', plan);
  } else {
    ok(`10) خطة مسودة ${plan.plan_number} · ${installments.length} أقساط`);
  }

  await expectHttp(
    '11) رفض خطة لطالب غير نشط',
    () =>
      withTransaction(async (client) => {
        const inactiveAcc = await createStudentAccount(client, {
          student_id: inactiveStudentId,
          receivable_gl_account_id: recvGl,
          created_by: userId,
        });
        return createStudentBillingPlan(client, {
          student_account_id: inactiveAcc.id,
          fee_type_id: feeType.id,
          total_amount: '10000',
          installment_count: 1,
          first_due_date: fiscal.chargeDate,
          description: 'يجب أن يرفض',
          created_by: userId,
        });
      }),
    409
  );

  const studentId3 = await insertTestStudent(suffix, 'C');
  const account3 = await withTransaction((client) =>
    createStudentAccount(client, {
      student_id: studentId3,
      receivable_gl_account_id: recvGl,
      created_by: userId,
    })
  );
  const otherPlan = await withTransaction(async (client) =>
    createStudentBillingPlan(client, {
      student_account_id: account3.id,
      fee_type_id: feeType.id,
      total_amount: '30000',
      installment_count: 1,
      first_due_date: fiscal.chargeDate,
      description: `خطة طالب آخر ${suffix}`,
      created_by: userId,
    })
  );
  const otherActive = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return activateStudentBillingPlan(client, {
      id: otherPlan.plan.id,
      userId,
      version: otherPlan.plan.version,
      updated_at: otherPlan.plan.updated_at,
      activation_date: fiscal.chargeDate,
    });
  });
  const otherChargeId = otherActive.installments[0].student_charge_id!;

  {
    const before = await withTransaction((c) => loadStudentAccount(c, account2.id));
    await withTransaction((client) =>
      suspendStudentAccount(client, {
        id: account2.id,
        userId,
        version: before.version,
        updated_at: before.updated_at,
      })
    );
    await expectHttp(
      '12) رفض خطة على حساب معلّق',
      () =>
        withTransaction((client) =>
          createStudentBillingPlan(client, {
            student_account_id: account2.id,
            fee_type_id: feeType.id,
            total_amount: '10000',
            installment_count: 1,
            first_due_date: fiscal.chargeDate,
            description: 'حساب معلّق',
            created_by: userId,
          })
        ),
      409
    );
  }

  const activated = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return activateStudentBillingPlan(client, {
      id: plan.id,
      userId,
      version: plan.version,
      updated_at: plan.updated_at,
      activation_date: fiscal.chargeDate,
    });
  });
  if (activated.plan.status !== 'ACTIVE') {
    fail('13) تفعيل الخطة ACTIVE', activated.plan.status);
  } else {
    ok('13) تفعيل الخطة → ACTIVE');
  }

  const chargeLinks = activated.installments.filter((i) => i.student_charge_id);
  if (chargeLinks.length !== installmentCount) {
    fail('14) مطالبة لكل قسط عند التفعيل', chargeLinks.length);
  } else {
    ok(`14) ${chargeLinks.length} مطالبات POSTED مرتبطة بالأقساط`);
  }

  const charges = await query(
    `SELECT id, status, original_amount::text AS amt, journal_entry_id::text AS je
     FROM accounts.student_charges
     WHERE student_account_id = $1::uuid AND status = 'POSTED'
     ORDER BY created_at`,
    [account.id]
  );
  if (charges.rows.length !== installmentCount) {
    fail('15) عدد مطالبات مرحّلة', charges.rows.length);
  } else {
    ok('15) مطالبات مرحّلة 1:1 مع الأقساط');
  }

  await expectHttp(
    '16) رفض التفعيل المزدوج',
    () =>
      withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        return activateStudentBillingPlan(client, {
          id: activated.plan.id,
          userId,
          version: activated.plan.version,
          updated_at: activated.plan.updated_at,
        });
      }),
    409
  );

  await expectHttp(
    '17) رفض تعديل خطة ACTIVE',
    () =>
      withTransaction((client) =>
        updateStudentBillingPlan(client, {
          id: activated.plan.id,
          userId,
          version: activated.plan.version,
          updated_at: activated.plan.updated_at,
          description: 'تعديل مرفوض',
        })
      ),
    409
  );

  const verifyAfterActivate = await withTransaction((c) =>
    verifyStudentReceivables(c)
  );
  if (
    verifyAfterActivate.orphans.journal_without_ledger.length === 0 &&
    verifyAfterActivate.orphans.ledger_without_journal.length === 0 &&
    verifyAfterActivate.orphans.amount_mismatches.length === 0
  ) {
    ok('18) verify بعد التفعيل — عمليات المطالبات بلا أيتام');
  } else {
    fail('18) verify بعد التفعيل', verifyAfterActivate.orphans);
  }

  const cashCtx = await resolveCashContext({
    userId,
    suffix,
    yearId: fiscal.yearId,
    periodId: fiscal.periodId,
    sessionDate: fiscal.chargeDate,
  });
  ok(`19) جلسة نقد OPEN (${cashCtx.boxId.slice(0, 8)}…)`);

  const bankAccountId = await resolveBankAccountId(userId);
  ok(`20) حساب بنكي ${bankAccountId.slice(0, 8)}…`);

  const inst1 = activated.installments.find((i) => i.installment_number === 1)!;
  const inst2 = activated.installments.find((i) => i.installment_number === 2)!;

  const preview = await withTransaction((client) =>
    previewAutoAllocation(client, account.id, inst1.amount)
  );
  if (
    preview.length >= 1 &&
    moneyEquals(preview[0].allocated_amount, inst1.amount)
  ) {
    ok('21) معاينة التخصيص التلقائي للقسط 1');
  } else {
    fail('21) معاينة auto allocation', preview);
  }

  await expectHttp(
    '22) رفض overpayment في المعاينة',
    () =>
      withTransaction((client) =>
        previewAutoAllocation(client, account.id, '999999999')
      ),
    409
  );

  let draftCollection = await withTransaction(async (client) => {
    const manual = await createStudentCollection(client, {
      student_account_id: account.id,
      collection_date: fiscal.chargeDate,
      amount: inst1.amount,
      payment_method: 'CASH',
      cash_box_id: cashCtx.boxId,
      cash_box_session_id: cashCtx.sessionId,
      description: `تحصيل يدوي ${suffix}`,
      allocations: [
        {
          student_charge_id: inst1.student_charge_id!,
          student_installment_id: inst1.id,
          allocated_amount: inst1.amount,
        },
      ],
      created_by: userId,
    });
    return manual.collection;
  });
  if (draftCollection.status !== 'DRAFT') {
    fail('23) تحصيل DRAFT بتخصيص يدوي', draftCollection.status);
  } else {
    ok(`23) تحصيل DRAFT ${draftCollection.collection_number}`);
  }

  await expectHttp(
    '24) رفض over-allocation',
    () =>
      withTransaction(async (client) =>
        createStudentCollection(client, {
          student_account_id: account.id,
          collection_date: fiscal.chargeDate,
          amount: inst1.amount,
          payment_method: 'CASH',
          cash_box_id: cashCtx.boxId,
          cash_box_session_id: cashCtx.sessionId,
          description: 'تخصيص زائد',
          allocations: [
            {
              student_charge_id: inst1.student_charge_id!,
              student_installment_id: inst1.id,
              allocated_amount: inst1.amount,
            },
            {
              student_charge_id: inst2.student_charge_id!,
              student_installment_id: inst2.id,
              allocated_amount: inst2.amount,
            },
          ],
          created_by: userId,
        })
      ),
    400
  );

  await expectHttp(
    '25) رفض تخصيص مطالبة طالب آخر',
    () =>
      withTransaction(async (client) =>
        createStudentCollection(client, {
          student_account_id: account.id,
          collection_date: fiscal.chargeDate,
          amount: '1000',
          payment_method: 'CASH',
          cash_box_id: cashCtx.boxId,
          cash_box_session_id: cashCtx.sessionId,
          description: 'مطالبة أجنبية',
          allocations: [
            {
              student_charge_id: otherChargeId,
              allocated_amount: '1000',
            },
          ],
          created_by: userId,
        })
      ),
    409
  );

  const postedCash = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return postStudentCollection(client, {
      id: draftCollection.id,
      userId,
      version: draftCollection.version,
      updated_at: draftCollection.updated_at,
    });
  });
  draftCollection = postedCash.collection;
  if (draftCollection.status !== 'POSTED' || !draftCollection.cash_voucher_id) {
    fail('26) POST CASH', draftCollection);
  } else {
    ok(`26) POST CASH → ${draftCollection.collection_number}`);
  }

  {
    const voucherLines = await query(
      `SELECT l.account_id::text AS account_id,
              l.debit_amount::text AS debit,
              l.credit_amount::text AS credit
       FROM accounts.journal_entry_lines l
       JOIN accounts.cash_vouchers v ON v.journal_entry_id = l.journal_entry_id
       WHERE v.id = $1::uuid
       ORDER BY l.line_number`,
      [draftCollection.cash_voucher_id]
    );
    const drCash = voucherLines.rows.find(
      (r) =>
        r.account_id === cashCtx.cashGlId &&
        moneyIsPositive(normalizeMoneyInput(r.debit as string))
    );
    const crRecv = voucherLines.rows.find(
      (r) =>
        r.account_id === recvGl &&
        moneyIsPositive(normalizeMoneyInput(r.credit as string))
    );
    if (drCash && crRecv) ok('27) سند قبض: Dr Cash / Cr Receivables');
    else fail('27) أطراف سند القبض', voucherLines.rows);
  }

  {
    const led = await query(
      `SELECT entry_type, credit_amount::text AS credit
       FROM accounts.student_ledger_entries
       WHERE source_type = 'STUDENT_COLLECTION' AND source_id = $1::uuid`,
      [draftCollection.id]
    );
    if (
      led.rows.some(
        (r) =>
          r.entry_type === 'COLLECTION' &&
          moneyEquals(normalizeMoneyInput(r.credit as string), inst1.amount)
      )
    ) {
      ok('28) قيد COLLECTION في دفتر الطالب');
    } else {
      fail('28) COLLECTION ledger', led.rows);
    }
  }

  {
    const instRow = await query(
      `SELECT status, paid_amount::text AS paid, outstanding_amount::text AS out
       FROM accounts.student_installments WHERE id = $1::uuid`,
      [inst1.id]
    );
    if (
      instRow.rows[0]?.status === 'PAID' &&
      moneyEquals(instRow.rows[0].paid as string, inst1.amount)
    ) {
      ok('29) القسط 1 PAID بعد التحصيل');
    } else {
      fail('29) outstanding القسط 1', instRow.rows[0]);
    }
  }

  const doublePost = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return postStudentCollection(client, {
      id: draftCollection.id,
      userId,
      version: draftCollection.version,
      updated_at: draftCollection.updated_at,
    });
  });
  if (doublePost.collection.status === 'POSTED') {
    ok('30) POST مكرر idempotent');
  } else {
    fail('30) POST مكرر', doublePost);
  }

  const partialAmount = '100000';
  const bankDraft = await withTransaction(async (client) =>
    createStudentCollection(client, {
      student_account_id: account.id,
      collection_date: fiscal.chargeDate,
      amount: partialAmount,
      payment_method: 'BANK',
      bank_account_id: bankAccountId,
      description: `تحصيل مصرفي جزئي ${suffix}`,
      auto_allocate: true,
      created_by: userId,
    })
  );
  const postedBank = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return postStudentCollection(client, {
      id: bankDraft.collection.id,
      userId,
      version: bankDraft.collection.version,
      updated_at: bankDraft.collection.updated_at,
    });
  });
  if (
    postedBank.collection.status === 'POSTED' &&
    postedBank.collection.bank_voucher_id
  ) {
    ok(`31) POST BANK جزئي ${partialAmount}`);
  } else {
    fail('31) POST BANK', postedBank.collection);
  }

  {
    const bankLines = await query(
      `SELECT l.account_id::text AS account_id,
              l.debit_amount::text AS debit,
              l.credit_amount::text AS credit
       FROM accounts.journal_entry_lines l
       JOIN accounts.bank_vouchers v ON v.journal_entry_id = l.journal_entry_id
       WHERE v.id = $1::uuid`,
      [postedBank.collection.bank_voucher_id]
    );
    const crRecv = bankLines.rows.find((r) => r.account_id === recvGl);
    if (crRecv && moneyEquals(normalizeMoneyInput(crRecv.credit as string), partialAmount)) {
      ok('32) سند بنكي: Cr Receivables');
    } else {
      fail('32) أطراف سند بنكي', bankLines.rows);
    }
  }

  {
    const inst2Row = await query(
      `SELECT status, paid_amount::text AS paid
       FROM accounts.student_installments WHERE id = $1::uuid`,
      [inst2.id]
    );
    if (inst2Row.rows[0]?.status === 'PARTIALLY_PAID') {
      ok('33) القسط 2 PARTIALLY_PAID (تحصيل متعدد الأقساط)');
    } else {
      fail('33) حالة القسط 2', inst2Row.rows[0]);
    }
  }

  const inst3 = activated.installments.find((i) => i.installment_number === 3)!;

  const voidDraft = await withTransaction(async (client) => {
    const { collection } = await createStudentCollection(client, {
      student_account_id: account.id,
      collection_date: fiscal.chargeDate,
      amount: '5000',
      payment_method: 'CASH',
      cash_box_id: cashCtx.boxId,
      cash_box_session_id: cashCtx.sessionId,
      description: `مسودة للإلغاء ${suffix}`,
      allocations: [
        {
          student_charge_id: inst3.student_charge_id!,
          student_installment_id: inst3.id,
          allocated_amount: '5000',
        },
      ],
      created_by: userId,
    });
    return voidStudentCollection(client, {
      id: collection.id,
      userId,
      version: collection.version,
      updated_at: collection.updated_at,
      reason: 'إلغاء مسودة',
    });
  });
  if (voidDraft.status === 'VOID') ok('35) VOID DRAFT');
  else fail('35) VOID DRAFT', voidDraft.status);

  {
    const replaceTest = await withTransaction(async (client) => {
      const inst3Row = activated.installments.find((i) => i.installment_number === 3);
      if (!inst3Row?.student_charge_id) throw new Error('قسط 3');
      const { collection, allocations } = await createStudentCollection(client, {
        student_account_id: account.id,
        collection_date: fiscal.chargeDate,
        amount: '5000',
        payment_method: 'CASH',
        cash_box_id: cashCtx.boxId,
        cash_box_session_id: cashCtx.sessionId,
        description: `replace alloc ${suffix}`,
        allocations: [
          {
            student_charge_id: inst3Row.student_charge_id,
            student_installment_id: inst3Row.id,
            allocated_amount: '5000',
          },
        ],
        created_by: userId,
      });
      const replaced = await replaceAllocations(client, {
        collectionId: collection.id,
        userId,
        version: collection.version,
        updated_at: collection.updated_at,
        allocations: [
          {
            student_charge_id: inst3Row.student_charge_id,
            student_installment_id: inst3Row.id,
            allocated_amount: '5000',
          },
        ],
      });
      return { collection, replaced, allocations };
    });
    if (
      replaceTest.replaced.length === 1 &&
      moneyEquals(replaceTest.replaced[0].allocated_amount, '5000')
    ) {
      ok('44) replaceAllocations على DRAFT');
    } else {
      fail('44) replaceAllocations', replaceTest);
    }

    const colAfterReplace = await withTransaction((client) =>
      loadStudentCollection(client, replaceTest.collection.id)
    );
    await withTransaction(async (client) =>
      voidStudentCollection(client, {
        id: colAfterReplace.id,
        userId,
        version: colAfterReplace.version,
        updated_at: colAfterReplace.updated_at,
        reason: 'تنظيف',
      })
    );
  }

  {
    const balanceBefore = await withTransaction(async (client) => {
      const { getStudentAccountReceivableBalance } = await import(
        '../lib/accounts/student-charges'
      );
      return getStudentAccountReceivableBalance(client, account.id);
    });

    const raceResults = await Promise.allSettled([
      withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        const { collection } = await createStudentCollection(client, {
          student_account_id: account.id,
          collection_date: fiscal.chargeDate,
          amount: balanceBefore,
          payment_method: 'CASH',
          cash_box_id: cashCtx.boxId,
          cash_box_session_id: cashCtx.sessionId,
          description: `race A ${suffix}`,
          auto_allocate: true,
          created_by: userId,
        });
        return postStudentCollection(client, {
          id: collection.id,
          userId,
          version: collection.version,
          updated_at: collection.updated_at,
        });
      }),
      withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        const { collection } = await createStudentCollection(client, {
          student_account_id: account.id,
          collection_date: fiscal.chargeDate,
          amount: balanceBefore,
          payment_method: 'CASH',
          cash_box_id: cashCtx.boxId,
          cash_box_session_id: cashCtx.sessionId,
          description: `race B ${suffix}`,
          auto_allocate: true,
          created_by: userId,
        });
        return postStudentCollection(client, {
          id: collection.id,
          userId,
          version: collection.version,
          updated_at: collection.updated_at,
        });
      }),
    ]);

    const fulfilled = raceResults.filter((r) => r.status === 'fulfilled').length;
    const rejected = raceResults.filter((r) => r.status === 'rejected').length;
    if (fulfilled === 1 && rejected === 1) {
      ok('34) سباق تحصيلين متزامن — نجح واحد وفشل الآخر (overpayment)');
    } else {
      fail('34) سباق التحصيل', { fulfilled, rejected, raceResults });
    }
  }

  const voidCashPosted = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return voidStudentCollection(client, {
      id: draftCollection.id,
      userId,
      version: draftCollection.version,
      updated_at: draftCollection.updated_at,
      reason: 'عكس قبض اختبار',
    });
  });
  if (voidCashPosted.status !== 'VOID') {
    fail('36) VOID CASH POSTED', voidCashPosted);
  } else {
    ok('36) VOID CASH POSTED مع عكس');
  }

  {
    const reversal = await query(
      `SELECT entry_type, debit_amount::text AS debit
       FROM accounts.student_ledger_entries
       WHERE source_type = 'STUDENT_COLLECTION' AND source_id = $1::uuid
         AND entry_type = 'COLLECTION_REVERSAL'`,
      [draftCollection.id]
    );
    if (reversal.rows.length >= 1) ok('37) COLLECTION_REVERSAL في الدفتر');
    else fail('37) COLLECTION_REVERSAL', reversal.rows);
  }

  const voidBankPosted = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return voidStudentCollection(client, {
      id: postedBank.collection.id,
      userId,
      version: postedBank.collection.version,
      updated_at: postedBank.collection.updated_at,
      reason: 'عكس مصرفي',
    });
  });
  if (voidBankPosted.status === 'VOID') ok('38) VOID BANK POSTED');
  else fail('38) VOID BANK POSTED', voidBankPosted);

  const voidAgain = await withTransaction(async (client) =>
    voidStudentCollection(client, {
      id: voidCashPosted.id,
      userId,
      version: voidCashPosted.version,
      updated_at: voidCashPosted.updated_at,
      reason: 'تكرار',
    })
  );
  if (voidAgain.status === 'VOID') ok('39) VOID مكرر idempotent');
  else fail('39) VOID مكرر', voidAgain);

  {
    const viewerId = await upsertCapabilityTestUser(`bill_viewer_${suffix}`);
    const clerkId = await upsertCapabilityTestUser(`bill_clerk_${suffix}`);
    await grantAccountsPlatformRole(viewerId, ACCOUNTS_VIEWER_ROLE_CODE);
    await grantAccountsPlatformRole(clerkId, ACCOUNTS_CLERK_ROLE_CODE);

    await expectHttp(
      '40) viewer لا يفعّل الخطة',
      () =>
        assertStudentReceivablesCapability(
          null,
          viewerId,
          STUDENT_RECEIVABLES_CAPABILITIES.BILLING_ACTIVATE
        ),
      403
    );
    await expectHttp(
      '41) clerk لا يفعّل الخطة',
      () =>
        assertStudentReceivablesCapability(
          null,
          clerkId,
          STUDENT_RECEIVABLES_CAPABILITIES.BILLING_ACTIVATE
        ),
      403
    );
    await expectHttp(
      '42) clerk لا يرحّل التحصيل',
      () =>
        assertStudentReceivablesCapability(
          null,
          clerkId,
          STUDENT_RECEIVABLES_CAPABILITIES.COLLECTIONS_POST
        ),
      403
    );

    const draftPlan = await withTransaction((client) =>
      createStudentBillingPlan(client, {
        student_account_id: account.id,
        fee_type_id: feeType.id,
        total_amount: '12000',
        installment_count: 1,
        first_due_date: fiscal.chargeDate,
        description: `صلاحيات ${suffix}`,
        created_by: userId,
      })
    );

    if (
      (await hasStudentReceivablesCapability(
        null,
        userId,
        STUDENT_RECEIVABLES_CAPABILITIES.BILLING_ACTIVATE
      )) &&
      (await hasStudentReceivablesCapability(
        null,
        clerkId,
        STUDENT_RECEIVABLES_CAPABILITIES.BILLING_MANAGE
      ))
    ) {
      ok('43) admin activate · clerk manage');
    } else {
      fail('43) admin/clerk capabilities');
    }

    await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      return activateStudentBillingPlan(client, {
        id: draftPlan.plan.id,
        userId,
        version: draftPlan.plan.version,
        updated_at: draftPlan.plan.updated_at,
        activation_date: fiscal.chargeDate,
      });
    });
    void draftPlan;
  }

  {
    const planPrint = path.join(
      process.cwd(),
      'app',
      'accounts',
      'students',
      'billing-plans',
      '[id]',
      'print',
      'page.tsx'
    );
    const acctPrint = path.join(
      process.cwd(),
      'app',
      'accounts',
      'students',
      'accounts',
      '[id]',
      'print',
      'page.tsx'
    );
    if (fs.existsSync(planPrint)) {
      const content = fs.readFileSync(planPrint, 'utf8');
      if (
        content.includes('print-container') &&
        content.includes('جدول أقساط') &&
        content.includes('installment_number')
      ) {
        ok('45) صفحة طباعة جدول الأقساط');
      } else {
        fail('45) عناصر طباعة الخطة ناقصة');
      }
    } else {
      fail('45) ملف طباعة الخطة غير موجود');
    }
    if (fs.existsSync(acctPrint)) {
      const content = fs.readFileSync(acctPrint, 'utf8');
      if (content.includes('print-container') && content.includes('كشف')) {
        ok('46) صفحة طباعة كشف حساب الطالب');
      } else {
        fail('46) عناصر كشف الطالب ناقصة');
      }
    } else {
      fail('46) ملف كشف الطالب غير موجود');
    }
  }

  {
    const detail = await withTransaction((client) =>
      getStudentBillingPlan(client, activated.plan.id)
    );
    if (detail.plan.status === 'ACTIVE' && detail.installments.length === 3) {
      ok(`47) getStudentBillingPlan · ${detail.plan.plan_number}`);
    } else {
      fail('47) getStudentBillingPlan', detail.plan.status);
    }
  }

  const verify = await withTransaction((c) => verifyStudentReceivables(c));
  const chargeOpsClean =
    verify.orphans.journal_without_ledger.length === 0 &&
    verify.orphans.ledger_without_journal.length === 0 &&
    verify.orphans.amount_mismatches.length === 0;

  if (chargeOpsClean) {
    ok('48) verify — عمليات المطالبات بلا أيتام (operations match)');
  } else {
    fail('48) verify orphans', verify.orphans);
  }

  if (verify.charge_subledger_match && verify.ok) {
    ok('49) verifyStudentReceivables charge_subledger_match + ok');
  } else {
    fail(
      '49) verifyStudentReceivables',
      `match=${verify.charge_subledger_match} ok=${verify.ok} diff=${verify.difference}`
    );
  }

  console.log(
    `===== انتهى 5.B — نجح ${passCount} · فشل ${failCount} =====`
  );
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (e) => {
    console.error('❌ فشل الاختبار:', e);
    process.exitCode = 1;
    await closePool().catch(() => undefined);
  });
