/**
 * اختبارات سندات القبض والصرف المصرفي (4.B).
 * npm run test:bank-vouchers
 */
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { generateAccessToken } from '../lib/auth';
import { AccountsHttpError, requireAccountsAccess } from '../lib/accounts/auth';
import { writeFinancialAudit } from '../lib/accounts/audit';
import { getAccountBookBalance } from '../lib/accounts/account-book-balance';
import {
  assertCanPostBankAccount,
  assertCanPrepareBankAccount,
  assertCanViewBankAccount,
  isPrivilegedAccountsUsername,
} from '../lib/accounts/bank-account-access';
import {
  assignBankAccountUser,
  createBankAccount,
  removeBankAccountUser,
  suspendBankAccount,
} from '../lib/accounts/bank-accounts';
import { createBank } from '../lib/accounts/banks';
import { createBankBranch } from '../lib/accounts/bank-branches';
import {
  assertBankAccountOperational,
  calculateBankAccountBookBalance,
  createBankVoucher,
  postBankVoucher,
  updateBankVoucher,
  voidBankVoucher,
} from '../lib/accounts/bank-vouchers';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import { normalizeMoneyInput } from '../lib/accounts/money';
import {
  acquireBanksLock,
  acquireJournalEntriesLock,
  txQuery,
  withTransaction,
} from '../lib/accounts/with-transaction';

function ok(name: string) {
  console.log(`✅ ${name}`);
}
function fail(name: string, err?: unknown) {
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
    fail(name, `توقّعنا ${status}`);
  } catch (e) {
    if (e instanceof AccountsHttpError && e.status === status) {
      if (includes && !e.message.includes(includes)) {
        fail(name, e.message);
        return;
      }
      ok(name);
      return;
    }
    fail(name, e);
  }
}

async function ensureFreeAsset(code: string, nameAr: string, userId: string) {
  const existing = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a WHERE LOWER(a.code)=LOWER($1)`,
    [code]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;

  const type = await query(
    `SELECT id, normal_balance FROM accounts.account_types WHERE code='ASSET'`
  );
  const sort = await query(
    `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'حساب اختبار سندات بنكية')
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

