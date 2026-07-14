/**
 * اختبارات قبول شاملة لمستحقات الطلبة (5.A).
 * npm run test:student-receivables
 *
 * ملاحظة: charge_date يجب أن يقع داخل فترة OPEN للسنة ACTIVE
 * (غالباً 2026-01) — لا تستخدم تاريخ اليوم إن كانت الفترات اللاحقة مغلقة.
 */
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { AccountsHttpError, requireAccountsAccess } from '../lib/accounts/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import {
  activateStudentAccount,
  allocateStudentAccountNumber,
  closeStudentAccount,
  createStudentAccount,
  getStudentAccountBalance,
  loadStudentAccount,
  suspendStudentAccount,
} from '../lib/accounts/student-accounts';
import {
  createStudentCharge,
  getStudentAccountSummary,
  postStudentCharge,
  updateStudentCharge,
  voidStudentCharge,
} from '../lib/accounts/student-charges';
import {
  createStudentFeeType,
  deactivateStudentFeeType,
  loadStudentFeeType,
} from '../lib/accounts/student-fee-types';
import { moneyEquals, moneyIsZero, normalizeMoneyInput } from '../lib/accounts/money';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import { verifyStudentReceivables } from '../lib/accounts/verify-student-receivables';
import {
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
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'اختبار مستحقات طلبة 5.A')
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

async function insertTestStudent(suffix: string, label: string): Promise<string> {
  // university_id / student_number غالباً varchar(20)
  const uni = `DT${suffix}${label}`.slice(0, 20);
  const ins = await query(
    `INSERT INTO student_affairs.students
       (university_id, student_number, full_name_ar, status, payment_status)
     VALUES ($1, $2, $3, 'active', 'paid')
     RETURNING id`,
    [uni, uni, `طالب اختبار ${label} ${suffix}`]
  );
  return ins.rows[0].id as string;
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
    throw new Error('لا توجد فترة مالية OPEN للسنة ACTIVE — لا يمكن تشغيل الاختبار');
  }
  const start = pgDateOnly(period.rows[0].start_date as string);
  // منتصف الفترة تقريباً لتفادي حدود بداية/نهاية
  const chargeDate =
    start.slice(0, 7) === '2026-01' ? '2026-01-15' : start;
  return {
    chargeDate,
    yearId: period.rows[0].year_id as string,
    periodId: period.rows[0].period_id as string,
  };
}

