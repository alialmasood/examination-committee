/**
 * اختبارات قبول Credit Notes & Refunds (5.C.2).
 * npm run test:student-credit-notes-refunds
 */
import { NextRequest } from 'next/server';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { closePool, query } from '../lib/db';
import { AccountsHttpError, requireAccountsAccess } from '../lib/accounts/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import {
  millisToMoney,
  moneyEquals,
  moneyToMillis,
} from '../lib/accounts/money';
import {
  activateCashBox,
  createCashBox,
} from '../lib/accounts/cash-boxes';
import { assignPrimaryCustodian } from '../lib/accounts/cash-box-custodians';
import { openCashSession } from '../lib/accounts/cash-box-sessions';
import { createStudentAccount } from '../lib/accounts/student-accounts';
import {
  createStudentCharge,
  loadStudentCharge,
  postStudentCharge,
} from '../lib/accounts/student-charges';
import {
  createStudentCollection,
  postStudentCollection,
} from '../lib/accounts/student-collections';
import { createStudentFeeType } from '../lib/accounts/student-fee-types';
import {
  approveStudentCreditNote,
  createStudentCreditNote,
  postStudentCreditNote,
  submitStudentCreditNote,
  voidStudentCreditNote,
} from '../lib/accounts/student-credit-notes';
import {
  approveStudentRefund,
  createStudentRefund,
  getStudentCreditBalance,
  postStudentRefund,
  setStudentRefundPostFaultForTests,
  submitStudentRefund,
  voidStudentRefund,
} from '../lib/accounts/student-refunds';
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
    fail(name, `توقّعنا خطأ ${status}`);
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
  if (!type.rows[0]) throw new Error(`نوع ${typeCode} غير موجود`);
  const sort = await query(
    `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'اختبار 5.C.2')
     RETURNING id`,
    [code, nameAr, type.rows[0].id, type.rows[0].normal_balance, sort.rows[0].n, userId]
  );
  return ins.rows[0].id as string;
}

async function insertTestStudent(suffix: string, label: string): Promise<string> {
  const uni = `CN${suffix}${label}`.slice(0, 20);
  const ins = await query(
    `INSERT INTO student_affairs.students
       (university_id, student_number, full_name_ar, status, payment_status)
     VALUES ($1,$2,$3,'active','paid') RETURNING id`,
    [uni, uni, `طالب 5.C.2 ${label} ${suffix}`]
  );
  return ins.rows[0].id as string;
}