async function main() {
  // 30) 401 بدون توكن
  {
    const req = new NextRequest('http://localhost/api/accounts/bank-vouchers');
    const a = await requireAccountsAccess(req);
    if ('response' in a && a.response.status === 401) ok('30) 401 بدون توكن');
    else fail('30) 401', a);
  }

  // 31) 403 دون ACCOUNTS
  {
    const other = await query(
      `SELECT u.id, u.username FROM student_affairs.users u
       WHERE u.is_active
         AND NOT EXISTS (
           SELECT 1 FROM student_affairs.user_systems us
           JOIN student_affairs.systems s ON s.id = us.system_id
           WHERE us.user_id = u.id AND s.code = 'ACCOUNTS'
         )
       LIMIT 1`
    );
    if (other.rows[0]) {
      const token = generateAccessToken(
        other.rows[0].id as string,
        other.rows[0].username as string
      );
      const req = new NextRequest('http://localhost/api/accounts/bank-vouchers', {
        headers: { cookie: `access_token=${token}` },
      });
      const a = await requireAccountsAccess(req);
      if ('response' in a && a.response.status === 403) {
        ok('31) 403 دون نظام ACCOUNTS');
      } else fail('31) 403', a);
    } else ok('31) تخطّي 403 (لا مستخدم بلا ACCOUNTS)');
  }

  const table = await query(`SELECT to_regclass('accounts.bank_vouchers') AS t`);
  if (!table.rows[0]?.t) throw new Error('شغّل npm run migrate (068)');

  // تفضيل مستخدم accounts (privileged)
  let userRes = await query(
    `SELECT u.id, u.username FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id = u.id
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE s.code = 'ACCOUNTS' AND u.is_active
       AND LOWER(u.username) = 'accounts'
     LIMIT 1`
  );
  if (!userRes.rows[0]) {
    userRes = await query(
      `SELECT u.id, u.username FROM student_affairs.users u
       JOIN student_affairs.user_systems us ON us.user_id = u.id
       JOIN student_affairs.systems s ON s.id = us.system_id
       WHERE s.code = 'ACCOUNTS' AND u.is_active LIMIT 1`
    );
  }
  if (!userRes.rows[0]) throw new Error('يلزم مستخدم ACCOUNTS');
  const userId = userRes.rows[0].id as string;
  const username = userRes.rows[0].username as string;

  const year = await query(
    `SELECT id FROM accounts.fiscal_years WHERE status = 'ACTIVE' ORDER BY is_default DESC LIMIT 1`
  );
  if (!year.rows[0]) throw new Error('لا سنة ACTIVE');
  const yearId = year.rows[0].id as string;
  const period = await query(
    `SELECT id, start_date::text AS start_date, end_date::text AS end_date
     FROM accounts.fiscal_periods WHERE fiscal_year_id = $1 AND status = 'OPEN'
     ORDER BY period_number LIMIT 1`,
    [yearId]
  );
  if (!period.rows[0]) throw new Error('لا فترة OPEN');
  const entryDate = pgDateOnly(period.rows[0].start_date as string);
  const periodEnd = pgDateOnly(period.rows[0].end_date as string);
  function offsetDate(days: number) {
    const d = new Date(`${entryDate}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const iso = d.toISOString().slice(0, 10);
    return iso > periodEnd ? periodEnd : iso;
  }
  const vDate = offsetDate(10);

  const suffix = Date.now().toString(36).toUpperCase();
  const glMain = await ensureFreeAsset(`BV-GL-${suffix}`, 'GL سندات رئيسي', userId);
  const glNoRcpt = await ensureFreeAsset(`BV-GL-NR-${suffix}`, 'GL بلا قبض', userId);
  const glNoPay = await ensureFreeAsset(`BV-GL-NP-${suffix}`, 'GL بلا صرف', userId);
  const glOpen = await ensureFreeAsset(`BV-GL-OP-${suffix}`, 'GL رصيد مرجعي', userId);
  const glSusp = await ensureFreeAsset(`BV-GL-SU-${suffix}`, 'GL معلّق', userId);

  const receiptCounter = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code IN ('REVENUE','LIABILITY','ASSET') AND NOT a.is_group
       AND a.allow_posting AND a.is_active AND NOT a.requires_cost_center
       AND a.id <> $1::uuid
     ORDER BY CASE t.code WHEN 'REVENUE' THEN 0 WHEN 'LIABILITY' THEN 1 ELSE 2 END, a.code
     LIMIT 1`,
    [glMain]
  );
  const paymentCounter = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code IN ('EXPENSE','ASSET') AND NOT a.is_group
       AND a.allow_posting AND a.is_active AND NOT a.requires_cost_center
       AND a.id <> $1::uuid AND a.id <> $2::uuid
     ORDER BY CASE t.code WHEN 'EXPENSE' THEN 0 ELSE 1 END, a.code
     LIMIT 1`,
    [glMain, receiptCounter.rows[0]?.id ?? glMain]
  );
  if (!receiptCounter.rows[0] || !paymentCounter.rows[0]) {
    throw new Error('يلزم حساب مقابل للقبض والصرف');
  }
  const receiptAcc = receiptCounter.rows[0].id as string;
  const paymentAcc = paymentCounter.rows[0].id as string;

  const groupAcc = await query(
    `SELECT id FROM accounts.chart_of_accounts WHERE is_group = TRUE AND is_active LIMIT 1`
  );
  const ccRequired = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     WHERE a.requires_cost_center AND NOT a.is_group AND a.allow_posting AND a.is_active
     LIMIT 1`
  );
  const activeCc = await query(
    `SELECT id FROM accounts.cost_centers WHERE is_active AND NOT is_group LIMIT 1`
  );

  const createdBankIds: string[] = [];
  const createdBranchIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdVoucherIds: string[] = [];
  let limUserId: string | null = null;
  let limUserCreated = false;

  try {
    const bank = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBank(client, {
        code: `BV-BNK-${suffix}`,
        name_ar: `مصرف سندات ${suffix}`,
        created_by: userId,
      });
    });
    createdBankIds.push(bank.id);

    const branch = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankBranch(client, {
        bank_id: bank.id,
        code: `BV-BR-${suffix}`,
        name_ar: 'فرع اختبار سندات',
        created_by: userId,
      });
    });
    createdBranchIds.push(branch.id);

    const mainBa = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankAccount(client, {
        code: `BV-BA-${suffix}`,
        bank_id: bank.id,
        bank_branch_id: branch.id,
        account_name_ar: 'حساب سندات رئيسي',
        account_number: `BV${suffix}01`,
        currency_code: 'IQD',
        gl_account_id: glMain,
        allows_receipts: true,
        allows_payments: true,
        created_by: userId,
      });
    });
    createdAccountIds.push(mainBa.id);

    // تعيين privileged flow للمستخدم accounts (حتى لو يتجاوز)
    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return assignBankAccountUser(client, {
        bank_account_id: mainBa.id,
        user_id: userId,
        can_view: true,
        can_prepare: true,
        can_post: true,
        created_by: userId,
      });
    });

    // حساب بلا قبض
    const noRcptBa = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankAccount(client, {
        code: `BV-BA-NR-${suffix}`,
        bank_id: bank.id,
        account_name_ar: 'بلا قبض',
        account_number: `BV${suffix}02`,
        gl_account_id: glNoRcpt,
        allows_receipts: false,
        allows_payments: true,
        created_by: userId,
      });
    });
    createdAccountIds.push(noRcptBa.id);

    // حساب بلا صرف
    const noPayBa = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankAccount(client, {
        code: `BV-BA-NP-${suffix}`,
        bank_id: bank.id,
        account_name_ar: 'بلا صرف',
        account_number: `BV${suffix}03`,
        gl_account_id: glNoPay,
        allows_receipts: true,
        allows_payments: false,
        created_by: userId,
      });
    });
    createdAccountIds.push(noPayBa.id);

    // حساب رصيد افتتاحي مرجعي
    const openBa = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankAccount(client, {
        code: `BV-BA-OP-${suffix}`,
        bank_id: bank.id,
        account_name_ar: 'رصيد مرجعي',
        account_number: `BV${suffix}04`,
        gl_account_id: glOpen,
        opening_balance_reference: '9999.000',
        opening_balance_date: entryDate,
        created_by: userId,
      });
    });
    createdAccountIds.push(openBa.id);

    // حساب للتعليق
    let suspBa = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankAccount(client, {
        code: `BV-BA-SU-${suffix}`,
        bank_id: bank.id,
        account_name_ar: 'معلّق لاحقاً',
        account_number: `BV${suffix}05`,
        gl_account_id: glSusp,
        created_by: userId,
      });
    });
    createdAccountIds.push(suspBa.id);

    // ——— 1) BANK_RECEIPT DRAFT ———
    let receipt = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankVoucher(client, {
        voucher_type: 'BANK_RECEIPT',
        bank_account_id: mainBa.id,
        counter_account_id: receiptAcc,
        voucher_date: vDate,
        amount: '200',
        party_name: 'جهة اختبار',
        description: `قبض اختبار ${suffix}`,
        created_by: userId,
      });
    });
    createdVoucherIds.push(receipt.id);
    if (receipt.status === 'DRAFT' && receipt.voucher_type === 'BANK_RECEIPT') {
      ok('1) إنشاء BANK_RECEIPT DRAFT');
    } else fail('1)', receipt);

    // ——— 2) BANK_PAYMENT DRAFT ———
    let payment = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankVoucher(client, {
        voucher_type: 'BANK_PAYMENT',
        bank_account_id: mainBa.id,
        counter_account_id: paymentAcc,
        voucher_date: vDate,
        amount: '50',
        description: `صرف اختبار ${suffix}`,
        created_by: userId,
      });
    });
    createdVoucherIds.push(payment.id);
    if (payment.status === 'DRAFT' && payment.voucher_type === 'BANK_PAYMENT') {
      ok('2) إنشاء BANK_PAYMENT DRAFT');
    } else fail('2)', payment);

    // ——— 3) Update DRAFT ———
    receipt = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return updateBankVoucher(client, {
        id: receipt.id,
        userId,
        version: receipt.version,
        updated_at: receipt.updated_at,
        amount: '250',
        description: `قبض معدّل ${suffix}`,
      });
    });
    if (normalizeMoneyInput(receipt.amount) === '250.000') ok('3) تعديل DRAFT');
    else fail('3)', receipt.amount);

    // ——— 4) Unique BRV/BPV ———
    if (
      receipt.voucher_number.startsWith('BRV-') &&
      payment.voucher_number.startsWith('BPV-') &&
      receipt.voucher_number !== payment.voucher_number
    ) {
      ok('4) ترقيم BRV/BPV فريد');
    } else fail('4)', { r: receipt.voucher_number, p: payment.voucher_number });

    // ——— 5) Reject non-ACTIVE ———
    suspBa = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const fresh = await txQuery(
        client,
        `SELECT version, updated_at::text AS updated_at FROM accounts.bank_accounts WHERE id=$1`,
        [suspBa.id]
      );
      return suspendBankAccount(client, {
        id: suspBa.id,
        userId,
        version: fresh.rows[0].version,
        updated_at: fresh.rows[0].updated_at,
      });
    });
    await expectHttp(
      '5) رفض حساب غير ACTIVE',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankVoucher(client, {
            voucher_type: 'BANK_RECEIPT',
            bank_account_id: suspBa.id,
            counter_account_id: receiptAcc,
            voucher_date: vDate,
            amount: '10',
            description: 'مرفوض معلّق',
            created_by: userId,
          });
        }),
      409
    );

    // ——— 6) allows_receipts=false ———
    await expectHttp(
      '6) رفض قبض عند allows_receipts=false',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankVoucher(client, {
            voucher_type: 'BANK_RECEIPT',
            bank_account_id: noRcptBa.id,
            counter_account_id: receiptAcc,
            voucher_date: vDate,
            amount: '10',
            description: 'مرفوض قبض',
            created_by: userId,
          });
        }),
      409,
      'لا يسمح بسندات القبض'
    );

    // ——— 7) allows_payments=false ———
    await expectHttp(
      '7) رفض صرف عند allows_payments=false',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankVoucher(client, {
            voucher_type: 'BANK_PAYMENT',
            bank_account_id: noPayBa.id,
            counter_account_id: paymentAcc,
            voucher_date: vDate,
            amount: '10',
            description: 'مرفوض صرف',
            created_by: userId,
          });
        }),
      409,
      'لا يسمح بسندات الصرف'
    );

    // ——— 8) Currency mismatch ———
    await expectHttp(
      '8) رفض اختلاف العملة',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankVoucher(client, {
            voucher_type: 'BANK_RECEIPT',
            bank_account_id: mainBa.id,
            counter_account_id: receiptAcc,
            voucher_date: vDate,
            amount: '10',
            currency_code: 'USD',
            description: 'عملة خاطئة',
            created_by: userId,
          });
        }),
      409,
      'عملة'
    );

    // ——— 9) Counter = bank GL ———
    await expectHttp(
      '9) رفض المقابل = GL البنك',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankVoucher(client, {
            voucher_type: 'BANK_RECEIPT',
            bank_account_id: mainBa.id,
            counter_account_id: glMain,
            voucher_date: vDate,
            amount: '10',
            description: 'مقابل ذاتي',
            created_by: userId,
          });
        }),
      400
    );

    // ——— 10) Group counter ———
    if (groupAcc.rows[0]) {
      await expectHttp(
        '10) رفض حساب تجميعي كمقابل',
        () =>
          withTransaction(async (client) => {
            await acquireBanksLock(client);
            return createBankVoucher(client, {
              voucher_type: 'BANK_RECEIPT',
              bank_account_id: mainBa.id,
              counter_account_id: groupAcc.rows[0].id,
              voucher_date: vDate,
              amount: '5',
              description: 'تجميعي',
              created_by: userId,
            });
          }),
        400
      );
    } else ok('10) تخطّي الحساب التجميعي');

    // ——— 11) Cost center required ———
    if (ccRequired.rows[0]) {
      await expectHttp(
        '11) مركز كلفة مطلوب عند اشتراط الحساب',
        () =>
          withTransaction(async (client) => {
            await acquireBanksLock(client);
            return createBankVoucher(client, {
              voucher_type: 'BANK_RECEIPT',
              bank_account_id: mainBa.id,
              counter_account_id: ccRequired.rows[0].id,
              voucher_date: vDate,
              amount: '5',
              description: 'بدون مركز كلفة',
              created_by: userId,
            });
          }),
        409,
        'مركز كلفة'
      );
      if (activeCc.rows[0]) {
        const withCc = await withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankVoucher(client, {
            voucher_type: 'BANK_RECEIPT',
            bank_account_id: mainBa.id,
            counter_account_id: ccRequired.rows[0].id,
            cost_center_id: activeCc.rows[0].id,
            voucher_date: vDate,
            amount: '5',
            description: `مع مركز كلفة ${suffix}`,
            created_by: userId,
          });
        });
        createdVoucherIds.push(withCc.id);
        ok('11b) إنشاء سند مع مركز كلفة عند الاشتراط');
      }
    } else ok('11) تخطّي مركز الكلفة (لا حساب يتطلبه)');

    // ——— 14 first: insufficient balance before funding ———
    await expectHttp(
      '14) رفض صرف برصيد غير كافٍ',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          await acquireJournalEntriesLock(client);
          return postBankVoucher(client, {
            id: payment.id,
            userId,
            version: payment.version,
            updated_at: payment.updated_at,
          });
        }),
      409,
      'غير كافٍ'
    );

    // ——— 12) Post receipt ———
    const postedR = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      await acquireJournalEntriesLock(client);
      return postBankVoucher(client, {
        id: receipt.id,
        userId,
        version: receipt.version,
        updated_at: receipt.updated_at,
      });
    });
    receipt = postedR.voucher;
    if (receipt.status === 'POSTED' && receipt.journal_entry_id) {
      ok('12) ترحيل قبض Dr Bank / Cr Counter');
    } else fail('12) ترحيل قبض', receipt);

    const linesR = await query(
      `SELECT account_id::text, debit_amount::text, credit_amount::text
       FROM accounts.journal_entry_lines WHERE journal_entry_id = $1`,
      [receipt.journal_entry_id]
    );
    const debitBank = linesR.rows.find(
      (l) => l.account_id === glMain && Number(l.debit_amount) > 0
    );
    const creditCounter = linesR.rows.find(
      (l) => l.account_id === receiptAcc && Number(l.credit_amount) > 0
    );
    if (debitBank && creditCounter) ok('12b) تحقق أسطر قيد القبض');
    else fail('12b) أسطر قبض', linesR.rows);

    // ——— 13) Post payment (now funded) ———
    // refresh payment version (unchanged but safe)
    const payFresh = await query(
      `SELECT id, version, updated_at::text AS updated_at FROM accounts.bank_vouchers WHERE id=$1`,
      [payment.id]
    );
    const postedP = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      await acquireJournalEntriesLock(client);
      return postBankVoucher(client, {
        id: payment.id,
        userId,
        version: payFresh.rows[0].version,
        updated_at: payFresh.rows[0].updated_at,
      });
    });
    payment = postedP.voucher;
    if (payment.status === 'POSTED' && payment.journal_entry_id) {
      ok('13) ترحيل صرف Dr Counter / Cr Bank');
    } else fail('13)', payment);

    const linesP = await query(
      `SELECT account_id::text, debit_amount::text, credit_amount::text
       FROM accounts.journal_entry_lines WHERE journal_entry_id = $1`,
      [payment.journal_entry_id]
    );
    const debitExp = linesP.rows.find(
      (l) => l.account_id === paymentAcc && Number(l.debit_amount) > 0
    );
    const creditBank = linesP.rows.find(
      (l) => l.account_id === glMain && Number(l.credit_amount) > 0
    );
    if (debitExp && creditBank) ok('13b) تحقق أسطر قيد الصرف');
    else fail('13b) أسطر صرف', linesP.rows);

    // ——— 15) Concurrent payments ———
    const fund = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const v = await createBankVoucher(client, {
        voucher_type: 'BANK_RECEIPT',
        bank_account_id: mainBa.id,
        counter_account_id: receiptAcc,
        voucher_date: vDate,
        amount: '1000',
        description: `تمويل تزامن ${suffix}`,
        created_by: userId,
      });
      await acquireJournalEntriesLock(client);
      return postBankVoucher(client, {
        id: v.id,
        userId,
        version: v.version,
        updated_at: v.updated_at,
      });
    });
    createdVoucherIds.push(fund.voucher.id);

    const balBeforeConc = await withTransaction(async (client) =>
      calculateBankAccountBookBalance(client, mainBa.id)
    );
    const halfPlus = normalizeMoneyInput(
      String(Math.floor(Number(balBeforeConc.book_balance) / 2) + 1)
    );

    const c1 = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankVoucher(client, {
        voucher_type: 'BANK_PAYMENT',
        bank_account_id: mainBa.id,
        counter_account_id: paymentAcc,
        voucher_date: vDate,
        amount: halfPlus,
        description: `تزامن صرف1 ${suffix}`,
        created_by: userId,
      });
    });
    const c2 = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankVoucher(client, {
        voucher_type: 'BANK_PAYMENT',
        bank_account_id: mainBa.id,
        counter_account_id: paymentAcc,
        voucher_date: vDate,
        amount: halfPlus,
        description: `تزامن صرف2 ${suffix}`,
        created_by: userId,
      });
    });
    createdVoucherIds.push(c1.id, c2.id);

    const conc = await Promise.allSettled([
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        await acquireJournalEntriesLock(client);
        return postBankVoucher(client, {
          id: c1.id,
          userId,
          version: c1.version,
          updated_at: c1.updated_at,
        });
      }),
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        await acquireJournalEntriesLock(client);
        return postBankVoucher(client, {
          id: c2.id,
          userId,
          version: c2.version,
          updated_at: c2.updated_at,
        });
      }),
    ]);
    const concOk = conc.filter((x) => x.status === 'fulfilled').length;
    const concFail = conc.filter((x) => x.status === 'rejected').length;
    const balAfterConc = await withTransaction(async (client) =>
      calculateBankAccountBookBalance(client, mainBa.id)
    );
    if (
      concOk === 1 &&
      concFail === 1 &&
      Number(balAfterConc.book_balance) >= 0
    ) {
      ok('15) تزامن صرفين: ينجح واحد فقط دون رصيد سالب');
    } else fail('15) تزامن', { concOk, concFail, bal: balAfterConc.book_balance });

    // ——— 16) Idempotent double post ———
    const again = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      await acquireJournalEntriesLock(client);
      return postBankVoucher(client, {
        id: receipt.id,
        userId,
        version: receipt.version,
        updated_at: receipt.updated_at,
      });
    });
    if (!again.created) ok('16) ترحيل مزدوج idempotent');
    else fail('16) idempotency');

    // ——— 17) Reject update POSTED ———
    await expectHttp(
      '17) رفض تعديل POSTED',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return updateBankVoucher(client, {
            id: receipt.id,
            userId,
            version: receipt.version,
            updated_at: receipt.updated_at,
            amount: '1',
          });
        }),
      409
    );

    // ——— 18) Void DRAFT ———
    const draftToVoid = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankVoucher(client, {
        voucher_type: 'BANK_RECEIPT',
        bank_account_id: mainBa.id,
        counter_account_id: receiptAcc,
        voucher_date: vDate,
        amount: '15',
        description: `مسودة إلغاء ${suffix}`,
        created_by: userId,
      });
    });
    createdVoucherIds.push(draftToVoid.id);
    const voidedDraft = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return voidBankVoucher(client, {
        id: draftToVoid.id,
        userId,
        version: draftToVoid.version,
        updated_at: draftToVoid.updated_at,
        reason: 'إلغاء مسودة اختبار',
      });
    });
    if (voidedDraft.status === 'VOID' && !voidedDraft.journal_entry_id) {
      ok('18) إلغاء DRAFT');
    } else fail('18)', voidedDraft);

    // ——— 19–20) Void POSTED + reversal link ———
    const balBeforeVoid = await getAccountBookBalance(glMain);
    const voidedPay = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      await acquireJournalEntriesLock(client);
      return voidBankVoucher(client, {
        id: payment.id,
        userId,
        version: payment.version,
        updated_at: payment.updated_at,
        reason: 'إلغاء صرف مرحّل اختبار',
      });
    });
    if (
      voidedPay.status === 'VOID' &&
      voidedPay.reversal_journal_entry_id &&
      voidedPay.journal_entry_id
    ) {
      ok('19) إلغاء POSTED مع قيد عكسي');
    } else fail('19)', voidedPay);

    const linkJe = await query(
      `SELECT o.reversal_entry_id::text AS rev_on_orig,
              r.reverses_entry_id::text AS orig_on_rev, r.is_reversal
       FROM accounts.journal_entries o
       JOIN accounts.journal_entries r ON r.id = $2
       WHERE o.id = $1`,
      [voidedPay.journal_entry_id, voidedPay.reversal_journal_entry_id]
    );
    if (
      linkJe.rows[0]?.rev_on_orig === voidedPay.reversal_journal_entry_id &&
      linkJe.rows[0]?.orig_on_rev === voidedPay.journal_entry_id &&
      linkJe.rows[0]?.is_reversal === true
    ) {
      ok('20) ربط العكسي بالأصل (reversal_entry_id / reverses_entry_id)');
    } else fail('20)', linkJe.rows[0]);

    // ——— 23) VOID restores book balance ———
    const balAfterVoid = await getAccountBookBalance(glMain);
    if (
      Math.abs(Number(balAfterVoid.balance) - (Number(balBeforeVoid.balance) + 50)) <
      0.001
    ) {
      ok('23) VOID يعيد أثر الرصيد الدفتري');
    } else fail('23)', { balBeforeVoid, balAfterVoid });

    // ——— 21) Book balance POSTED only ———
    const draftOnly = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankVoucher(client, {
        voucher_type: 'BANK_RECEIPT',
        bank_account_id: mainBa.id,
        counter_account_id: receiptAcc,
        voucher_date: vDate,
        amount: '777',
        description: `مسودة لا تدخل الرصيد ${suffix}`,
        created_by: userId,
      });
    });
    createdVoucherIds.push(draftOnly.id);
    const book = await withTransaction(async (client) =>
      calculateBankAccountBookBalance(client, mainBa.id)
    );
    const glBook = await getAccountBookBalance(glMain);
    if (
      book.source === 'POSTED_JOURNAL_LINES' &&
      normalizeMoneyInput(book.book_balance) === normalizeMoneyInput(glBook.balance)
    ) {
      ok('21) الرصيد الدفتري من POSTED فقط');
    } else fail('21)', { book, glBook });

    // ——— 22) opening_balance_reference لا يؤثر ———
    const openBook = await withTransaction(async (client) =>
      calculateBankAccountBookBalance(client, openBa.id)
    );
    const openGl = await getAccountBookBalance(glOpen);
    if (
      normalizeMoneyInput(openBook.book_balance) === normalizeMoneyInput(openGl.balance) &&
      Number(openBook.book_balance) === 0
    ) {
      ok('22) opening_balance_reference لا يؤثر على الرصيد الدفتري');
    } else fail('22)', { openBook, openGl });

    // ——— 24) SUSPENDED/CLOSED not operational ———
    await expectHttp(
      '24) assertBankAccountOperational يرفض SUSPENDED',
      () =>
        withTransaction(async (client) =>
          assertBankAccountOperational(client, suspBa.id, { forReceipt: true })
        ),
      409
    );
    // re-activate then close path not needed — query sense ACTIVE only
    const opsCheck = await query(
      `SELECT id FROM accounts.bank_accounts
       WHERE id = $1::uuid AND status = 'ACTIVE'`,
      [suspBa.id]
    );
    if (!opsCheck.rows[0]) ok('24b) SUSPENDED خارج قائمة ACTIVE التشغيلية');
    else fail('24b)');

    // ——— 25–29) Permissions ———
    const limRes = await query(
      `SELECT u.id, u.username FROM student_affairs.users u
       JOIN student_affairs.user_systems us ON us.user_id = u.id
       JOIN student_affairs.systems s ON s.id = us.system_id
       WHERE s.code = 'ACCOUNTS' AND u.is_active
         AND LOWER(u.username) NOT IN ('accounts','admin','superadmin','super_admin')
         AND u.id <> $1
       LIMIT 1`,
      [userId]
    );
    if (limRes.rows[0]) {
      limUserId = limRes.rows[0].id as string;
    } else {
      const sys = await query(
        `SELECT id FROM student_affairs.systems WHERE code = 'ACCOUNTS' LIMIT 1`
      );
      const insU = await query(
        `INSERT INTO student_affairs.users (username, email, full_name, password_hash, is_active)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING id`,
        [
          `bv_test_${suffix.toLowerCase()}`,
          `bv_test_${suffix.toLowerCase()}@test.local`,
          'مستخدم اختبار سندات',
          '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012',
        ]
      );
      limUserId = insU.rows[0].id as string;
      limUserCreated = true;
      await query(
        `INSERT INTO student_affairs.user_systems (user_id, system_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [limUserId, sys.rows[0].id]
      );
    }

    // إزالة أي تعيين سابق
    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      try {
        await removeBankAccountUser(client, {
          bank_account_id: mainBa.id,
          user_id: limUserId!,
        });
      } catch {
        /* لا تعيين */
      }
    });

    // 28) IDOR بدون تعيين
    await expectHttp(
      '28) IDOR: بدون تعيين → 403 على prepare',
      () =>
        withTransaction(async (client) =>
          assertCanPrepareBankAccount(client, {
            bankAccountId: mainBa.id,
            userId: limUserId!,
          })
        ),
      403
    );

    // 25) can_view
    await expectHttp(
      '25a) can_view بدون علم → 403',
      () =>
        withTransaction(async (client) =>
          assertCanViewBankAccount(client, {
            bankAccountId: mainBa.id,
            userId: limUserId!,
          })
        ),
      403
    );
    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return assignBankAccountUser(client, {
        bank_account_id: mainBa.id,
        user_id: limUserId!,
        can_view: true,
        can_prepare: false,
        can_post: false,
        created_by: userId,
      });
    });
    await withTransaction(async (client) =>
      assertCanViewBankAccount(client, {
        bankAccountId: mainBa.id,
        userId: limUserId!,
      })
    );
    ok('25b) can_view مع العلم ينجح');

    // 26) can_prepare
    await expectHttp(
      '26a) can_prepare بدون علم → 403',
      () =>
        withTransaction(async (client) =>
          assertCanPrepareBankAccount(client, {
            bankAccountId: mainBa.id,
            userId: limUserId!,
          })
        ),
      403
    );
    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return assignBankAccountUser(client, {
        bank_account_id: mainBa.id,
        user_id: limUserId!,
        can_view: true,
        can_prepare: true,
        can_post: false,
        created_by: userId,
      });
    });
    const limDraft = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankVoucher(client, {
        voucher_type: 'BANK_RECEIPT',
        bank_account_id: mainBa.id,
        counter_account_id: receiptAcc,
        voucher_date: vDate,
        amount: '11',
        description: `مسودة محدود ${suffix}`,
        created_by: limUserId!,
      });
    });
    createdVoucherIds.push(limDraft.id);
    ok('26b) can_prepare مع العلم ينجح');

    // 27) can_post
    await expectHttp(
      '27a) can_post بدون علم → 403',
      () =>
        withTransaction(async (client) =>
          assertCanPostBankAccount(client, {
            bankAccountId: mainBa.id,
            userId: limUserId!,
          })
        ),
      403
    );
    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return assignBankAccountUser(client, {
        bank_account_id: mainBa.id,
        user_id: limUserId!,
        can_view: true,
        can_prepare: true,
        can_post: true,
        created_by: userId,
      });
    });
    await withTransaction(async (client) =>
      assertCanPostBankAccount(client, {
        bankAccountId: mainBa.id,
        userId: limUserId!,
      })
    );
    ok('27b) can_post مع العلم ينجح');

    // Privileged bypass
    if (isPrivilegedAccountsUsername(username)) {
      await withTransaction(async (client) => {
        try {
          await removeBankAccountUser(client, {
            bank_account_id: mainBa.id,
            user_id: userId,
          });
        } catch {
          /* ok */
        }
      });
      await withTransaction(async (client) =>
        assertCanPrepareBankAccount(client, {
          bankAccountId: mainBa.id,
          userId,
        })
      );
      ok('25c) تجاوز صلاحيات بمستخدم privileged (accounts)');
      ok('29) تجاوز Admin عبر username accounts');
    } else {
      ok('25c) تخطّي bypass (المستخدم ليس accounts/admin)');
      ok('29) تخطّي Admin bypass');
    }

    // ——— 32) Audit ———
    await withTransaction(async (client) => {
      await writeFinancialAudit(client, {
        userId,
        action: 'bank_voucher.posted',
        entityType: 'bank_voucher',
        entityId: receipt.id,
        oldValues: { status: 'DRAFT' },
        newValues: { status: 'POSTED', voucher_number: receipt.voucher_number },
        description: `اختبار تدقيق سند بنكي ${suffix}`,
      });
    });
    const auditRow = await query(
      `SELECT action FROM accounts.financial_audit_log
       WHERE description = $1 LIMIT 1`,
      [`اختبار تدقيق سند بنكي ${suffix}`]
    );
    if (auditRow.rows[0]?.action === 'bank_voucher.posted') {
      ok('32) writeFinancialAudit يسجّل أحداث السند');
    } else fail('32)', auditRow.rows[0]);

    // ——— 33) Print UI ———
    const printPage = path.join(
      process.cwd(),
      'app',
      'accounts',
      'banks',
      'vouchers',
      '[id]',
      'page.tsx'
    );
    if (fs.existsSync(printPage)) {
      const content = fs.readFileSync(printPage, 'utf8');
      if (content.includes('print-container')) ok('33) صفحة الطباعة موجودة مع print-container');
      else fail('33) بدون print-container');
    } else fail('33) ملف الطباعة غير موجود', printPage);

    // ——— 34) Seed readiness ———
    const demoBa = await query(
      `SELECT COUNT(*)::int AS n FROM accounts.bank_accounts WHERE LOWER(code)=LOWER('DEMO-BA-IQD')`
    );
    const demoBrv = await query(
      `SELECT COUNT(*)::int AS n FROM accounts.banks WHERE LOWER(code)=LOWER('DEMO-BANK')`
    );
    if (demoBa.rows[0].n <= 1 && demoBrv.rows[0].n <= 1) {
      ok('34) أكواد DEMO فريدة / جاهزية seed');
    } else fail('34)', { ba: demoBa.rows[0].n, bank: demoBrv.rows[0].n });

    // ——— 35–39) Smoke tables ———
    const smoke = await query(`
      SELECT
        to_regclass('accounts.bank_accounts') AS bank_accounts,
        to_regclass('accounts.cash_transfers') AS cash_transfers,
        to_regclass('accounts.cash_vouchers') AS cash_vouchers,
        to_regclass('accounts.cash_count_adjustments') AS cash_count_adjustments,
        to_regclass('accounts.cash_box_sessions') AS cash_box_sessions
    `);
    const s = smoke.rows[0];
    if (s.bank_accounts) ok('35) جدول bank_accounts موجود');
    else fail('35)');
    if (s.cash_transfers) ok('36) جدول cash_transfers موجود');
    else fail('36)');
    if (s.cash_vouchers) ok('37) جدول cash_vouchers موجود');
    else fail('37)');
    if (s.cash_count_adjustments) ok('38) جدول cash_count_adjustments موجود');
    else fail('38)');
    if (s.cash_box_sessions) ok('39) جدول cash_box_sessions موجود');
    else fail('39)');
  } finally {
    for (const id of createdVoucherIds) {
      await query(
        `UPDATE accounts.bank_vouchers
         SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
         WHERE id = $1`,
        [id]
      ).catch(() => undefined);
      await query(`DELETE FROM accounts.bank_vouchers WHERE id = $1`, [id]).catch(
        () => undefined
      );
    }
    for (const id of createdAccountIds) {
      await query(`DELETE FROM accounts.bank_account_users WHERE bank_account_id=$1`, [
        id,
      ]).catch(() => undefined);
      await query(`DELETE FROM accounts.bank_accounts WHERE id=$1`, [id]).catch(
        () => undefined
      );
    }
    for (const id of createdBranchIds) {
      await query(`DELETE FROM accounts.bank_branches WHERE id=$1`, [id]).catch(
        () => undefined
      );
    }
    for (const id of createdBankIds) {
      await query(`DELETE FROM accounts.bank_branches WHERE bank_id=$1`, [id]).catch(
        () => undefined
      );
      await query(`DELETE FROM accounts.banks WHERE id=$1`, [id]).catch(() => undefined);
    }
    if (limUserCreated && limUserId) {
      await query(`DELETE FROM student_affairs.user_systems WHERE user_id=$1`, [
        limUserId,
      ]).catch(() => undefined);
      await query(`DELETE FROM student_affairs.users WHERE id=$1`, [limUserId]).catch(
        () => undefined
      );
    }
    await closePool();
  }
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await closePool().catch(() => undefined);
});