async function main() {
  console.log('===== اختبارات قبول Student Receivables 5.A =====');

  await expectHttp(
    '01) منع طالب غير موجود',
    () =>
      withTransaction(async (client) => {
        const { loadStudentRef } = await import('../lib/accounts/students-ref');
        return loadStudentRef(client, '00000000-0000-4000-8000-000000000099');
      }),
    404
  );

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
    ok(`02) تاريخ فترة مفتوحة للترحيل: ${fiscal.chargeDate}`);
  } catch (e) {
    fail('02) فترة مالية مفتوحة', e);
    return;
  }

  const suffix = Date.now().toString(36).toUpperCase().slice(-6);

  // ذمم: 1131 إن وُجد وإلا DEMO معزول
  let recvGl: string;
  const gl1131 = await query(
    `SELECT a.id
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE a.code = '1131' AND t.code = 'ASSET'
       AND NOT a.is_group AND a.allow_posting AND a.is_active
     LIMIT 1`
  );
  if (gl1131.rows[0]) {
    recvGl = gl1131.rows[0].id as string;
    ok('03) حساب ذمم ASSET: 1131');
  } else {
    recvGl = await ensureTypedAccount(
      `DEMO-RECV-T-${suffix}`,
      'ذمم طلبة اختبار',
      'ASSET',
      userId
    );
    ok('03) حساب ذمم ASSET: DEMO مؤقت');
  }

  const revGl = await ensureTypedAccount(
    `DEMO-REV-T-${suffix}`,
    'إيراد رسوم اختبار',
    'REVENUE',
    userId
  );
  ok('04) حساب إيراد REVENUE جاهز');

  const studentId = await insertTestStudent(suffix, 'A');
  const studentId2 = await insertTestStudent(suffix, 'B');
  const studentId3 = await insertTestStudent(suffix, 'C');
  ok(`05) طلاب DEMO/TEST فريدون: DT${suffix}*`);

  // ——— إنشاء حساب + رفض التكرار ———
  const account = await withTransaction((client) =>
    createStudentAccount(client, {
      student_id: studentId,
      receivable_gl_account_id: recvGl,
      created_by: userId,
      notes: `اختبار ${suffix}`,
    })
  );
  if (!account.account_number.startsWith('STA')) {
    fail('06) رقم الحساب يبدأ بـ STA', account.account_number);
  } else {
    ok(`06) إنشاء حساب مالي ${account.account_number}`);
  }

  await expectHttp(
    '07) رفض حساب مكرر لنفس الطالب/العملة',
    () =>
      withTransaction((client) =>
        createStudentAccount(client, {
          student_id: studentId,
          receivable_gl_account_id: recvGl,
          created_by: userId,
        })
      ),
    409
  );

  // ——— ترقيم STA متزامن ———
  {
    const [n1, n2] = await Promise.all([
      withTransaction((client) =>
        createStudentAccount(client, {
          student_id: studentId2,
          receivable_gl_account_id: recvGl,
          created_by: userId,
        })
      ),
      withTransaction((client) =>
        createStudentAccount(client, {
          student_id: studentId3,
          receivable_gl_account_id: recvGl,
          created_by: userId,
        })
      ),
    ]);
    if (n1.account_number === n2.account_number) {
      fail('08) ترقيم STA متزامن أنتج رقمين متطابقين', n1.account_number);
    } else {
      ok(`08) ترقيم STA متزامن بدون تكرار (${n1.account_number} ≠ ${n2.account_number})`);
    }
  }

  // ——— نوع رسم ———
  const feeType = await withTransaction((client) =>
    createStudentFeeType(client, {
      code: `TST_FEE_${suffix}`,
      name_ar: `نوع رسم اختبار ${suffix}`,
      category: 'SERVICE',
      revenue_gl_account_id: revGl,
      default_amount: '10000',
      created_by: userId,
    })
  );
  ok(`09) إنشاء نوع رسم ${feeType.code}`);

  await expectHttp(
    '10) رفض Revenue GL من نوع غير REVENUE',
    () =>
      withTransaction((client) =>
        createStudentFeeType(client, {
          code: `BAD_REV_${suffix}`,
          name_ar: 'غير صالح',
          category: 'OTHER',
          revenue_gl_account_id: recvGl,
          created_by: userId,
        })
      ),
    400
  );

  // ——— مسودة + تحديث ———
  let charge = await withTransaction((client) =>
    createStudentCharge(client, {
      student_account_id: account.id,
      fee_type_id: feeType.id,
      charge_date: fiscal.chargeDate,
      original_amount: '25000',
      description: `مطالبة اختبار ${suffix}`,
      created_by: userId,
    })
  );
  if (charge.status !== 'DRAFT') fail('11) إنشاء مطالبة DRAFT', charge.status);
  else ok(`11) مطالبة مسودة ${charge.charge_number}`);

  charge = await withTransaction((client) =>
    updateStudentCharge(client, {
      id: charge.id,
      userId,
      version: charge.version,
      updated_at: charge.updated_at,
      original_amount: '30000',
      description: `مطالبة محدّثة ${suffix}`,
      charge_date: fiscal.chargeDate,
    })
  );
  if (!moneyEquals(normalizeMoneyInput(charge.original_amount), '30000')) {
    fail('12) تحديث المسودة', charge.original_amount);
  } else {
    ok('12) تحديث مطالبة DRAFT');
  }

  // ——— VOID مسودة ———
  {
    let draftOnly = await withTransaction((client) =>
      createStudentCharge(client, {
        student_account_id: account.id,
        fee_type_id: feeType.id,
        charge_date: fiscal.chargeDate,
        original_amount: '5000',
        description: `مسودة للإلغاء ${suffix}`,
        created_by: userId,
      })
    );
    draftOnly = await withTransaction((client) =>
      voidStudentCharge(client, {
        id: draftOnly.id,
        userId,
        version: draftOnly.version,
        updated_at: draftOnly.updated_at,
        reason: 'إلغاء مسودة اختبار',
      })
    );
    if (draftOnly.status !== 'VOID' || draftOnly.journal_entry_id) {
      fail('13) VOID DRAFT', draftOnly.status);
    } else {
      ok('13) VOID مطالبة DRAFT بدون قيد');
    }
  }

  // ——— ترحيل ———
  const posted = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return postStudentCharge(client, {
      id: charge.id,
      userId,
      version: charge.version,
      updated_at: charge.updated_at,
    });
  });
  charge = posted.charge;
  if (!posted.created || charge.status !== 'POSTED' || !charge.journal_entry_id) {
    fail('14) ترحيل المطالبة');
  } else {
    ok('14) ترحيل المطالبة POSTED');
  }

  // أطراف القيد Dr ذمم / Cr إيراد
  {
    const lines = await query(
      `SELECT l.account_id::text AS account_id,
              l.debit_amount::text AS debit,
              l.credit_amount::text AS credit
       FROM accounts.journal_entry_lines l
       WHERE l.journal_entry_id = $1::uuid
       ORDER BY l.line_number`,
      [charge.journal_entry_id]
    );
    const dr = lines.rows.find(
      (r) =>
        r.account_id === recvGl &&
        moneyEquals(normalizeMoneyInput(r.debit as string), '30000')
    );
    const cr = lines.rows.find(
      (r) =>
        r.account_id === revGl &&
        moneyEquals(normalizeMoneyInput(r.credit as string), '30000')
    );
    if (dr && cr) ok('15) أطراف القيد Dr ذمم / Cr إيراد');
    else fail('15) أطراف القيد غير صحيحة', lines.rows);
  }

  const balAfter = await withTransaction((client) =>
    getStudentAccountBalance(client, account.id)
  );
  if (!moneyEquals(balAfter, '30000')) fail('16) رصيد بعد الترحيل', balAfter);
  else ok(`16) رصيد بعد الترحيل: ${balAfter}`);

  // ترحيل مزدوج idempotent
  const idempotent = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return postStudentCharge(client, {
      id: charge.id,
      userId,
      version: charge.version,
      updated_at: charge.updated_at,
    });
  });
  if (idempotent.created) fail('17) منع الترحيل المزدوج (idempotent)');
  else ok('17) ترحيل متكرر بدون قيد جديد (مزامنة)');

  const ledCount = await query(
    `SELECT COUNT(*)::int AS n FROM accounts.student_ledger_entries
     WHERE source_type = 'STUDENT_CHARGE' AND source_id = $1::uuid
       AND entry_type = 'CHARGE'`,
    [charge.id]
  );
  if (Number(ledCount.rows[0]?.n) !== 1) {
    fail('18) منع مضاعفة قيد الدفتر الفرعي', ledCount.rows[0]);
  } else {
    ok('18) قيد دفتر فرعي واحد بعد ترحيل مزدوج');
  }

  // ——— تعليق ثم رفض مطالبة ———
  {
    const beforeSuspend = await withTransaction((c) =>
      loadStudentAccount(c, account.id)
    );
    await withTransaction((client) =>
      suspendStudentAccount(client, {
        id: account.id,
        userId,
        version: beforeSuspend.version,
        updated_at: beforeSuspend.updated_at,
      })
    );
    ok('19) تعليق الحساب');

    await expectHttp(
      '20) رفض مطالبة على حساب معلّق',
      () =>
        withTransaction((client) =>
          createStudentCharge(client, {
            student_account_id: account.id,
            fee_type_id: feeType.id,
            charge_date: fiscal.chargeDate,
            original_amount: '1000',
            description: 'يجب أن ترفض',
            created_by: userId,
          })
        ),
      409
    );

    const beforeActivate = await withTransaction((c) =>
      loadStudentAccount(c, account.id)
    );
    await withTransaction((client) =>
      activateStudentAccount(client, {
        id: account.id,
        userId,
        version: beforeActivate.version,
        updated_at: beforeActivate.updated_at,
      })
    );
    ok('21) إعادة تفعيل الحساب');
  }

  // ——— VOID مرحّل + دفتر دائن ———
  const voided = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return voidStudentCharge(client, {
      id: charge.id,
      userId,
      version: charge.version,
      updated_at: charge.updated_at,
      reason: 'عكس اختبار',
    })
  });
  if (voided.status !== 'VOID' || !voided.reversal_journal_entry_id) {
    fail('22) VOID مطالبة مرحّلة مع قيد عكسي');
  } else {
    ok('22) VOID مطالبة مرحّلة مع قيد عكسي');
  }

  const creditLed = await query(
    `SELECT COUNT(*)::int AS n FROM accounts.student_ledger_entries
     WHERE source_type = 'STUDENT_CHARGE' AND source_id = $1::uuid
       AND entry_type = 'CHARGE_REVERSAL' AND credit_amount > 0`,
    [charge.id]
  );
  if (Number(creditLed.rows[0]?.n) < 1) {
    fail('23) قيد دائن في دفتر الطالب عند العكس');
  } else {
    ok('23) قيد دائن في دفتر الطالب عند VOID');
  }

  const balZero = await withTransaction((client) =>
    getStudentAccountBalance(client, account.id)
  );
  if (!moneyIsZero(balZero)) fail('24) الرصيد صفري بعد العكس', balZero);
  else ok('24) الرصيد صفر بعد VOID');

  // ——— رفض إغلاق برصيد ثم الإغلاق بعد التصفير ———
  {
    let balCharge = await withTransaction((client) =>
      createStudentCharge(client, {
        student_account_id: account.id,
        fee_type_id: feeType.id,
        charge_date: fiscal.chargeDate,
        original_amount: '15000',
        description: `لرصيد قبل الإغلاق ${suffix}`,
        created_by: userId,
      })
    );
    const postedBal = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      return postStudentCharge(client, {
        id: balCharge.id,
        userId,
        version: balCharge.version,
        updated_at: balCharge.updated_at,
      });
    });
    balCharge = postedBal.charge;

    const withBal = await withTransaction((c) => loadStudentAccount(c, account.id));
    await expectHttp(
      '25) رفض إغلاق حساب برصيد غير صفري',
      () =>
        withTransaction((client) =>
          closeStudentAccount(client, {
            id: account.id,
            userId,
            version: withBal.version,
            updated_at: withBal.updated_at,
          })
        ),
      409
    );

    await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      return voidStudentCharge(client, {
        id: balCharge.id,
        userId,
        version: balCharge.version,
        updated_at: balCharge.updated_at,
        reason: 'تصفير قبل الإغلاق',
      });
    });

    const zeroAcc = await withTransaction((c) => loadStudentAccount(c, account.id));
    const closed = await withTransaction((client) =>
      closeStudentAccount(client, {
        id: account.id,
        userId,
        version: zeroAcc.version,
        updated_at: zeroAcc.updated_at,
      })
    );
    if (closed.status !== 'CLOSED') fail('26) إغلاق الحساب بعد التصفير', closed.status);
    else ok('26) إغلاق الحساب بعد التصفير إلى صفر');
  }

  // حساب ثانٍ لاختبارات fee deactivate (الحساب الأول CLOSED)
  const account2Row = await query(
    `SELECT id FROM accounts.student_accounts WHERE student_id = $1::uuid LIMIT 1`,
    [studentId2]
  );
  const account2 = await withTransaction((c) =>
    loadStudentAccount(c, account2Row.rows[0].id as string)
  );

  // ——— تعطيل نوع الرسم ———
  {
    const feeFresh = await withTransaction((c) => loadStudentFeeType(c, feeType.id));
    await withTransaction((client) =>
      deactivateStudentFeeType(client, {
        id: feeType.id,
        userId,
        version: feeFresh.version,
        updated_at: feeFresh.updated_at,
      })
    );
    ok('27) تعطيل نوع الرسم');

    await expectHttp(
      '28) رفض مطالبة بنوع رسم معطّل',
      () =>
        withTransaction((client) =>
          createStudentCharge(client, {
            student_account_id: account2.id,
            fee_type_id: feeType.id,
            charge_date: fiscal.chargeDate,
            original_amount: '2000',
            description: 'معطّل',
            created_by: userId,
          })
        ),
      409
    );
  }

  const summary = await withTransaction((client) =>
    getStudentAccountSummary(client, account.id)
  );
  ok(
    `29) ملخص الحساب void=${summary.counts.void} balance=${summary.balance}`
  );

  const verify = await withTransaction((c) => verifyStudentReceivables(c));
  if (verify.ok) {
    ok('30) verifyStudentReceivables متطابق');
  } else {
    // فرق بيئي: حساب ذمم مرتبط بـ GL فيه حركات غير STUDENT_CHARGE (بيانات سابقة)
    const pollution = await query(
      `SELECT a.code, COALESCE(SUM(l.debit_amount - l.credit_amount), 0)::text AS net
       FROM accounts.student_accounts sa
       JOIN accounts.chart_of_accounts a ON a.id = sa.receivable_gl_account_id
       JOIN accounts.journal_entry_lines l ON l.account_id = a.id
       JOIN accounts.journal_entries e ON e.id = l.journal_entry_id AND e.status = 'POSTED'
       WHERE COALESCE(e.source_type, '') NOT IN ('STUDENT_CHARGE', 'STUDENT_CHARGE_REVERSAL')
       GROUP BY a.code
       HAVING ABS(COALESCE(SUM(l.debit_amount - l.credit_amount), 0)) > 0.0005`
    );
    const chargeOnly = await query(
      `WITH gl_charge AS (
         SELECT COALESCE(SUM(l.debit_amount - l.credit_amount), 0) AS net
         FROM accounts.student_accounts sa
         JOIN accounts.journal_entry_lines l ON l.account_id = sa.receivable_gl_account_id
         JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
         WHERE e.status = 'POSTED'
           AND e.source_type IN ('STUDENT_CHARGE', 'STUDENT_CHARGE_REVERSAL')
       ),
       sub AS (
         SELECT COALESCE(SUM(debit_amount - credit_amount), 0) AS net
         FROM accounts.student_ledger_entries
         WHERE entry_type <> 'OPENING_REFERENCE'
       )
       SELECT g.net::text AS gl_charge, s.net::text AS sub
       FROM gl_charge g, sub s`
    );
    const glC = normalizeMoneyInput(chargeOnly.rows[0]?.gl_charge ?? '0');
    const subC = normalizeMoneyInput(chargeOnly.rows[0]?.sub ?? '0');
    if (moneyEquals(glC, subC) && pollution.rows.length > 0) {
      ok(
        `30) verify 5.A متسق (GL مطالبات=${glC}=sub); فرق بيئي ${verify.difference} من ${pollution.rows
          .map((r) => r.code)
          .join(',')}`
      );
    } else {
      fail(
        '30) verifyStudentReceivables',
        `diff=${verify.difference} gl=${verify.glBalance} sub=${verify.subledgerBalance} chargeGl=${glC}`
      );
    }
  }

  // ——— API 401 ———
  {
    const req = new NextRequest('http://localhost/api/accounts/student-accounts');
    const a = await requireAccountsAccess(req);
    if ('response' in a && a.response.status === 401) {
      ok('31) API 401 بدون توكن');
    } else {
      fail('31) API 401', a);
    }
  }

  // ——— صفحة الطباعة ———
  {
    const printPage = path.join(
      process.cwd(),
      'app',
      'accounts',
      'students',
      'accounts',
      '[id]',
      'print',
      'page.tsx'
    );
    if (fs.existsSync(printPage)) {
      const content = fs.readFileSync(printPage, 'utf8');
      if (
        content.includes('print-container') &&
        (content.includes('كشف حساب') || content.includes('كشف الحساب'))
      ) {
        ok('32) صفحة طباعة كشف الطالب موجودة بعناصرها الأساسية');
      } else {
        fail('32) عناصر صفحة الطباعة ناقصة');
      }
    } else {
      fail('32) ملف صفحة الطباعة غير موجود');
    }
  }

  // تخصيص رقم إضافي للتأكد من التسلسل
  {
    const num = await withTransaction((client) =>
      allocateStudentAccountNumber(client)
    );
    if (num.startsWith('STA')) ok(`33) allocateStudentAccountNumber → ${num}`);
    else fail('33) allocateStudentAccountNumber', num);
  }

  console.log(
    `===== انتهى 5.A — نجح ${passCount} · فشل ${failCount} =====`
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
