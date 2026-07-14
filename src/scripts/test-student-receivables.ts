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
  assertValidReceivableGlAccount,
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
import {
  ACCOUNTS_CLERK_ROLE_CODE,
  ACCOUNTS_VIEWER_ROLE_CODE,
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
  grantAccountsPlatformRole,
  hasStudentReceivablesCapability,
} from '../lib/accounts/student-receivables-access';
import { moneyEquals, moneyIsZero, normalizeMoneyInput } from '../lib/accounts/money';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import {
  hasUnexplainedGlActivity,
  verifyStudentReceivables,
} from '../lib/accounts/verify-student-receivables';
import {
  acquireJournalEntriesLock,
  withTransaction,
} from '../lib/accounts/with-transaction';
import bcrypt from 'bcrypt';
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

async function insertTestStudent(
  suffix: string,
  label: string,
  status = 'active'
): Promise<string> {
  // university_id / student_number غالباً varchar(20)
  const uni = `DT${suffix}${label}`.slice(0, 20);
  const ins = await query(
    `INSERT INTO student_affairs.students
       (university_id, student_number, full_name_ar, status, payment_status)
     VALUES ($1, $2, $3, $4, 'paid')
     RETURNING id`,
    [uni, uni, `طالب اختبار ${label} ${suffix}`, status]
  );
  return ins.rows[0].id as string;
}

