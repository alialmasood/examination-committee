/**
 * اختبارات قبول Student Reliefs (5.C.1).
 * npm run test:student-reliefs
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcrypt';
import { closePool, query } from '../lib/db';
import { AccountsHttpError, requireAccountsAccess } from '../lib/accounts/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import {
  moneyEquals,
  moneyToMillis,
  normalizeMoneyInput,
} from '../lib/accounts/money';
import {
  activateStudentBillingPlan,
  createStudentBillingPlan,
  getStudentBillingPlan,
  loadStudentInstallment,
} from '../lib/accounts/student-billing-plans';
import {
  createStudentAccount,
  suspendStudentAccount,
} from '../lib/accounts/student-accounts';
import {
  createStudentCollection,
  postStudentCollection,
} from '../lib/accounts/student-collections';
import {
  createStudentCharge,
  loadStudentCharge,
  postStudentCharge,
} from '../lib/accounts/student-charges';
import { createStudentFeeType } from '../lib/accounts/student-fee-types';
import {
  createStudentReliefType,
  deactivateStudentReliefType,
} from '../lib/accounts/student-relief-types';
import {
  approveStudentRelief,
  createStudentRelief,
  loadStudentRelief,
  postStudentRelief,
  submitStudentRelief,
  voidStudentRelief,
} from '../lib/accounts/student-reliefs';
import {
  ACCOUNTS_APPROVER_ROLE_CODE,
  ACCOUNTS_CLERK_ROLE_CODE,
  ACCOUNTS_VIEWER_ROLE_CODE,
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
  grantAccountsPlatformRole,
  hasStudentReceivablesCapability,
} from '../lib/accounts/student-receivables-access';
import { verifyStudentReceivables } from '../lib/accounts/verify-student-receivables';
import {
  acquireJournalEntriesLock,
  withTransaction,
} from '../lib/accounts/with-transaction';
import fs from 'fs';
import path from 'path';

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
  typeCode: 'ASSET' | 'REVENUE' | 'EXPENSE',
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
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'اختبار 5.C.1')
     RETURNING id`,
    [code, nameAr, type.rows[0].id, type.rows[0].normal_balance, sort.rows[0].n, userId]
  );
  return ins.rows[0].id as string;
}

async function insertTestStudent(suffix: string, label: string): Promise<string> {
  const uni = `SR${suffix}${label}`.slice(0, 20);
  const ins = await query(
    `INSERT INTO student_affairs.students
       (university_id, student_number, full_name_ar, status, payment_status)
     VALUES ($1, $2, $3, 'active', 'paid')
     RETURNING id`,
    [uni, uni, `طالب 5.C.1 ${label} ${suffix}`]
  );
  return ins.rows[0].id as string;
}

async function upsertTestUser(username: string): Promise<string> {
  const hash = await bcrypt.hash('test-5c1-pass', 10);
  const res = await query(
    `INSERT INTO student_affairs.users (username, email, full_name, password_hash, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = TRUE
     RETURNING id`,
    [username, `${username}@test.local`, `اختبار ${username}`, hash]
  );
  const userId = res.rows[0].id as string;
  await query(
    `INSERT INTO student_affairs.user_systems (user_id, system_id)
     SELECT $1::uuid, s.id FROM student_affairs.systems s WHERE s.code = 'ACCOUNTS'
     ON CONFLICT (user_id, system_id) DO NOTHING`,
    [userId]
  );
  return userId;
}

async function resolveFiscal(): Promise<{
  chargeDate: string;
  yearId: string;
  periodId: string;
}> {
  const period = await query(
    `SELECT y.id AS year_id, p.id AS period_id, p.start_date::text AS start_date
     FROM accounts.fiscal_years y
     JOIN accounts.fiscal_periods p ON p.fiscal_year_id = y.id
     WHERE y.status = 'ACTIVE' AND p.status = 'OPEN'
     ORDER BY y.is_default DESC, p.start_date LIMIT 1`
  );
  if (!period.rows[0]) throw new Error('لا فترة OPEN');
  const start = pgDateOnly(period.rows[0].start_date as string);
  const chargeDate = start.slice(0, 7) === '2026-01' ? '2026-01-15' : start;
  return {
    chargeDate,
    yearId: period.rows[0].year_id as string,
    periodId: period.rows[0].period_id as string,
  };
}

async function postChargeOnAccount(params: {
  accountId: string;
  studentId: string;
  feeTypeId: string;
  amount: string;
  userId: string;
  chargeDate: string;
  description: string;
}) {
  const draft = await withTransaction((client) =>
    createStudentCharge(client, {
      student_account_id: params.accountId,
      fee_type_id: params.feeTypeId,
      charge_date: params.chargeDate,
      original_amount: params.amount,
      description: params.description,
      created_by: params.userId,
    })
  );
  const posted = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return postStudentCharge(client, {
      id: draft.id,
      userId: params.userId,
      version: draft.version,
      updated_at: draft.updated_at,
    });
  });
  return posted.charge;
}

async function main() {
  const suffix = String(Date.now()).slice(-6);
  console.log(`===== اختبارات 5.C.1 (${suffix}) =====`);

  const adminId = await upsertTestUser(`srl-admin-${suffix}`);
  await grantAccountsAdminRole(adminId);

  const viewerId = await upsertTestUser(`srl-viewer-${suffix}`);
  await grantAccountsPlatformRole(viewerId, ACCOUNTS_VIEWER_ROLE_CODE);

  const clerkId = await upsertTestUser(`srl-clerk-${suffix}`);
  await grantAccountsPlatformRole(clerkId, ACCOUNTS_CLERK_ROLE_CODE);

  const approverId = await upsertTestUser(`srl-approver-${suffix}`);
  await grantAccountsPlatformRole(approverId, ACCOUNTS_APPROVER_ROLE_CODE);

  const userId = adminId;
  const fiscal = await resolveFiscal();
  const recvGl = await ensureTypedAccount(
    `DEMO-RECV-SRL-${suffix}`,
    `ذمم 5.C.1 ${suffix}`,
    'ASSET',
    userId
  );
  const revGl = await ensureTypedAccount(
    `DEMO-REV-SRL-${suffix}`,
    `إيراد 5.C.1 ${suffix}`,
    'REVENUE',
    userId
  );
  const expGl = await ensureTypedAccount(
    `DEMO-EXP-SRL-${suffix}`,
    `مصروف تخفيض ${suffix}`,
    'EXPENSE',
    userId
  );

  const feeType = await withTransaction((client) =>
    createStudentFeeType(client, {
      code: `SRL-FEE-${suffix}`,
      name_ar: `رسم 5.C.1 ${suffix}`,
      category: 'TUITION',
      revenue_gl_account_id: revGl,
      default_amount: '100000',
      created_by: userId,
    })
  );

  // 1) إنشاء نوع تخفيض EXPENSE
  const reliefType = await withTransaction((client) =>
    createStudentReliefType(client, {
      code: `SRL-TYPE-${suffix}`,
      name_ar: 'خصم اختبار',
      relief_kind: 'DISCOUNT',
      calculation_type: 'FIXED_AMOUNT',
      default_value: '10000',
      gl_account_id: expGl,
      requires_approval: true,
      created_by: userId,
    })
  );
  ok('1) إنشاء نوع تخفيض EXPENSE');

  // 2) رفض GL غير EXPENSE
  await expectHttp(
    '2) رفض REVENUE كحساب تخفيض',
    () =>
      withTransaction((client) =>
        createStudentReliefType(client, {
          code: `SRL-BAD-${suffix}`,
          name_ar: 'سيء',
          relief_kind: 'DISCOUNT',
          calculation_type: 'FIXED_AMOUNT',
          gl_account_id: revGl,
          created_by: userId,
        })
      ),
    400
  );

  // 3) إلغاء تفعيل النوع
  await withTransaction((client) =>
    deactivateStudentReliefType(client, { id: reliefType.id, userId })
  );
  const reactivated = await query(
    `UPDATE accounts.student_relief_types SET is_active = TRUE WHERE id = $1::uuid RETURNING id`,
    [reliefType.id]
  );
  if (reactivated.rows[0]) ok('3) deactivate + reactivate للاختبارات');

  const noApprovalType = await withTransaction((client) =>
    createStudentReliefType(client, {
      code: `SRL-NOAPR-${suffix}`,
      name_ar: 'بدون اعتماد',
      relief_kind: 'WAIVER',
      calculation_type: 'PERCENTAGE',
      default_value: '10',
      gl_account_id: expGl,
      requires_approval: false,
      created_by: userId,
    })
  );

  const studentId = await insertTestStudent(suffix, 'MAIN');
  const account = await withTransaction((client) =>
    createStudentAccount(client, {
      student_id: studentId,
      receivable_gl_account_id: recvGl,
      created_by: userId,
    })
  );

  const charge = await postChargeOnAccount({
    accountId: account.id,
    studentId,
    feeTypeId: feeType.id,
    amount: '100000',
    userId,
    chargeDate: fiscal.chargeDate,
    description: `مطالبة تخفيض ${suffix}`,
  });

  // 4) مسودة FIXED
  const draft = await withTransaction((client) =>
    createStudentRelief(client, {
      student_charge_id: charge.id,
      relief_type_id: reliefType.id,
      requested_amount: '15000',
      reason: 'مسودة ثابت',
      requested_by: userId,
    })
  );
  if (draft.status === 'DRAFT') ok('4) إنشاء مسودة FIXED');

  // 5) PERCENTAGE
  const pctDraft = await withTransaction((client) =>
    createStudentRelief(client, {
      student_charge_id: charge.id,
      relief_type_id: noApprovalType.id,
      calculation_type: 'PERCENTAGE',
      percentage_value: '5',
      reason: 'نسبة 5%',
      requested_by: userId,
    })
  );
  if (moneyEquals(pctDraft.requested_amount, '5000.000')) {
    ok('5) حساب PERCENTAGE');
  } else {
    fail('5) PERCENTAGE', pctDraft.requested_amount);
  }

  // 6) تجاوز الرصيد
  await expectHttp(
    '6) over-relief مرفوض',
    () =>
      withTransaction((client) =>
        createStudentRelief(client, {
          student_charge_id: charge.id,
          relief_type_id: reliefType.id,
          requested_amount: '200000',
          reason: 'زيادة',
          requested_by: userId,
        })
      ),
    409
  );

  // 7) workflow اعتماد
  const submitted = await withTransaction((client) =>
    submitStudentRelief(client, {
      id: draft.id,
      userId,
      version: draft.version,
      updated_at: draft.updated_at,
    })
  );
  if (submitted.status === 'PENDING_APPROVAL') ok('7a) submit → PENDING');

  const approved = await withTransaction((client) =>
    approveStudentRelief(client, {
      id: submitted.id,
      userId: approverId,
      version: submitted.version,
      updated_at: submitted.updated_at,
      approved_amount: '12000',
    })
  );
  if (approved.status === 'APPROVED') ok('7b) approve');

  // 8) ترحيل + قيد + دفتر
  const posted = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return postStudentRelief(client, {
      id: approved.id,
      userId,
      version: approved.version,
      updated_at: approved.updated_at,
    });
  });
  const chargeAfter = await withTransaction((client) =>
    loadStudentCharge(client, charge.id)
  );
  const ledger = await query(
    `SELECT entry_type, credit_amount::text AS credit
     FROM accounts.student_ledger_entries
     WHERE source_type = 'STUDENT_RELIEF' AND source_id = $1::uuid`,
    [approved.id]
  );
  if (
    posted.relief.status === 'POSTED' &&
    posted.relief.journal_entry_id &&
    ledger.rows[0]?.entry_type === 'RELIEF' &&
    moneyEquals(chargeAfter.outstanding_amount, '88000.000')
  ) {
    ok('8) post → JE + ledger + outstanding');
  } else {
    fail('8) post', { posted, chargeAfter, ledger: ledger.rows });
  }

  // 9) خطة + relief_amount على القسط
  const planStudent = await insertTestStudent(suffix, 'PLAN');
  const planAccount = await withTransaction((client) =>
    createStudentAccount(client, {
      student_id: planStudent,
      receivable_gl_account_id: recvGl,
      created_by: userId,
    })
  );
  const planDraft = await withTransaction((client) =>
    createStudentBillingPlan(client, {
      student_account_id: planAccount.id,
      fee_type_id: feeType.id,
      total_amount: '30000',
      installment_count: 1,
      first_due_date: fiscal.chargeDate,
      description: `خطة تخفيض ${suffix}`,
      created_by: userId,
    })
  );
  const activated = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return activateStudentBillingPlan(client, {
      id: planDraft.plan.id,
      userId,
      version: planDraft.plan.version,
      updated_at: planDraft.plan.updated_at,
      activation_date: fiscal.chargeDate,
    });
  });
  const instFresh = await withTransaction((client) =>
    loadStudentInstallment(client, activated.installments[0].id)
  );
  if (!instFresh.student_charge_id) {
    fail('9) قسط بلا مطالبة', instFresh);
  }
  const planReliefType = await withTransaction((client) =>
    createStudentReliefType(client, {
      code: `SRL-PLAN-${suffix}`,
      name_ar: 'إعفاء خطة',
      relief_kind: 'WAIVER',
      calculation_type: 'FIXED_AMOUNT',
      gl_account_id: expGl,
      requires_approval: false,
      created_by: userId,
    })
  );
  const planRelief = await withTransaction(async (client) => {
    const r = await createStudentRelief(client, {
      student_charge_id: instFresh.student_charge_id!,
      relief_type_id: planReliefType.id,
      requested_amount: instFresh.amount,
      reason: 'إعفاء كامل القسط',
      requested_by: userId,
    });
    const s = await submitStudentRelief(client, {
      id: r.id,
      userId,
      version: r.version,
      updated_at: r.updated_at,
    });
    await acquireJournalEntriesLock(client);
    return postStudentRelief(client, {
      id: s.id,
      userId,
      version: s.version,
      updated_at: s.updated_at,
    });
  });
  const instAfter = await withTransaction((client) =>
    loadStudentInstallment(client, instFresh.id)
  );
  const planAfter = await withTransaction((client) =>
    getStudentBillingPlan(client, activated.plan.id)
  );
  if (
    planRelief.relief.status === 'POSTED' &&
    moneyEquals(instAfter.relief_amount, instFresh.amount) &&
    planAfter.plan.status === 'COMPLETED'
  ) {
    ok('9) installment relief_amount + plan COMPLETED');
  } else {
    fail('9) plan relief', {
      posted: planRelief.relief.status,
      relief: instAfter.relief_amount,
      status: planAfter.plan.status,
    });
  }

  // 10) void posted
  const voided = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return voidStudentRelief(client, {
      id: planRelief.relief.id,
      userId,
      version: planRelief.relief.version,
      updated_at: planRelief.relief.updated_at,
      reason: 'عكس للاختبار',
    });
  });
  const planReopened = await withTransaction((client) =>
    getStudentBillingPlan(client, activated.plan.id)
  );
  if (voided.status === 'VOID' && planReopened.plan.status === 'ACTIVE') {
    ok('10) void posted → plan ACTIVE');
  } else {
    fail('10) void reopen', { voided: voided.status, plan: planReopened.plan.status });
  }

  // 11) صلاحيات
  if (
    (await hasStudentReceivablesCapability(null, viewerId, STUDENT_RECEIVABLES_CAPABILITIES.RELIEFS_VIEW)) &&
    !(await hasStudentReceivablesCapability(null, viewerId, STUDENT_RECEIVABLES_CAPABILITIES.RELIEFS_POST))
  ) {
    ok('11a) viewer: view فقط');
  } else fail('11a) viewer caps');

  if (
    (await hasStudentReceivablesCapability(null, clerkId, STUDENT_RECEIVABLES_CAPABILITIES.RELIEFS_PREPARE)) &&
    !(await hasStudentReceivablesCapability(null, clerkId, STUDENT_RECEIVABLES_CAPABILITIES.RELIEFS_APPROVE))
  ) {
    ok('11b) clerk: prepare لا approve');
  } else fail('11b) clerk caps');

  if (
    (await hasStudentReceivablesCapability(null, approverId, STUDENT_RECEIVABLES_CAPABILITIES.RELIEFS_APPROVE)) &&
    !(await hasStudentReceivablesCapability(null, approverId, STUDENT_RECEIVABLES_CAPABILITIES.RELIEFS_POST))
  ) {
    ok('11c) approver: approve لا post');
  } else fail('11c) approver caps');

  if (await hasStudentReceivablesCapability(null, adminId, STUDENT_RECEIVABLES_CAPABILITIES.RELIEFS_POST)) {
    ok('11d) admin: post');
  } else fail('11d) admin caps');

  // 12) 401 بدون auth
  try {
    const req = new NextRequest('http://localhost/api/accounts/student-reliefs');
    const res = await requireAccountsAccess(req);
    if ('response' in res && res.response.status === 401) {
      ok('12) 401 بدون مصادقة');
    } else {
      fail('12) 401', res);
    }
  } catch (e) {
    fail('12) 401', e);
  }

  // 13) حساب معلّق يسمح بالتخفيض
  const suspStudent = await insertTestStudent(suffix, 'SUSP');
  const suspAccount = await withTransaction((client) =>
    createStudentAccount(client, {
      student_id: suspStudent,
      receivable_gl_account_id: recvGl,
      created_by: userId,
    })
  );
  const suspCharge = await postChargeOnAccount({
    accountId: suspAccount.id,
    studentId: suspStudent,
    feeTypeId: feeType.id,
    amount: '20000',
    userId,
    chargeDate: fiscal.chargeDate,
    description: 'معلق',
  });
  await withTransaction((client) =>
    suspendStudentAccount(client, {
      id: suspAccount.id,
      userId,
      version: suspAccount.version,
      updated_at: suspAccount.updated_at,
    })
  );
  const suspRelief = await withTransaction((client) =>
    createStudentRelief(client, {
      student_charge_id: suspCharge.id,
      relief_type_id: noApprovalType.id,
      requested_amount: '5000',
      reason: 'معلق مسموح',
      requested_by: userId,
    })
  );
  if (suspRelief.id) ok('13) SUSPENDED account يسمح بالتخفيض');

  // 14) صفحة الطباعة موجودة
  const printPath = path.join(
    process.cwd(),
    'app/accounts/students/reliefs/[id]/print/page.tsx'
  );
  if (fs.existsSync(printPath)) {
    ok('14) print page exists');
  } else {
    fail('14) print page');
  }

  // 15) verify
  const verify = await withTransaction((c) => verifyStudentReceivables(c));
  if (verify.details.reliefs_sum_ok) {
    ok('15) verify reliefs_sum_ok');
  } else {
    fail('15) reliefs_sum_ok');
  }
  if (
    verify.charge_subledger_match &&
    verify.orphans.journal_without_ledger.length === 0
  ) {
    ok('16) verify A↔B مع RELIEF');
  } else {
    fail('16) verify match', {
      match: verify.charge_subledger_match,
      orphans: verify.orphans,
    });
  }

  // 17) حجز submit: طلبان يتجاوزان outstanding — واحد فقط ينجح
  const raceStudent = await insertTestStudent(suffix, 'RACE');
  const raceAccount = await withTransaction((client) =>
    createStudentAccount(client, {
      student_id: raceStudent,
      receivable_gl_account_id: recvGl,
      created_by: userId,
    })
  );
  const raceCharge = await postChargeOnAccount({
    accountId: raceAccount.id,
    studentId: raceStudent,
    feeTypeId: feeType.id,
    amount: '50000',
    userId,
    chargeDate: fiscal.chargeDate,
    description: 'سباق',
  });
  const r1draft = await withTransaction((client) =>
    createStudentRelief(client, {
      student_charge_id: raceCharge.id,
      relief_type_id: noApprovalType.id,
      calculation_type: 'FIXED_AMOUNT',
      requested_amount: '30000',
      reason: 'سباق 1',
      requested_by: userId,
    })
  );
  const r2draft = await withTransaction((client) =>
    createStudentRelief(client, {
      student_charge_id: raceCharge.id,
      relief_type_id: noApprovalType.id,
      calculation_type: 'FIXED_AMOUNT',
      requested_amount: '30000',
      reason: 'سباق 2',
      requested_by: userId,
    })
  );
  const submitRace = await Promise.allSettled([
    withTransaction((client) =>
      submitStudentRelief(client, {
        id: r1draft.id,
        userId,
        version: r1draft.version,
        updated_at: r1draft.updated_at,
      })
    ),
    withTransaction((client) =>
      submitStudentRelief(client, {
        id: r2draft.id,
        userId,
        version: r2draft.version,
        updated_at: r2draft.updated_at,
      })
    ),
  ]);
  const submitOk = submitRace.filter((r) => r.status === 'fulfilled').length;
  const submitFail = submitRace.filter((r) => r.status === 'rejected').length;
  const reservedCount = await query(
    `SELECT COUNT(*)::int AS n,
            COALESCE(SUM(
              CASE WHEN status='APPROVED' THEN approved_amount
                   WHEN status='PENDING_APPROVAL' THEN requested_amount
                   ELSE 0 END
            ),0)::text AS reserved
     FROM accounts.student_reliefs
     WHERE student_charge_id = $1::uuid
       AND status IN ('APPROVED','PENDING_APPROVAL')`,
    [raceCharge.id]
  );
  const reservedMillis = moneyToMillis(
    normalizeMoneyInput(reservedCount.rows[0]?.reserved ?? '0')
  );
  if (
    submitOk === 1 &&
    submitFail === 1 &&
    reservedMillis <= moneyToMillis('50000')
  ) {
    ok('17) concurrent submit — حجز لا يتجاوز outstanding');
  } else {
    fail('17) concurrent submit reservation', {
      submitOk,
      submitFail,
      reserved: reservedCount.rows[0]?.reserved,
    });
  }

  const approvedRace = await query(
    `SELECT id, version, updated_at FROM accounts.student_reliefs
     WHERE student_charge_id = $1::uuid AND status = 'APPROVED' LIMIT 1`,
    [raceCharge.id]
  );
  if (approvedRace.rows[0]) {
    await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      return postStudentRelief(client, {
        id: approvedRace.rows[0].id as string,
        userId,
        version: approvedRace.rows[0].version,
        updated_at: approvedRace.rows[0].updated_at,
      });
    });
  }

  // 18) clerk لا يستطيع approve
  await expectHttp(
    '18) clerk لا approve',
    () =>
      assertStudentReceivablesCapability(
        null,
        clerkId,
        STUDENT_RECEIVABLES_CAPABILITIES.RELIEFS_APPROVE
      ),
    403
  );

  const finalCharge = await withTransaction((client) =>
    loadStudentCharge(client, raceCharge.id)
  );
  if (moneyEquals(finalCharge.outstanding_amount, '20000')) {
    ok('18b) رصيد المطالبة بعد سباق صحيح (20000)');
  } else {
    fail('18b) outstanding بعد ترحيل 30k', finalCharge.outstanding_amount);
  }

  // 18c) تعطيل النوع يمنع ترحيل APPROVED
  const deactStudent = await insertTestStudent(suffix, 'DEACT');
  const deactAccount = await withTransaction((client) =>
    createStudentAccount(client, {
      student_id: deactStudent,
      receivable_gl_account_id: recvGl,
      created_by: userId,
    })
  );
  const deactCharge = await postChargeOnAccount({
    accountId: deactAccount.id,
    studentId: deactStudent,
    feeTypeId: feeType.id,
    amount: '40000',
    userId,
    chargeDate: fiscal.chargeDate,
    description: 'تعطيل نوع',
  });
  const deactType = await withTransaction((client) =>
    createStudentReliefType(client, {
      code: `SRL-DEACT-${suffix}`,
      name_ar: 'للتتعطيل',
      relief_kind: 'DISCOUNT',
      calculation_type: 'FIXED_AMOUNT',
      default_value: '5000',
      gl_account_id: expGl,
      requires_approval: false,
      created_by: userId,
    })
  );
  const deactDraft = await withTransaction((client) =>
    createStudentRelief(client, {
      student_charge_id: deactCharge.id,
      relief_type_id: deactType.id,
      calculation_type: 'FIXED_AMOUNT',
      requested_amount: '5000',
      reason: 'قبل التعطيل',
      requested_by: userId,
    })
  );
  const deactApproved = await withTransaction((client) =>
    submitStudentRelief(client, {
      id: deactDraft.id,
      userId,
      version: deactDraft.version,
      updated_at: deactDraft.updated_at,
    })
  );
  await withTransaction((client) =>
    deactivateStudentReliefType(client, { id: deactType.id, userId })
  );
  await expectHttp(
    '18c) تعطيل النوع يمنع POST',
    () =>
      withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        return postStudentRelief(client, {
          id: deactApproved.id,
          userId,
          version: deactApproved.version,
          updated_at: deactApproved.updated_at,
        });
      }),
    409,
    'غير فعّال'
  );

  // 19) تحصيل + تخفيض متزامنان على نفس المطالبة
  const bankRow = await query(
    `SELECT id FROM accounts.bank_accounts
     WHERE currency_code = 'IQD' AND status = 'ACTIVE'
     ORDER BY CASE WHEN LOWER(code)=LOWER('DEMO-BA-IQD') THEN 0 ELSE 1 END, created_at
     LIMIT 1`
  );
  if (!bankRow.rows[0]) {
    fail('19) لا حساب بنكي IQD لسباق التحصيل+التخفيض');
  } else {
    const bankAccountId = bankRow.rows[0].id as string;
    const mixStudent = await insertTestStudent(suffix, 'MIX');
    const mixAccount = await withTransaction((client) =>
      createStudentAccount(client, {
        student_id: mixStudent,
        receivable_gl_account_id: recvGl,
        created_by: userId,
      })
    );
    const mixCharge = await postChargeOnAccount({
      accountId: mixAccount.id,
      studentId: mixStudent,
      feeTypeId: feeType.id,
      amount: '50000',
      userId,
      chargeDate: fiscal.chargeDate,
      description: 'مزيج تحصيل+تخفيض',
    });
    const mixReliefDraft = await withTransaction((client) =>
      createStudentRelief(client, {
        student_charge_id: mixCharge.id,
        relief_type_id: noApprovalType.id,
        calculation_type: 'FIXED_AMOUNT',
        requested_amount: '40000',
        reason: 'سباق مع تحصيل',
        requested_by: userId,
      })
    );
    const mixReliefReady = await withTransaction((client) =>
      submitStudentRelief(client, {
        id: mixReliefDraft.id,
        userId,
        version: mixReliefDraft.version,
        updated_at: mixReliefDraft.updated_at,
      })
    );
    const mixColDraft = await withTransaction((client) =>
      createStudentCollection(client, {
        student_account_id: mixAccount.id,
        collection_date: fiscal.chargeDate,
        amount: '40000',
        payment_method: 'BANK',
        bank_account_id: bankAccountId,
        description: `سباق تحصيل ${suffix}`,
        allocations: [
          {
            student_charge_id: mixCharge.id,
            allocated_amount: '40000',
          },
        ],
        created_by: userId,
      })
    );
    const mixRace = await Promise.allSettled([
      withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        const rel = await loadStudentRelief(client, mixReliefReady.id);
        return postStudentRelief(client, {
          id: rel.id,
          userId,
          version: rel.version,
          updated_at: rel.updated_at,
        });
      }),
      withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        return postStudentCollection(client, {
          id: mixColDraft.collection.id,
          userId,
          version: mixColDraft.collection.version,
          updated_at: mixColDraft.collection.updated_at,
        });
      }),
    ]);
    const mixFulfilled = mixRace.filter((r) => r.status === 'fulfilled').length;
    const mixRejected = mixRace.filter((r) => r.status === 'rejected').length;
    const mixAfter = await withTransaction((client) =>
      loadStudentCharge(client, mixCharge.id)
    );
    const outMillis = moneyToMillis(
      normalizeMoneyInput(mixAfter.outstanding_amount)
    );
    if (
      mixFulfilled >= 1 &&
      mixRejected >= 1 &&
      outMillis >= BigInt(0) &&
      outMillis <= moneyToMillis('50000')
    ) {
      ok('19) Collection + Relief متزامنان — لا رصيد سالب');
    } else if (
      mixFulfilled === 2 &&
      outMillis === moneyToMillis('0.000')
    ) {
      // 40k+40k على 50k لا يجب أن ينجحا معاً؛ إن نجحا فهذا فشل منطق
      fail('19) كلاهما نجح مع تجاوز محتمل', {
        outstanding: mixAfter.outstanding_amount,
      });
    } else {
      fail('19) سباق تحصيل+تخفيض', {
        mixFulfilled,
        mixRejected,
        outstanding: mixAfter.outstanding_amount,
      });
    }

    // 20) تسوية مختلطة متسلسلة: تحصيل ثم تخفيض
    const mix2Student = await insertTestStudent(suffix, 'MX2');
    const mix2Account = await withTransaction((client) =>
      createStudentAccount(client, {
        student_id: mix2Student,
        receivable_gl_account_id: recvGl,
        created_by: userId,
      })
    );
    const mix2Charge = await postChargeOnAccount({
      accountId: mix2Account.id,
      studentId: mix2Student,
      feeTypeId: feeType.id,
      amount: '100000',
      userId,
      chargeDate: fiscal.chargeDate,
      description: 'مختلط متسلسل',
    });
    const col2 = await withTransaction((client) =>
      createStudentCollection(client, {
        student_account_id: mix2Account.id,
        collection_date: fiscal.chargeDate,
        amount: '40000',
        payment_method: 'BANK',
        bank_account_id: bankAccountId,
        description: `Mixed ${suffix}`,
        allocations: [
          {
            student_charge_id: mix2Charge.id,
            allocated_amount: '40000',
          },
        ],
        created_by: userId,
      })
    );
    await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      return postStudentCollection(client, {
        id: col2.collection.id,
        userId,
        version: col2.collection.version,
        updated_at: col2.collection.updated_at,
      });
    });
    const rel2d = await withTransaction((client) =>
      createStudentRelief(client, {
        student_charge_id: mix2Charge.id,
        relief_type_id: noApprovalType.id,
        calculation_type: 'FIXED_AMOUNT',
        requested_amount: '35000',
        reason: 'بعد تحصيل',
        requested_by: userId,
      })
    );
    const rel2s = await withTransaction((client) =>
      submitStudentRelief(client, {
        id: rel2d.id,
        userId,
        version: rel2d.version,
        updated_at: rel2d.updated_at,
      })
    );
    await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      return postStudentRelief(client, {
        id: rel2s.id,
        userId,
        version: rel2s.version,
        updated_at: rel2s.updated_at,
      });
    });
    const afterMixed = await withTransaction((client) =>
      loadStudentCharge(client, mix2Charge.id)
    );
    if (moneyEquals(afterMixed.outstanding_amount, '25000')) {
      ok('20) paid + relief mixed → outstanding 25000');
    } else {
      fail('20) mixed settlement', afterMixed.outstanding_amount);
    }
  }

  console.log(`===== انتهى 5.C.1 — نجح ${passCount} · فشل ${failCount} =====`);
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