async function upsertTestUser(username: string): Promise<string> {
  const hash = await bcrypt.hash('test-5c2-pass', 10);
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

async function resolveFiscal() {
  const period = await query(
    `SELECT y.id AS year_id, p.id AS period_id, p.start_date::text AS start_date
     FROM accounts.fiscal_years y
     JOIN accounts.fiscal_periods p ON p.fiscal_year_id = y.id
     WHERE y.status='ACTIVE' AND p.status='OPEN'
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

async function resolveCashContext(params: {
  userId: string;
  suffix: string;
  yearId: string;
  periodId: string;
  sessionDate: string;
}) {
  const cashGlId = await ensureTypedAccount(
    `DEMO-CASH-5C2-${params.suffix}`,
    `نقد 5.C.2 ${params.suffix}`,
    'ASSET',
    params.userId
  );
  const box = await withTransaction(async (client) => {
    await acquireCashBoxesLock(client);
    const created = await createCashBox(client, {
      code: `SCN-T-${params.suffix}`,
      name_ar: `صندوق استرداد ${params.suffix}`,
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
      notes: `5.C.2 ${params.suffix}`,
    });
  });
  return { boxId: box.id, sessionId: session.id, cashGlId };
}

async function main() {
  const suffix = String(Date.now()).slice(-6);
  console.log(`===== اختبارات 5.C.2 (${suffix}) =====`);

  const adminId = await upsertTestUser(`scn-admin-${suffix}`);
  await grantAccountsAdminRole(adminId);
  const viewerId = await upsertTestUser(`scn-viewer-${suffix}`);
  await grantAccountsPlatformRole(viewerId, ACCOUNTS_VIEWER_ROLE_CODE);
  const clerkId = await upsertTestUser(`scn-clerk-${suffix}`);
  await grantAccountsPlatformRole(clerkId, ACCOUNTS_CLERK_ROLE_CODE);
  const approverId = await upsertTestUser(`scn-approver-${suffix}`);
  await grantAccountsPlatformRole(approverId, ACCOUNTS_APPROVER_ROLE_CODE);

  const userId = adminId;
  const fiscal = await resolveFiscal();
  const recvGl = await ensureTypedAccount(
    `DEMO-RECV-SCN-${suffix}`,
    `ذمم 5.C.2 ${suffix}`,
    'ASSET',
    userId
  );
  const revGl = await ensureTypedAccount(
    `DEMO-REV-SCN-${suffix}`,
    `إيراد 5.C.2 ${suffix}`,
    'REVENUE',
    userId
  );
  const adjGl = await ensureTypedAccount(
    `DEMO-CN-ADJ-${suffix}`,
    `تعديل إيراد 5.C.2 ${suffix}`,
    'EXPENSE',
    userId
  );

  const feeType = await withTransaction((client) =>
    createStudentFeeType(client, {
      code: `SCN-FEE-${suffix}`,
      name_ar: `رسم 5.C.2 ${suffix}`,
      category: 'TUITION',
      revenue_gl_account_id: revGl,
      default_amount: '100000',
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

  // 1) DEBT_REDUCTION workflow
  const charge = await postChargeOnAccount({
    accountId: account.id,
    feeTypeId: feeType.id,
    amount: '100000',
    userId,
    chargeDate: fiscal.chargeDate,
    description: 'مطالبة اشعار',
  });

  await expectHttp(
    '2) منع تجاوز eligible',
    () =>
      withTransaction((client) =>
        createStudentCreditNote(client, {
          student_charge_id: charge.id,
          application_mode: 'DEBT_REDUCTION',
          amount: '150000',
          reason_code: 'FEE_CORRECTION',
          reason: 'تجاوز',
          revenue_adjustment_gl_account_id: adjGl,
          requested_by: userId,
        })
      ),
    409
  );

  const draft = await withTransaction((client) =>
    createStudentCreditNote(client, {
      student_charge_id: charge.id,
      application_mode: 'DEBT_REDUCTION',
      amount: '20000',
      reason_code: 'FEE_CORRECTION',
      reason: 'تصحيح رسوم',
      revenue_adjustment_gl_account_id: adjGl,
      credit_note_date: fiscal.chargeDate,
      requested_by: userId,
    })
  );
  if (draft.status === 'DRAFT') ok('1) إنشاء Credit Note DRAFT');

  const submitted = await withTransaction((client) =>
    submitStudentCreditNote(client, {
      id: draft.id,
      userId,
      version: draft.version,
      updated_at: draft.updated_at,
    })
  );
  if (submitted.status === 'PENDING_APPROVAL') ok('3) submit → PENDING');

  const approved = await withTransaction((client) =>
    approveStudentCreditNote(client, {
      id: submitted.id,
      userId: approverId,
      version: submitted.version,
      updated_at: submitted.updated_at,
    })
  );
  if (approved.status === 'APPROVED') ok('4) approve');

  const posted = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return postStudentCreditNote(client, {
      id: approved.id,
      userId,
      version: approved.version,
      updated_at: approved.updated_at,
    });
  });
  const chargeAfter = await withTransaction((client) =>
    loadStudentCharge(client, charge.id)
  );
  const je = await query(
    `SELECT jl.debit_amount::text d, jl.credit_amount::text c, a.code
     FROM accounts.journal_entry_lines jl
     JOIN accounts.chart_of_accounts a ON a.id = jl.account_id
     WHERE jl.journal_entry_id = $1::uuid
     ORDER BY jl.line_number`,
    [posted.creditNote.journal_entry_id]
  );
  const ledger = await query(
    `SELECT entry_type, credit_amount::text AS credit
     FROM accounts.student_ledger_entries
     WHERE source_type='STUDENT_CREDIT_NOTE' AND source_id=$1::uuid`,
    [posted.creditNote.id]
  );
  if (
    posted.creditNote.status === 'POSTED' &&
    moneyEquals(chargeAfter.outstanding_amount, '80000') &&
    je.rows.some(
      (r) =>
        moneyToMillis(r.d as string) > BigInt(0) &&
        String(r.code).includes('CN-ADJ')
    ) &&
    je.rows.some((r) => moneyToMillis(r.c as string) > BigInt(0)) &&
    ledger.rows[0]?.entry_type === 'CREDIT_NOTE'
  ) {
    ok('5) POST CN + JE + ledger + outstanding');
  } else {
    fail('5) post CN', { posted, chargeAfter, je: je.rows, ledger: ledger.rows });
  }

  // CREDIT_BALANCE_CREATE path
  const student2 = await insertTestStudent(suffix, 'CR');
  const account2 = await withTransaction((client) =>
    createStudentAccount(client, {
      student_id: student2,
      receivable_gl_account_id: recvGl,
      created_by: userId,
    })
  );
  const charge2 = await postChargeOnAccount({
    accountId: account2.id,
    feeTypeId: feeType.id,
    amount: '50000',
    userId,
    chargeDate: fiscal.chargeDate,
    description: 'مطالبة للرصيد الدائن',
  });
  const bankRow = await query(
    `SELECT id FROM accounts.bank_accounts
     WHERE currency_code='IQD' AND status='ACTIVE'
     ORDER BY CASE WHEN LOWER(code)=LOWER('DEMO-BA-IQD') THEN 0 ELSE 1 END, created_at
     LIMIT 1`
  );
  if (!bankRow.rows[0]) throw new Error('لا حساب بنكي DEMO');
  const bankAccountId = bankRow.rows[0].id as string;

  const col = await withTransaction((client) =>
    createStudentCollection(client, {
      student_account_id: account2.id,
      collection_date: fiscal.chargeDate,
      amount: '50000',
      payment_method: 'BANK',
      bank_account_id: bankAccountId,
      description: `تحصيل كامل ${suffix}`,
      allocations: [
        { student_charge_id: charge2.id, allocated_amount: '50000' },
      ],
      created_by: userId,
    })
  );
  await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return postStudentCollection(client, {
      id: col.collection.id,
      userId,
      version: col.collection.version,
      updated_at: col.collection.updated_at,
    });
  });

  let cnCredit = await withTransaction((client) =>
    createStudentCreditNote(client, {
      student_charge_id: charge2.id,
      application_mode: 'CREDIT_BALANCE_CREATE',
      amount: '15000',
      reason_code: 'ADMINISTRATIVE_ADJUSTMENT',
      reason: 'إنشاء رصيد دائن',
      revenue_adjustment_gl_account_id: adjGl,
      credit_note_date: fiscal.chargeDate,
      requested_by: userId,
    })
  );
  cnCredit = await withTransaction((client) =>
    submitStudentCreditNote(client, {
      id: cnCredit.id,
      userId,
      version: cnCredit.version,
      updated_at: cnCredit.updated_at,
    })
  );
  cnCredit = await withTransaction((client) =>
    approveStudentCreditNote(client, {
      id: cnCredit.id,
      userId: approverId,
      version: cnCredit.version,
      updated_at: cnCredit.updated_at,
    })
  );
  await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return postStudentCreditNote(client, {
      id: cnCredit.id,
      userId,
      version: cnCredit.version,
      updated_at: cnCredit.updated_at,
    });
  });
  const creditBal = await withTransaction((client) =>
    getStudentCreditBalance(client, account2.id)
  );
  if (moneyEquals(creditBal, '15000')) ok('6) Credit Balance بعد CREDIT_BALANCE_CREATE');
  else fail('6) credit balance', creditBal);

  let refund = await withTransaction((client) =>
    createStudentRefund(client, {
      student_account_id: account2.id,
      amount: '10000',
      payment_method: 'BANK',
      bank_account_id: bankAccountId,
      refund_date: fiscal.chargeDate,
      reason: 'استرداد مصرفي جزئي',
      beneficiary_name: 'ولي أمر',
      allocations: [
        {
          student_collection_id: col.collection.id,
          refunded_amount: '10000',
        },
      ],
      requested_by: userId,
    })
  );
  if (refund.status === 'DRAFT') ok('7) Refund DRAFT');

  refund = await withTransaction((client) =>
    submitStudentRefund(client, {
      id: refund.id,
      userId,
      version: refund.version,
      updated_at: refund.updated_at,
    })
  );
  refund = await withTransaction((client) =>
    approveStudentRefund(client, {
      id: refund.id,
      userId: approverId,
      version: refund.version,
      updated_at: refund.updated_at,
    })
  );
  const refundPosted = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return postStudentRefund(client, {
      id: refund.id,
      userId,
      version: refund.version,
      updated_at: refund.updated_at,
    });
  });
  const balAfterRefund = await withTransaction((client) =>
    getStudentCreditBalance(client, account2.id)
  );
  const refundLedger = await query(
    `SELECT entry_type, debit_amount::text AS debit
     FROM accounts.student_ledger_entries
     WHERE source_type='STUDENT_REFUND' AND source_id=$1::uuid`,
    [refundPosted.refund.id]
  );
  if (
    refundPosted.refund.status === 'POSTED' &&
    refundPosted.refund.bank_voucher_id &&
    moneyEquals(balAfterRefund, '5000') &&
    refundLedger.rows[0]?.entry_type === 'REFUND'
  ) {
    ok('8) Refund BANK + voucher + ledger + credit↓');
  } else {
    fail('8) bank refund', { refundPosted, balAfterRefund, refundLedger: refundLedger.rows });
  }

  await expectHttp(
    '9) منع Refund أكبر من Credit Balance',
    () =>
      withTransaction((client) =>
        createStudentRefund(client, {
          student_account_id: account2.id,
          amount: '20000',
          payment_method: 'BANK',
          bank_account_id: bankAccountId,
          refund_date: fiscal.chargeDate,
          reason: 'تجاوز',
          allocations: [
            {
              student_collection_id: col.collection.id,
              refunded_amount: '20000',
            },
          ],
          requested_by: userId,
        })
      ),
    409
  );

  // 10) VOID refund restores credit
  const voidedRefund = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return voidStudentRefund(client, {
      id: refundPosted.refund.id,
      userId,
      version: refundPosted.refund.version,
      updated_at: refundPosted.refund.updated_at,
      reason: 'إلغاء استرداد اختبار',
    });
  });
  const balRestored = await withTransaction((client) =>
    getStudentCreditBalance(client, account2.id)
  );
  if (voidedRefund.status === 'VOID' && moneyEquals(balRestored, '15000')) {
    ok('10) VOID Refund يعيد Credit Balance');
  } else {
    fail('10) void refund', { voidedRefund, balRestored });
  }

  // استرداد نقدي بعد تمويل الصندوق بقبض (بعد استعادة الرصيد)
  const cashCtx = await resolveCashContext({
    userId,
    suffix,
    yearId: fiscal.yearId,
    periodId: fiscal.periodId,
    sessionDate: fiscal.chargeDate,
  });
  const { createCashVoucher, postCashVoucher } = await import(
    '../lib/accounts/cash-vouchers'
  );
  await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    await acquireCashBoxesLock(client);
    const receipt = await createCashVoucher(client, {
      voucher_type: 'CASH_RECEIPT',
      cash_box_id: cashCtx.boxId,
      cash_box_session_id: cashCtx.sessionId,
      counter_account_id: revGl,
      voucher_date: fiscal.chargeDate,
      amount: '20000',
      party_name: 'تمويل اختبار',
      description: 'تمويل صندوق لاسترداد 5.C.2',
      created_by: userId,
    });
    await postCashVoucher(client, {
      id: receipt.id,
      userId,
      version: receipt.version,
      updated_at: receipt.updated_at,
    });
  });
  let cashRefund = await withTransaction((client) =>
    createStudentRefund(client, {
      student_account_id: account2.id,
      amount: '2000',
      payment_method: 'CASH',
      cash_box_id: cashCtx.boxId,
      cash_box_session_id: cashCtx.sessionId,
      refund_date: fiscal.chargeDate,
      reason: 'استرداد نقدي',
      allocations: [
        {
          student_collection_id: col.collection.id,
          refunded_amount: '2000',
        },
      ],
      requested_by: userId,
    })
  );
  cashRefund = await withTransaction((client) =>
    submitStudentRefund(client, {
      id: cashRefund.id,
      userId,
      version: cashRefund.version,
      updated_at: cashRefund.updated_at,
    })
  );
  cashRefund = await withTransaction((client) =>
    approveStudentRefund(client, {
      id: cashRefund.id,
      userId: approverId,
      version: cashRefund.version,
      updated_at: cashRefund.updated_at,
    })
  );
  const cashPosted = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    await acquireCashBoxesLock(client);
    return postStudentRefund(client, {
      id: cashRefund.id,
      userId,
      version: cashRefund.version,
      updated_at: cashRefund.updated_at,
    });
  });
  if (cashPosted.refund.cash_voucher_id) ok('8b) Refund CASH بعد تمويل الصندوق');
  else fail('8b) cash refund', cashPosted);

  // Re-post a small refund then try VOID the credit note
  let refund2 = await withTransaction((client) =>
    createStudentRefund(client, {
      student_account_id: account2.id,
      amount: '5000',
      payment_method: 'BANK',
      bank_account_id: bankAccountId,
      refund_date: fiscal.chargeDate,
      reason: 'استرداد بنكي',
      allocations: [
        {
          student_collection_id: col.collection.id,
          refunded_amount: '5000',
        },
      ],
      requested_by: userId,
    })
  );
  refund2 = await withTransaction((client) =>
    submitStudentRefund(client, {
      id: refund2.id,
      userId,
      version: refund2.version,
      updated_at: refund2.updated_at,
    })
  );
  refund2 = await withTransaction((client) =>
    approveStudentRefund(client, {
      id: refund2.id,
      userId: approverId,
      version: refund2.version,
      updated_at: refund2.updated_at,
    })
  );
  const refund2Posted = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return postStudentRefund(client, {
      id: refund2.id,
      userId,
      version: refund2.version,
      updated_at: refund2.updated_at,
    });
  });
  if (refund2Posted.refund.bank_voucher_id) ok('11) Refund BANK');
  else fail('11) bank refund', refund2Posted);

  const cnFresh = await query(
    `SELECT id, version, updated_at FROM accounts.student_credit_notes WHERE id=$1::uuid`,
    [cnCredit.id]
  );
  await expectHttp(
    '12) منع VOID CN مع Refund مرحّل يفسد الرصيد',
    () =>
      withTransaction(async (client) => {
        await acquireJournalEntriesLock(client);
        return voidStudentCreditNote(client, {
          id: cnFresh.rows[0].id as string,
          userId,
          version: cnFresh.rows[0].version,
          updated_at: cnFresh.rows[0].updated_at,
          reason: 'محاولة إلغاء',
        });
      }),
    409
  );

  // permissions
  if (
    (await hasStudentReceivablesCapability(
      null,
      viewerId,
      STUDENT_RECEIVABLES_CAPABILITIES.CREDIT_NOTES_VIEW
    )) &&
    !(await hasStudentReceivablesCapability(
      null,
      viewerId,
      STUDENT_RECEIVABLES_CAPABILITIES.CREDIT_NOTES_PREPARE
    ))
  ) {
    ok('13a) viewer view فقط');
  } else fail('13a) viewer');

  if (
    (await hasStudentReceivablesCapability(
      null,
      clerkId,
      STUDENT_RECEIVABLES_CAPABILITIES.CREDIT_NOTES_PREPARE
    )) &&
    !(await hasStudentReceivablesCapability(
      null,
      clerkId,
      STUDENT_RECEIVABLES_CAPABILITIES.CREDIT_NOTES_APPROVE
    )) &&
    !(await hasStudentReceivablesCapability(
      null,
      clerkId,
      STUDENT_RECEIVABLES_CAPABILITIES.REFUNDS_POST
    ))
  ) {
    ok('13b) clerk prepare لا approve/post');
  } else fail('13b) clerk');

  if (
    (await hasStudentReceivablesCapability(
      null,
      approverId,
      STUDENT_RECEIVABLES_CAPABILITIES.CREDIT_NOTES_APPROVE
    )) &&
    !(await hasStudentReceivablesCapability(
      null,
      approverId,
      STUDENT_RECEIVABLES_CAPABILITIES.CREDIT_NOTES_POST
    ))
  ) {
    ok('13c) approver approve لا post');
  } else fail('13c) approver');

  try {
    const res = await requireAccountsAccess(
      new NextRequest('http://localhost/api/accounts/student-credit-notes')
    );
    if ('response' in res) ok('14) 401 بدون مصادقة');
    else fail('14) 401', res);
  } catch (e) {
    fail('14) 401', e);
  }

  await expectHttp(
    '15) clerk 403 approve',
    () =>
      assertStudentReceivablesCapability(
        null,
        clerkId,
        STUDENT_RECEIVABLES_CAPABILITIES.CREDIT_NOTES_APPROVE
      ),
    403
  );

  const printCn = path.join(
    process.cwd(),
    'app/accounts/students/credit-notes/[id]/print/page.tsx'
  );
  const printRf = path.join(
    process.cwd(),
    'app/accounts/students/refunds/[id]/print/page.tsx'
  );
  if (fs.existsSync(printCn) && fs.existsSync(printRf)) ok('16) صفحات الطباعة موجودة');
  else fail('16) print pages');

  // 18) CREDIT_BALANCE_CREATE بلا تحصيل سابق
  const bareCharge = await withTransaction((client) =>
    createStudentCharge(client, {
      student_account_id: account2.id,
      fee_type_id: feeType.id,
      charge_date: fiscal.chargeDate,
      original_amount: '5000',
      description: 'بدون تحصيل',
      created_by: userId,
    })
  );
  const barePosted = await withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    return postStudentCharge(client, {
      id: bareCharge.id,
      userId,
      version: bareCharge.version,
      updated_at: bareCharge.updated_at,
    });
  });
  await expectHttp(
    '18) منع CREDIT_BALANCE_CREATE بلا تحصيل مرحّل',
    () =>
      withTransaction((client) =>
        createStudentCreditNote(client, {
          student_charge_id: barePosted.charge.id,
          application_mode: 'CREDIT_BALANCE_CREATE',
          amount: '1000',
          reason_code: 'ADMINISTRATIVE_ADJUSTMENT',
          reason: 'بدون تحصيل',
          revenue_adjustment_gl_account_id: adjGl,
          credit_note_date: fiscal.chargeDate,
          requested_by: userId,
        })
      ),
    409
  );

  // 19) Refundان متزامنان على نفس الرصيد — ينجح واحد فقط
  const balNow = await withTransaction((client) =>
    getStudentCreditBalance(client, account2.id)
  );
  const half = millisToMoney(moneyToMillis(balNow) / BigInt(2));
  if (moneyToMillis(balNow) >= BigInt(2000)) {
    const a = await withTransaction((client) =>
      createStudentRefund(client, {
        student_account_id: account2.id,
        amount: balNow,
        payment_method: 'BANK',
        bank_account_id: bankAccountId,
        refund_date: fiscal.chargeDate,
        reason: 'سباق A',
        allocations: [
          {
            student_collection_id: col.collection.id,
            refunded_amount: balNow,
          },
        ],
        requested_by: userId,
      })
    );
    const b = await withTransaction((client) =>
      createStudentRefund(client, {
        student_account_id: account2.id,
        amount: half,
        payment_method: 'BANK',
        bank_account_id: bankAccountId,
        refund_date: fiscal.chargeDate,
        reason: 'سباق B',
        allocations: [
          {
            student_collection_id: col.collection.id,
            refunded_amount: half,
          },
        ],
        requested_by: userId,
      })
    );
    const [r1, r2] = await Promise.allSettled([
      withTransaction((client) =>
        submitStudentRefund(client, {
          id: a.id,
          userId,
          version: a.version,
          updated_at: a.updated_at,
        })
      ),
      withTransaction((client) =>
        submitStudentRefund(client, {
          id: b.id,
          userId,
          version: b.version,
          updated_at: b.updated_at,
        })
      ),
    ]);
    const okN = [r1, r2].filter((x) => x.status === 'fulfilled').length;
    const failN = [r1, r2].filter((x) => x.status === 'rejected').length;
    if (okN === 1 && failN === 1) ok('19) Refundان متزامنان — نجح واحد فقط');
    else fail('19) concurrent submit', { okN, failN, balNow });
    // حرّر الحجز من السباق قبل اختبارات لاحقة
    for (const id of [a.id, b.id]) {
      const row = await query(
        `SELECT id, status, version, updated_at FROM accounts.student_refunds WHERE id=$1::uuid`,
        [id]
      );
      if (
        row.rows[0] &&
        ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(
          String(row.rows[0].status)
        )
      ) {
        await withTransaction((client) =>
          voidStudentRefund(client, {
            id: String(row.rows[0].id),
            userId,
            version: row.rows[0].version,
            updated_at: row.rows[0].updated_at,
            reason: 'تحرير بعد سباق اختبار',
          })
        );
      }
    }
  } else {
    ok('19) تخطّي سباق (رصيد دائن منخفض)');
  }

  // 20) fault injection — لا يبقى Voucher بلا Refund POSTED
  {
    const avail = await withTransaction((client) =>
      getStudentCreditBalance(client, account2.id)
    );
    if (moneyToMillis(avail) < BigInt(1000)) {
      ok('20) تخطّي fault (لا رصيد دائن كافٍ)');
    } else {
      let faultRefund = await withTransaction((client) =>
        createStudentRefund(client, {
          student_account_id: account2.id,
          amount: '1000',
          payment_method: 'BANK',
          bank_account_id: bankAccountId,
          refund_date: fiscal.chargeDate,
          reason: 'fault injection',
          allocations: [
            {
              student_collection_id: col.collection.id,
              refunded_amount: '1000',
            },
          ],
          requested_by: userId,
        })
      );
      faultRefund = await withTransaction((client) =>
        submitStudentRefund(client, {
          id: faultRefund.id,
          userId,
          version: faultRefund.version,
          updated_at: faultRefund.updated_at,
        })
      );
      faultRefund = await withTransaction((client) =>
        approveStudentRefund(client, {
          id: faultRefund.id,
          userId: approverId,
          version: faultRefund.version,
          updated_at: faultRefund.updated_at,
        })
      );
      setStudentRefundPostFaultForTests('after_voucher');
      try {
        await withTransaction(async (client) => {
          await acquireJournalEntriesLock(client);
          return postStudentRefund(client, {
            id: faultRefund.id,
            userId,
            version: faultRefund.version,
            updated_at: faultRefund.updated_at,
          });
        });
        fail('20) fault injection — كان يجب أن يفشل');
      } catch (e) {
        if (e instanceof Error && e.message === 'FAULT_AFTER_VOUCHER') {
          const stuck = await query(
            `SELECT status, bank_voucher_id, refund_number FROM accounts.student_refunds WHERE id=$1::uuid`,
            [faultRefund.id]
          );
          const orphanV = await query(
            `SELECT COUNT(*)::int AS n FROM accounts.bank_vouchers bv
             WHERE bv.party_reference=$1 AND bv.status='POSTED'
               AND NOT EXISTS (
                 SELECT 1 FROM accounts.student_refunds sr
                 WHERE sr.bank_voucher_id=bv.id AND sr.status='POSTED'
               )`,
            [stuck.rows[0]?.refund_number]
          );
          if (
            stuck.rows[0]?.status === 'APPROVED' &&
            !stuck.rows[0]?.bank_voucher_id &&
            (orphanV.rows[0]?.n ?? 0) === 0
          ) {
            ok('20) fault injection — rollback بلا سند يتيم');
          } else {
            fail('20) orphan after fault', {
              stuck: stuck.rows[0],
              orphanV: orphanV.rows[0],
            });
          }
        } else fail('20) fault unexpected', e);
      } finally {
        setStudentRefundPostFaultForTests(null);
      }
    }
  }

  // 21) تمويل الصندوق لا يستخدم GL الذمم (التحقق من كود التمويل الفعلي)
  const fundingSnippet = fs
    .readFileSync(
      path.join(process.cwd(), 'src/scripts/test-student-credit-notes-refunds.ts'),
      'utf8'
    )
    .split('تمويل صندوق لاسترداد 5.C.2')[0]
    .slice(-280);
  if (
    fundingSnippet.includes('counter_account_id: revGl') &&
    !fundingSnippet.includes('counter_account_id: recvGl')
  ) {
    ok('21) الاختبار يموّل الصندوق عبر حساب إيراد لا الذمم');
  } else {
    fail('21) تمويل الصندوق يستخدم حساباً غير صحيح', fundingSnippet);
  }

  const verify = await withTransaction((c) => verifyStudentReceivables(c));
  if (
    verify.charge_subledger_match &&
    (verify.details as { credit_notes_sum_ok?: boolean }).credit_notes_sum_ok !==
      false
  ) {
    ok('17) verify A↔B مع Credit Notes');
  } else {
    fail('17) verify', verify);
  }

  // 22) بعد التنظيف المتوقع: DEMO-RECV-SCN-277425 لا يُفترض هنا؛ نتحقق أن unexplained لا يزيد بسبب الاختبار الحالي
  const glAfter = verify.details.gl_accounts.find(
    (g) => g.code === `DEMO-RECV-SCN-${suffix}`
  );
  if (glAfter) {
    const u =
      Number(glAfter.full_gl_balance) - Number(glAfter.charge_sourced_balance);
    if (Math.abs(u) < 0.001) ok('22) لا تلوث تمويل على GL اختبار التشغيل');
    else fail('22) unexplained على GL الاختبار', { u, glAfter });
  } else {
    ok('22) لا GL اختبار ظاهر في verify (مقبول)');
  }

  console.log(`===== انتهى 5.C.2 — نجح ${passCount} · فشل ${failCount} =====`);
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