async function upsertCapabilityTestUser(username: string): Promise<string> {
  const hash = await bcrypt.hash('test-recv-pass', 10);
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
  if (verify.charge_subledger_match && verify.ok) {
    ok('30) verifyStudentReceivables A↔B متطابق (ok + charge_subledger_match)');
  } else if (verify.charge_subledger_match) {
    ok(
      `30) verify charge_subledger_match مع أيتام/فروق مبلّغة (ok=${verify.ok})`
    );
  } else {
    fail(
      '30) verifyStudentReceivables',
      `ok=${verify.ok} match=${verify.charge_subledger_match} diff=${verify.difference} A=${verify.charge_sourced_gl_balance} B=${verify.total_student_subledger}`
    );
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
        (content.includes('كشف حساب') || content.includes('كشف الحساب')) &&
        content.includes('charge_number') &&
        content.includes('توقيع المحاسب') &&
        content.includes('admission_type')
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

  // ——— Softening / hardening extras ———

  // 34) رفض GL نقد / صندوق كذمم
  {
    const cashBox = await query(
      `SELECT account_id::text AS aid, closed_account_id::text AS closed_id, code
       FROM accounts.cash_boxes
       WHERE account_id IS NOT NULL
       ORDER BY created_at
       LIMIT 1`
    );
    if (cashBox.rows[0]?.aid) {
      await expectHttp(
        '34) رفض حساب صندوق نقدي كذمم (account_id)',
        () =>
          withTransaction((client) =>
            assertValidReceivableGlAccount(client, cashBox.rows[0].aid as string)
          ),
        400
      );
    } else {
      ok('34) تخطّي رفض صندوق — لا يوجد cash_box.account_id');
    }

    const closedCash = await query(
      `SELECT closed_account_id::text AS cid, code
       FROM accounts.cash_boxes
       WHERE closed_account_id IS NOT NULL
       LIMIT 1`
    );
    if (closedCash.rows[0]?.cid) {
      await expectHttp(
        '35) رفض closed_account_id لصندوق كذمم',
        () =>
          withTransaction((client) =>
            assertValidReceivableGlAccount(
              client,
              closedCash.rows[0].cid as string
            )
          ),
        400
      );
    } else {
      // أنشئ ASSET مؤقت واربطه كـ closed_account_id إن أمكن على صندوق موجود
      const anyBox = await query(
        `SELECT id FROM accounts.cash_boxes ORDER BY created_at LIMIT 1`
      );
      if (anyBox.rows[0]) {
        const tmpGl = await ensureTypedAccount(
          `DEMO-CASH-CL-${suffix}`,
          'نقد مغلق اختبار',
          'ASSET',
          userId
        );
        await query(
          `UPDATE accounts.cash_boxes SET closed_account_id = $1::uuid
           WHERE id = $2::uuid AND closed_account_id IS NULL`,
          [tmpGl, anyBox.rows[0].id]
        );
        const linked = await query(
          `SELECT closed_account_id::text AS cid FROM accounts.cash_boxes
           WHERE id = $1::uuid`,
          [anyBox.rows[0].id]
        );
        if (linked.rows[0]?.cid === tmpGl) {
          await expectHttp(
            '35) رفض closed_account_id لصندوق كذمم',
            () =>
              withTransaction((client) =>
                assertValidReceivableGlAccount(client, tmpGl)
              ),
            400
          );
          await query(
            `UPDATE accounts.cash_boxes SET closed_account_id = NULL WHERE id = $1::uuid`,
            [anyBox.rows[0].id]
          );
        } else {
          ok('35) تخطّي closed_account_id — لم يُربط مؤقتاً');
        }
      } else {
        ok('35) تخطّي closed_account_id — لا صناديق');
      }
    }
  }

  // 36) رفض إنشاء حساب لطالب غير نشط
  {
    const inactiveId = await insertTestStudent(suffix, 'X', 'suspended');
    await expectHttp(
      '36) رفض حساب مالي لطالب غير نشط',
      () =>
        withTransaction((client) =>
          createStudentAccount(client, {
            student_id: inactiveId,
            receivable_gl_account_id: recvGl,
            created_by: userId,
          })
        ),
      409
    );
  }

  // 37–40) صلاحيات viewer / clerk / admin
  {
    const viewerId = await upsertCapabilityTestUser(`recv_viewer_${suffix}`);
    const clerkId = await upsertCapabilityTestUser(`recv_clerk_${suffix}`);
    await grantAccountsPlatformRole(viewerId, ACCOUNTS_VIEWER_ROLE_CODE);
    await grantAccountsPlatformRole(clerkId, ACCOUNTS_CLERK_ROLE_CODE);

    await expectHttp(
      '37) viewer لا يعدّ prepare',
      () =>
        assertStudentReceivablesCapability(
          null,
          viewerId,
          STUDENT_RECEIVABLES_CAPABILITIES.CHARGES_PREPARE
        ),
      403
    );
    await expectHttp(
      '38) viewer لا يعدّ post/void/close',
      async () => {
        await assertStudentReceivablesCapability(
          null,
          viewerId,
          STUDENT_RECEIVABLES_CAPABILITIES.CHARGES_POST
        );
      },
      403
    );
    // void + close لنفس viewer
    await expectHttp(
      '38b) viewer لا يعدّ void',
      () =>
        assertStudentReceivablesCapability(
          null,
          viewerId,
          STUDENT_RECEIVABLES_CAPABILITIES.CHARGES_VOID
        ),
      403
    );
    await expectHttp(
      '38c) viewer لا يعدّ close',
      () =>
        assertStudentReceivablesCapability(
          null,
          viewerId,
          STUDENT_RECEIVABLES_CAPABILITIES.CLOSE
        ),
      403
    );

    await expectHttp(
      '39) clerk لا يغلق الحساب',
      () =>
        assertStudentReceivablesCapability(
          null,
          clerkId,
          STUDENT_RECEIVABLES_CAPABILITIES.CLOSE
        ),
      403
    );

    if (
      (await hasStudentReceivablesCapability(
        null,
        userId,
        STUDENT_RECEIVABLES_CAPABILITIES.CLOSE
      )) &&
      (await hasStudentReceivablesCapability(
        null,
        clerkId,
        STUDENT_RECEIVABLES_CAPABILITIES.CHARGES_POST
      ))
    ) {
      ok('40) admin يملك close و clerk يملك post');
    } else {
      fail('40) admin/clerk القدرات');
    }
  }

  // 41) حقول verify / منطق --strict
  {
    const v = await withTransaction((c) => verifyStudentReceivables(c));
    const hasFields =
      typeof v.charge_subledger_match === 'boolean' &&
      typeof v.unexplained_gl_activity === 'string' &&
      typeof v.total_gl_balance === 'string' &&
      typeof v.total_student_subledger === 'string' &&
      typeof v.charge_sourced_gl_balance === 'string' &&
      v.orphans &&
      Array.isArray(v.orphans.journal_without_ledger);
    if (!hasFields) {
      fail('41) حقول verifyStudentReceivables ناقصة', v);
    } else if (v.charge_subledger_match && v.ok) {
      const unexplained = hasUnexplainedGlActivity(v);
      ok(
        `41) verify --strict logic: match=true · unexplained=${unexplained ? v.unexplained_gl_activity : '0'}`
      );
    } else {
      fail(
        '41) verify A↔B يجب أن يتطابق بعد اختبارات 5.A',
        `ok=${v.ok} match=${v.charge_subledger_match}`
      );
    }
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
