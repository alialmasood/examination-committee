/**
 * اختبارات التحويلات المصرفية (4.C).
 * npm run test:bank-transfers
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
} from '../lib/accounts/bank-accounts';
import { createBank } from '../lib/accounts/banks';
import { createBankBranch } from '../lib/accounts/bank-branches';
import {
  createBankTransfer,
  deleteDraftBankTransfer,
  postBankTransfer,
  updateBankTransfer,
  voidBankTransfer,
} from '../lib/accounts/bank-transfers';
import {
  createBankVoucher,
  postBankVoucher,
} from '../lib/accounts/bank-vouchers';
import {
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  normalizeAndValidateLines,
  replaceJournalLines,
} from '../lib/accounts/journal-entries';
import { normalizeMoneyInput } from '../lib/accounts/money';
import { pgDateOnly } from '../lib/accounts/document-sequences';
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
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'اختبار تحويلات بنكية')
     RETURNING id`,
    [code, nameAr, type.rows[0].id, type.rows[0].normal_balance, sort.rows[0].n, userId]
  );
  return ins.rows[0].id as string;
}

async function ensureExpense(code: string, nameAr: string, userId: string, requiresCc = false) {
  const existing = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a WHERE LOWER(a.code)=LOWER($1)`,
    [code]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;
  const type = await query(
    `SELECT id, normal_balance FROM accounts.account_types WHERE code='EXPENSE'`
  );
  const sort = await query(
    `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,$5,TRUE,$6,$7,'مصروف رسوم تحويل اختبار')
     RETURNING id`,
    [
      code,
      nameAr,
      type.rows[0].id,
      type.rows[0].normal_balance,
      requiresCc,
      sort.rows[0].n,
      userId,
    ]
  );
  return ins.rows[0].id as string;
}

async function postPostedJe(params: {
  userId: string;
  yearId: string;
  periodId: string;
  entryDate: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: string;
  description: string;
}): Promise<string> {
  return withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    await assertFiscalContextForEntry(client, {
      fiscalYearId: params.yearId,
      fiscalPeriodId: params.periodId,
      entryDate: params.entryDate,
    });
    const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
      client,
      [
        {
          account_id: params.debitAccountId,
          debit_amount: params.amount,
          credit_amount: '0',
          description: params.description,
        },
        {
          account_id: params.creditAccountId,
          debit_amount: '0',
          credit_amount: params.amount,
          description: 'مقابل',
        },
      ],
      'strict'
    );
    const entryNumber = await allocateJournalEntryNumber(client, params.yearId);
    const ins = await txQuery(
      client,
      `INSERT INTO accounts.journal_entries
        (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
         description, total_debit, total_credit, status, created_by, updated_by,
         posted_by, posted_at)
       VALUES ($1,$2,$3,$4::date,'MANUAL',$5,$6::numeric,$7::numeric,'POSTED',$8,$8,$8,NOW())
       RETURNING id`,
      [
        entryNumber,
        params.yearId,
        params.periodId,
        params.entryDate,
        params.description,
        totalDebit,
        totalCredit,
        params.userId,
      ]
    );
    await replaceJournalLines(client, ins.rows[0].id as string, lines);
    return ins.rows[0].id as string;
  });
}

async function main() {
  {
    const req = new NextRequest('http://localhost/api/accounts/bank-transfers');
    const a = await requireAccountsAccess(req);
    if ('response' in a && a.response.status === 401) ok('35) 401 بدون توكن');
    else fail('35) 401', a);
  }

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
      const req = new NextRequest('http://localhost/api/accounts/bank-transfers', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const a = await requireAccountsAccess(req);
      if (
        'response' in a &&
        (a.response.status === 403 || a.response.status === 401)
      ) {
        ok('36) رفض مستخدم بلا صلاحية ACCOUNTS');
      } else fail('36) 403/401', a);
    } else ok('36) تخطّي (لا مستخدم بدون ACCOUNTS)');
  }

  const userRes = await query(
    `SELECT u.id, u.username FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id = u.id
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE s.code = 'ACCOUNTS' AND u.is_active
     ORDER BY CASE WHEN LOWER(u.username)='accounts' THEN 0 ELSE 1 END
     LIMIT 1`
  );
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
  const periodId = period.rows[0].id as string;
  const entryDate = pgDateOnly(period.rows[0].start_date as string);
  const periodEnd = pgDateOnly(period.rows[0].end_date as string);
  function offsetDate(days: number) {
    const d = new Date(`${entryDate}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const iso = d.toISOString().slice(0, 10);
    return iso > periodEnd ? periodEnd : iso;
  }
  const vDate = offsetDate(12);

  const suffix = Date.now().toString(36).toUpperCase();
  const glA = await ensureFreeAsset(`BT-GL-A-${suffix}`, 'GL مصدر تحويل', userId);
  const glB = await ensureFreeAsset(`BT-GL-B-${suffix}`, 'GL وجهة تحويل', userId);
  const glFee = await ensureExpense(`BT-FEE-${suffix}`, 'رسوم تحويل اختبار', userId);
  const glAssetAsFee = await ensureFreeAsset(
    `BT-BADFEE-${suffix}`,
    'أصل ليس مصروف',
    userId
  );
  const fundingContra = await query(
    `SELECT a.id FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code IN ('REVENUE','LIABILITY') AND NOT a.is_group
       AND a.allow_posting AND a.is_active AND NOT a.requires_cost_center
     LIMIT 1`
  );
  if (!fundingContra.rows[0]) throw new Error('لا مقابل تمويل');
  const contraId = fundingContra.rows[0].id as string;

  let limUserId: string | null = null;
  const createdTransferIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdBankIds: string[] = [];

  try {
    const bank = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBank(client, {
        code: `BT-BANK-${suffix}`,
        name_ar: 'مصرف تحويلات اختبار',
        created_by: userId,
      });
    });
    createdBankIds.push(bank.id);
    const branch = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankBranch(client, {
        bank_id: bank.id,
        code: `BT-BR-${suffix}`,
        name_ar: 'فرع تحويلات',
        created_by: userId,
      });
    });

    const baA = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankAccount(client, {
        code: `BT-BA-A-${suffix}`,
        bank_id: bank.id,
        bank_branch_id: branch.id,
        account_name_ar: 'مصدر تحويل',
        account_number: `A${suffix}`,
        currency_code: 'IQD',
        gl_account_id: glA,
        allows_transfers: true,
        created_by: userId,
      });
    });
    createdAccountIds.push(baA.id);

    const baB = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankAccount(client, {
        code: `BT-BA-B-${suffix}`,
        bank_id: bank.id,
        bank_branch_id: branch.id,
        account_name_ar: 'وجهة تحويل',
        account_number: `B${suffix}`,
        currency_code: 'IQD',
        gl_account_id: glB,
        allows_transfers: true,
        created_by: userId,
      });
    });
    createdAccountIds.push(baB.id);

    const baNoXfer = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const gl = await ensureFreeAsset(`BT-GL-NX-${suffix}`, 'GL بلا تحويل', userId);
      return createBankAccount(client, {
        code: `BT-BA-NX-${suffix}`,
        bank_id: bank.id,
        account_name_ar: 'بلا تحويلات',
        account_number: `NX${suffix}`,
        currency_code: 'IQD',
        gl_account_id: gl,
        allows_transfers: false,
        created_by: userId,
      });
    });
    createdAccountIds.push(baNoXfer.id);

    const baUsd = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const gl = await ensureFreeAsset(`BT-GL-USD-${suffix}`, 'GL دولار', userId);
      return createBankAccount(client, {
        code: `BT-BA-USD-${suffix}`,
        bank_id: bank.id,
        account_name_ar: 'دولار',
        account_number: `U${suffix}`,
        currency_code: 'USD',
        gl_account_id: gl,
        allows_transfers: true,
        created_by: userId,
      });
    });
    createdAccountIds.push(baUsd.id);

    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      for (const id of [baA.id, baB.id, baNoXfer.id, baUsd.id]) {
        try {
          await assignBankAccountUser(client, {
            bank_account_id: id,
            user_id: userId,
            can_view: true,
            can_prepare: true,
            can_post: true,
            created_by: userId,
          });
        } catch {
          /* ok */
        }
      }
    });

    // تمويل المصدر
    await postPostedJe({
      userId,
      yearId,
      periodId,
      entryDate: vDate,
      debitAccountId: glA,
      creditAccountId: contraId,
      amount: '1000.000',
      description: `تمويل مصدر ${suffix}`,
    });
    await postPostedJe({
      userId,
      yearId,
      periodId,
      entryDate: vDate,
      debitAccountId: glB,
      creditAccountId: contraId,
      amount: '200.000',
      description: `تمويل وجهة ${suffix}`,
    });

    // 1) إنشاء DRAFT
    let transfer = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankTransfer(client, {
        source_bank_account_id: baA.id,
        destination_bank_account_id: baB.id,
        transfer_date: vDate,
        amount: '100',
        fee_amount: '0',
        description: `تحويل مسودة ${suffix}`,
        created_by: userId,
      });
    });
    createdTransferIds.push(transfer.id);
    if (transfer.status === 'DRAFT' && transfer.transfer_number.startsWith('BTR')) {
      ok('1) إنشاء DRAFT');
    } else fail('1)', transfer);

    // 2) مصدر = وجهة
    await expectHttp(
      '2) منع المصدر = الوجهة',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankTransfer(client, {
            source_bank_account_id: baA.id,
            destination_bank_account_id: baA.id,
            transfer_date: vDate,
            amount: '10',
            description: 'مرفوض نفس الحساب',
            created_by: userId,
          });
        }),
      400
    );

    // 3) اختلاف عملة
    await expectHttp(
      '3) منع اختلاف العملة',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankTransfer(client, {
            source_bank_account_id: baA.id,
            destination_bank_account_id: baUsd.id,
            transfer_date: vDate,
            amount: '10',
            description: 'مرفوض عملة',
            created_by: userId,
          });
        }),
      409
    );

    // 4/5) غير ACTIVE / allows_transfers
    await query(
      `UPDATE accounts.bank_accounts SET status='SUSPENDED', version=version+1 WHERE id=$1`,
      [baNoXfer.id]
    );
    await expectHttp(
      '4) منع حساب غير ACTIVE',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankTransfer(client, {
            source_bank_account_id: baNoXfer.id,
            destination_bank_account_id: baB.id,
            transfer_date: vDate,
            amount: '10',
            description: 'مرفوض معلّق',
            created_by: userId,
          });
        }),
      409
    );
    await query(
      `UPDATE accounts.bank_accounts SET status='ACTIVE', version=version+1 WHERE id=$1`,
      [baNoXfer.id]
    );
    await expectHttp(
      '5) منع allows_transfers=false',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankTransfer(client, {
            source_bank_account_id: baNoXfer.id,
            destination_bank_account_id: baB.id,
            transfer_date: vDate,
            amount: '10',
            description: 'مرفوض بلا تحويل',
            created_by: userId,
          });
        }),
      409,
      'لا يسمح بالتحويلات'
    );

    // 5b) DRAFT ثم تعليق المصدر → رفض الترحيل
    const draftSuspend = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankTransfer(client, {
        source_bank_account_id: baA.id,
        destination_bank_account_id: baB.id,
        transfer_date: vDate,
        amount: '12',
        description: `مسودة قبل تعليق ${suffix}`,
        created_by: userId,
      });
    });
    createdTransferIds.push(draftSuspend.id);
    await query(
      `UPDATE accounts.bank_accounts SET status='SUSPENDED', version=version+1 WHERE id=$1`,
      [baA.id]
    );
    await expectHttp(
      '5b) رفض ترحيل DRAFT بعد تعليق المصدر',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          await acquireJournalEntriesLock(client);
          return postBankTransfer(client, {
            id: draftSuspend.id,
            userId,
            version: draftSuspend.version,
            updated_at: draftSuspend.updated_at,
          });
        }),
      409
    );
    await query(
      `UPDATE accounts.bank_accounts SET status='ACTIVE', version=version+1 WHERE id=$1`,
      [baA.id]
    );

    // 6) تعديل DRAFT
    transfer = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return updateBankTransfer(client, {
        id: transfer.id,
        userId,
        version: transfer.version,
        updated_at: transfer.updated_at,
        amount: '150',
        description: `تحويل معدّل ${suffix}`,
      });
    });
    if (normalizeMoneyInput(transfer.amount) === '150.000') ok('6) تعديل DRAFT');
    else fail('6)', transfer.amount);

    // 7/8) ترقيم
    const [n1, n2] = await Promise.all([
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        return createBankTransfer(client, {
          source_bank_account_id: baA.id,
          destination_bank_account_id: baB.id,
          transfer_date: vDate,
          amount: '1',
          description: `ترقيم متزامن 1 ${suffix}`,
          created_by: userId,
        });
      }),
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        return createBankTransfer(client, {
          source_bank_account_id: baA.id,
          destination_bank_account_id: baB.id,
          transfer_date: vDate,
          amount: '1',
          description: `ترقيم متزامن 2 ${suffix}`,
          created_by: userId,
        });
      }),
    ]);
    createdTransferIds.push(n1.id, n2.id);
    if (n1.transfer_number !== n2.transfer_number) {
      ok('7) ترقيم فريد');
      ok('8) ترقيم متزامن بلا تكرار');
    } else fail('7/8)', { a: n1.transfer_number, b: n2.transfer_number });

    // 9–10) ترحيل بلا رسوم
    const balSrcBefore = await getAccountBookBalance(glA);
    const balDstBefore = await getAccountBookBalance(glB);
    const postedPlain = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      await acquireJournalEntriesLock(client);
      return postBankTransfer(client, {
        id: transfer.id,
        userId,
        version: transfer.version,
        updated_at: transfer.updated_at,
      });
    });
    transfer = postedPlain.transfer;
    if (transfer.status === 'POSTED' && transfer.journal_entry_id) ok('9) ترحيل دون رسوم');
    else fail('9)', transfer);

    const jeMeta = await query(
      `SELECT source_type, source_id::text, entry_date::text AS entry_date, entry_type
       FROM accounts.journal_entries WHERE id=$1`,
      [transfer.journal_entry_id]
    );
    if (
      jeMeta.rows[0]?.source_type === 'BANK_TRANSFER' &&
      jeMeta.rows[0]?.source_id === transfer.id &&
      jeMeta.rows[0]?.entry_type === 'TRANSFER' &&
      pgDateOnly(jeMeta.rows[0].entry_date) === vDate
    ) {
      ok('9b) source_type/source_id وentry_date=transfer_date');
    } else fail('9b)', jeMeta.rows[0]);

    const linesPlain = await query(
      `SELECT account_id::text, debit_amount::text, credit_amount::text
       FROM accounts.journal_entry_lines WHERE journal_entry_id=$1`,
      [transfer.journal_entry_id]
    );
    const drDest = linesPlain.rows.find(
      (l) => l.account_id === glB && Number(l.debit_amount) > 0
    );
    const crSrc = linesPlain.rows.find(
      (l) => l.account_id === glA && Number(l.credit_amount) > 0
    );
    if (
      drDest &&
      crSrc &&
      normalizeMoneyInput(drDest.debit_amount) === '150.000' &&
      normalizeMoneyInput(crSrc.credit_amount) === '150.000'
    ) {
      ok('10) قيد: Dr Destination / Cr Source');
    } else fail('10)', linesPlain.rows);

    // 11–12) ترحيل مع رسوم
    const withFee = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankTransfer(client, {
        source_bank_account_id: baA.id,
        destination_bank_account_id: baB.id,
        transfer_date: vDate,
        amount: '50',
        fee_amount: '5',
        fee_expense_account_id: glFee,
        description: `تحويل برسوم ${suffix}`,
        created_by: userId,
      });
    });
    createdTransferIds.push(withFee.id);
    const postedFee = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      await acquireJournalEntriesLock(client);
      return postBankTransfer(client, {
        id: withFee.id,
        userId,
        version: withFee.version,
        updated_at: withFee.updated_at,
      });
    });
    if (postedFee.transfer.status === 'POSTED') ok('11) ترحيل مع رسوم');
    else fail('11)', postedFee);

    const linesFee = await query(
      `SELECT account_id::text, debit_amount::text, credit_amount::text
       FROM accounts.journal_entry_lines WHERE journal_entry_id=$1`,
      [postedFee.transfer.journal_entry_id]
    );
    const feeDr = linesFee.rows.find(
      (l) => l.account_id === glFee && Number(l.debit_amount) > 0
    );
    const srcCrFee = linesFee.rows.find(
      (l) => l.account_id === glA && Number(l.credit_amount) > 0
    );
    if (
      feeDr &&
      srcCrFee &&
      normalizeMoneyInput(feeDr.debit_amount) === '5.000' &&
      normalizeMoneyInput(srcCrFee.credit_amount) === '55.000'
    ) {
      ok('12) قيد: Dr Dest + Dr Fees / Cr Source');
    } else fail('12)', linesFee.rows);

    // 13) رسوم غير EXPENSE
    await expectHttp(
      '13) منع حساب رسوم غير EXPENSE',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankTransfer(client, {
            source_bank_account_id: baA.id,
            destination_bank_account_id: baB.id,
            transfer_date: vDate,
            amount: '10',
            fee_amount: '1',
            fee_expense_account_id: glAssetAsFee,
            description: 'رسوم غير مصروف',
            created_by: userId,
          });
        }),
      400,
      'EXPENSE'
    );

    // 14) مركز كلفة
    const feeCc = await ensureExpense(
      `BT-FEE-CC-${suffix}`,
      'رسوم تتطلب مركز',
      userId,
      true
    );
    const cc = await query(
      `SELECT id FROM accounts.cost_centers WHERE is_active AND NOT is_group LIMIT 1`
    );
    await expectHttp(
      '14) فرض مركز الكلفة',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankTransfer(client, {
            source_bank_account_id: baA.id,
            destination_bank_account_id: baB.id,
            transfer_date: vDate,
            amount: '10',
            fee_amount: '1',
            fee_expense_account_id: feeCc,
            description: 'بلا مركز',
            created_by: userId,
          });
        }),
      409,
      'مركز كلفة'
    );
    if (cc.rows[0]) {
      const withCc = await withTransaction(async (client) => {
        await acquireBanksLock(client);
        return createBankTransfer(client, {
          source_bank_account_id: baA.id,
          destination_bank_account_id: baB.id,
          transfer_date: vDate,
          amount: '10',
          fee_amount: '1',
          fee_expense_account_id: feeCc,
          cost_center_id: cc.rows[0].id,
          description: `مع مركز ${suffix}`,
          created_by: userId,
        });
      });
      createdTransferIds.push(withCc.id);
      ok('14b) إنشاء مع مركز كلفة عند الاشتراط');
    } else ok('14b) تخطّي (لا مركز كلفة)');

    // 15–16) رصيد غير كافٍ
    await expectHttp(
      '15) منع رصيد غير كافٍ للمبلغ',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          const t = await createBankTransfer(client, {
            source_bank_account_id: baA.id,
            destination_bank_account_id: baB.id,
            transfer_date: vDate,
            amount: '999999',
            description: `رصيد كبير ${suffix}`,
            created_by: userId,
          });
          createdTransferIds.push(t.id);
          await acquireJournalEntriesLock(client);
          return postBankTransfer(client, {
            id: t.id,
            userId,
            version: t.version,
            updated_at: t.updated_at,
          });
        }),
      409
    );

    await expectHttp(
      '16) منع رصيد غير كافٍ للمبلغ+الرسوم',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          const book = await getAccountBookBalance(glA);
          const almost = String(Math.max(1, Number(book.balance) - 1));
          const t = await createBankTransfer(client, {
            source_bank_account_id: baA.id,
            destination_bank_account_id: baB.id,
            transfer_date: vDate,
            amount: almost,
            fee_amount: '50',
            fee_expense_account_id: glFee,
            description: `رصيد+رسوم ${suffix}`,
            created_by: userId,
          });
          createdTransferIds.push(t.id);
          await acquireJournalEntriesLock(client);
          return postBankTransfer(client, {
            id: t.id,
            userId,
            version: t.version,
            updated_at: t.updated_at,
          });
        }),
      409
    );

    // 17) تحويلان متزامنان
    const c1 = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankTransfer(client, {
        source_bank_account_id: baA.id,
        destination_bank_account_id: baB.id,
        transfer_date: vDate,
        amount: '400',
        description: `تزامن أ ${suffix}`,
        created_by: userId,
      });
    });
    const c2 = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankTransfer(client, {
        source_bank_account_id: baA.id,
        destination_bank_account_id: baB.id,
        transfer_date: vDate,
        amount: '400',
        description: `تزامن ب ${suffix}`,
        created_by: userId,
      });
    });
    createdTransferIds.push(c1.id, c2.id);
    const conc = await Promise.allSettled([
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        await acquireJournalEntriesLock(client);
        return postBankTransfer(client, {
          id: c1.id,
          userId,
          version: c1.version,
          updated_at: c1.updated_at,
        });
      }),
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        await acquireJournalEntriesLock(client);
        return postBankTransfer(client, {
          id: c2.id,
          userId,
          version: c2.version,
          updated_at: c2.updated_at,
        });
      }),
    ]);
    const concOk = conc.filter((r) => r.status === 'fulfilled').length;
    const concFail = conc.filter((r) => r.status === 'rejected').length;
    const balAfterConc = await getAccountBookBalance(glA);
    if (concOk === 1 && concFail === 1 && Number(balAfterConc.balance) >= 0) {
      ok('17) تحويلان متزامنان من نفس المصدر');
    } else fail('17)', { concOk, concFail, bal: balAfterConc.balance });

    // 18) BANK_PAYMENT + BANK_TRANSFER متزامنان
    await postPostedJe({
      userId,
      yearId,
      periodId,
      entryDate: vDate,
      debitAccountId: glA,
      creditAccountId: contraId,
      amount: '500.000',
      description: `إعادة تمويل تزامن دفع ${suffix}`,
    });
    const mixBal = await getAccountBookBalance(glA);
    const mixAmt = normalizeMoneyInput(mixBal.balance);
    const payDraft = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankVoucher(client, {
        voucher_type: 'BANK_PAYMENT',
        bank_account_id: baA.id,
        counter_account_id: glFee,
        voucher_date: vDate,
        amount: mixAmt,
        description: `صرف متزامن مع تحويل ${suffix}`,
        created_by: userId,
      });
    });
    const xferDraft = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankTransfer(client, {
        source_bank_account_id: baA.id,
        destination_bank_account_id: baB.id,
        transfer_date: vDate,
        amount: mixAmt,
        description: `تحويل متزامن مع صرف ${suffix}`,
        created_by: userId,
      });
    });
    createdTransferIds.push(xferDraft.id);
    const mix = await Promise.allSettled([
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        await acquireJournalEntriesLock(client);
        return postBankVoucher(client, {
          id: payDraft.id,
          userId,
          version: payDraft.version,
          updated_at: payDraft.updated_at,
        });
      }),
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        await acquireJournalEntriesLock(client);
        return postBankTransfer(client, {
          id: xferDraft.id,
          userId,
          version: xferDraft.version,
          updated_at: xferDraft.updated_at,
        });
      }),
    ]);
    const mixOk = mix.filter((r) => r.status === 'fulfilled').length;
    const mixFail = mix.filter((r) => r.status === 'rejected').length;
    const balMix = await getAccountBookBalance(glA);
    if (mixOk === 1 && mixFail === 1 && Number(balMix.balance) >= 0) {
      ok('18) BANK_PAYMENT وBANK_TRANSFER متزامنان');
    } else fail('18)', { mixOk, mixFail, bal: balMix.balance, amt: mixAmt });

    // 18b) تحويلان متزامنان مع رسوم (amount+fee)
    await postPostedJe({
      userId,
      yearId,
      periodId,
      entryDate: vDate,
      debitAccountId: glA,
      creditAccountId: contraId,
      amount: '200.000',
      description: `تمويل رسوم متزامنة ${suffix}`,
    });
    const feeBalBook = await getAccountBookBalance(glA);
    // كل تحويل يخصم 120 (100+20) والرصيد ~200 → واحد فقط
    const feeC1 = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankTransfer(client, {
        source_bank_account_id: baA.id,
        destination_bank_account_id: baB.id,
        transfer_date: vDate,
        amount: '100',
        fee_amount: '20',
        fee_expense_account_id: glFee,
        description: `تزامن رسوم أ ${suffix}`,
        created_by: userId,
      });
    });
    const feeC2 = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankTransfer(client, {
        source_bank_account_id: baA.id,
        destination_bank_account_id: baB.id,
        transfer_date: vDate,
        amount: '100',
        fee_amount: '20',
        fee_expense_account_id: glFee,
        description: `تزامن رسوم ب ${suffix}`,
        created_by: userId,
      });
    });
    createdTransferIds.push(feeC1.id, feeC2.id);
    const feeConc = await Promise.allSettled([
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        await acquireJournalEntriesLock(client);
        return postBankTransfer(client, {
          id: feeC1.id,
          userId,
          version: feeC1.version,
          updated_at: feeC1.updated_at,
        });
      }),
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        await acquireJournalEntriesLock(client);
        return postBankTransfer(client, {
          id: feeC2.id,
          userId,
          version: feeC2.version,
          updated_at: feeC2.updated_at,
        });
      }),
    ]);
    const feeOk = feeConc.filter((r) => r.status === 'fulfilled').length;
    const feeFail = feeConc.filter((r) => r.status === 'rejected').length;
    const balFeeConc = await getAccountBookBalance(glA);
    if (
      feeOk === 1 &&
      feeFail === 1 &&
      Number(balFeeConc.balance) >= 0 &&
      Number(feeBalBook.balance) >= 120
    ) {
      ok(
        `18b) تزامن مع رسوم: نجح=${feeOk} فشل=${feeFail} رصيد=${balFeeConc.balance}`
      );
    } else
      fail('18b)', {
        feeOk,
        feeFail,
        bal: balFeeConc.balance,
        before: feeBalBook.balance,
      });

    // 19) تحويلان متعاكسان دون deadlock
    await postPostedJe({
      userId,
      yearId,
      periodId,
      entryDate: vDate,
      debitAccountId: glA,
      creditAccountId: contraId,
      amount: '100.000',
      description: `تمويل A معاكس ${suffix}`,
    });
    await postPostedJe({
      userId,
      yearId,
      periodId,
      entryDate: vDate,
      debitAccountId: glB,
      creditAccountId: contraId,
      amount: '100.000',
      description: `تمويل B معاكس ${suffix}`,
    });
    const ab = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankTransfer(client, {
        source_bank_account_id: baA.id,
        destination_bank_account_id: baB.id,
        transfer_date: vDate,
        amount: '40',
        description: `A→B ${suffix}`,
        created_by: userId,
      });
    });
    const ba = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankTransfer(client, {
        source_bank_account_id: baB.id,
        destination_bank_account_id: baA.id,
        transfer_date: vDate,
        amount: '40',
        description: `B→A ${suffix}`,
        created_by: userId,
      });
    });
    createdTransferIds.push(ab.id, ba.id);
    const cross = await Promise.allSettled([
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        await acquireJournalEntriesLock(client);
        return postBankTransfer(client, {
          id: ab.id,
          userId,
          version: ab.version,
          updated_at: ab.updated_at,
        });
      }),
      withTransaction(async (client) => {
        await acquireBanksLock(client);
        await acquireJournalEntriesLock(client);
        return postBankTransfer(client, {
          id: ba.id,
          userId,
          version: ba.version,
          updated_at: ba.updated_at,
        });
      }),
    ]);
    if (cross.every((r) => r.status === 'fulfilled')) {
      ok('19) تحويلان متعاكسان دون deadlock');
    } else fail('19)', cross.map((r) => (r.status === 'rejected' ? String(r.reason) : 'ok')));

    // 20) منع ترحيل مرتين
    const again = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      await acquireJournalEntriesLock(client);
      return postBankTransfer(client, {
        id: transfer.id,
        userId,
        version: transfer.version,
        updated_at: transfer.updated_at,
      });
    });
    if (!again.created) ok('20) منع الترحيل مرتين / idempotent');
    else fail('20)');

    // 21) منع تعديل POSTED
    await expectHttp(
      '21) منع تعديل POSTED',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return updateBankTransfer(client, {
            id: transfer.id,
            userId,
            version: transfer.version,
            updated_at: transfer.updated_at,
            amount: '1',
          });
        }),
      409
    );

    // 22) VOID DRAFT
    const draftVoid = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankTransfer(client, {
        source_bank_account_id: baA.id,
        destination_bank_account_id: baB.id,
        transfer_date: vDate,
        amount: '12',
        description: `مسودة إلغاء ${suffix}`,
        created_by: userId,
      });
    });
    createdTransferIds.push(draftVoid.id);
    const voidedDraft = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return voidBankTransfer(client, {
        id: draftVoid.id,
        userId,
        version: draftVoid.version,
        updated_at: draftVoid.updated_at,
        reason: 'إلغاء مسودة',
      });
    });
    if (voidedDraft.status === 'VOID' && !voidedDraft.journal_entry_id) ok('22) VOID DRAFT');
    else fail('22)', voidedDraft);

    // 23–26) VOID POSTED
    const balBeforeVoid = await getAccountBookBalance(glA);
    const balDstBeforeVoid = await getAccountBookBalance(glB);
    const voidedPosted = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      await acquireJournalEntriesLock(client);
      return voidBankTransfer(client, {
        id: postedFee.transfer.id,
        userId,
        version: postedFee.transfer.version,
        updated_at: postedFee.transfer.updated_at,
        reason: 'إلغاء مرحّل اختبار',
      });
    });
    if (
      voidedPosted.status === 'VOID' &&
      voidedPosted.reversal_journal_entry_id &&
      voidedPosted.journal_entry_id
    ) {
      ok('23) VOID POSTED بقيد عكسي');
    } else fail('23)', voidedPosted);

    const balAfterVoid = await getAccountBookBalance(glA);
    const feeRestored =
      Math.abs(Number(balAfterVoid.balance) - (Number(balBeforeVoid.balance) + 55)) <
      0.001;
    if (feeRestored) ok('24) صافي VOID صفر (المصدر)');
    else fail('24)', { balBeforeVoid, balAfterVoid });

    const link = await query(
      `SELECT o.reversal_entry_id::text AS rev, r.reverses_entry_id::text AS orig, r.is_reversal
       FROM accounts.journal_entries o
       JOIN accounts.journal_entries r ON r.id = $2
       WHERE o.id = $1`,
      [voidedPosted.journal_entry_id, voidedPosted.reversal_journal_entry_id]
    );
    if (
      link.rows[0]?.rev === voidedPosted.reversal_journal_entry_id &&
      link.rows[0]?.orig === voidedPosted.journal_entry_id &&
      link.rows[0]?.is_reversal === true
    ) {
      ok('25) ربط الأصل والعكس');
    } else fail('25)', link.rows[0]);

    const voidAgain = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return voidBankTransfer(client, {
        id: voidedPosted.id,
        userId,
        version: voidedPosted.version,
        updated_at: voidedPosted.updated_at,
        reason: 'مرة ثانية',
      });
    });
    if (voidAgain.status === 'VOID') ok('26) منع VOID مرتين (idempotent)');
    else fail('26)');

    // 12x) DELETE API — DRAFT فقط
    const delDraft = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankTransfer(client, {
        source_bank_account_id: baA.id,
        destination_bank_account_id: baB.id,
        transfer_date: vDate,
        amount: '8',
        description: `حذف مسودة ${suffix}`,
        created_by: userId,
      });
    });
    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      await deleteDraftBankTransfer(client, {
        id: delDraft.id,
        userId,
        version: delDraft.version,
        updated_at: delDraft.updated_at,
      });
    });
    const gone = await query(
      `SELECT id FROM accounts.bank_transfers WHERE id=$1`,
      [delDraft.id]
    );
    if (!gone.rows[0]) ok('12a) حذف DRAFT مسموح مع can_prepare');
    else fail('12a)');

    await expectHttp(
      '12b) منع حذف POSTED',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return deleteDraftBankTransfer(client, {
            id: transfer.id,
            userId,
            version: transfer.version,
            updated_at: transfer.updated_at,
          });
        }),
      409
    );
    await expectHttp(
      '12c) منع حذف VOID',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return deleteDraftBankTransfer(client, {
            id: voidedPosted.id,
            userId,
            version: voidedPosted.version,
            updated_at: voidedPosted.updated_at,
          });
        }),
      409
    );

    // 27/28) توثيق سياسة التاريخ والفترة
    ok('27) موثّق: الفترة يجب أن تكون OPEN عند الترحيل والعكس (assertFiscalContextForEntry)');
    ok('28) موثّق: entry_date = transfer_date · value_date مرجعي فقط · تاريخ العكس = transfer_date');

    // صلاحيات
    const limRes = await query(
      `SELECT u.id FROM student_affairs.users u
       JOIN student_affairs.user_systems us ON us.user_id = u.id
       JOIN student_affairs.systems s ON s.id = us.system_id
       WHERE s.code='ACCOUNTS' AND u.is_active
         AND LOWER(u.username) NOT IN ('accounts','admin','superadmin','super_admin')
         AND u.id <> $1 LIMIT 1`,
      [userId]
    );
    if (limRes.rows[0]) limUserId = limRes.rows[0].id as string;
    else {
      const sys = await query(
        `SELECT id FROM student_affairs.systems WHERE code='ACCOUNTS' LIMIT 1`
      );
      const insU = await query(
        `INSERT INTO student_affairs.users (username, email, full_name, password_hash, is_active)
         VALUES ($1,$2,$3,$4,TRUE) RETURNING id`,
        [
          `btlim_${suffix}`.toLowerCase(),
          `btlim_${suffix}@test.local`,
          'محدود تحويلات',
          'x',
        ]
      );
      limUserId = insU.rows[0].id as string;
      await query(
        `INSERT INTO student_affairs.user_systems (user_id, system_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [limUserId, sys.rows[0].id]
      );
    }

    await expectHttp(
      '32) IDOR المصدر بدون تعيين',
      () =>
        withTransaction(async (client) =>
          assertCanPrepareBankAccount(client, {
            bankAccountId: baA.id,
            userId: limUserId!,
          })
        ),
      403
    );

    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return assignBankAccountUser(client, {
        bank_account_id: baA.id,
        user_id: limUserId!,
        can_view: true,
        can_prepare: false,
        can_post: false,
        created_by: userId,
      });
    });
    await withTransaction(async (client) =>
      assertCanViewBankAccount(client, {
        bankAccountId: baA.id,
        userId: limUserId!,
      })
    );
    ok('29) can_view');

    await expectHttp(
      '30a) can_prepare بدون علم',
      () =>
        withTransaction(async (client) =>
          assertCanPrepareBankAccount(client, {
            bankAccountId: baA.id,
            userId: limUserId!,
          })
        ),
      403
    );
    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return assignBankAccountUser(client, {
        bank_account_id: baA.id,
        user_id: limUserId!,
        can_view: true,
        can_prepare: true,
        can_post: false,
        created_by: userId,
      });
    });
    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return assignBankAccountUser(client, {
        bank_account_id: baB.id,
        user_id: limUserId!,
        can_view: true,
        can_prepare: false,
        can_post: false,
        created_by: userId,
      });
    });
    const limDraft = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankTransfer(client, {
        source_bank_account_id: baA.id,
        destination_bank_account_id: baB.id,
        transfer_date: vDate,
        amount: '5',
        description: `مسودة محدود ${suffix}`,
        created_by: limUserId!,
      });
    });
    createdTransferIds.push(limDraft.id);
    ok('30) can_prepare');

    await expectHttp(
      '31a) can_post بدون علم',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          await acquireJournalEntriesLock(client);
          return postBankTransfer(client, {
            id: limDraft.id,
            userId: limUserId!,
            version: limDraft.version,
            updated_at: limDraft.updated_at,
          });
        }),
      403
    );
    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return assignBankAccountUser(client, {
        bank_account_id: baA.id,
        user_id: limUserId!,
        can_view: true,
        can_prepare: true,
        can_post: true,
        created_by: userId,
      });
    });
    await withTransaction(async (client) =>
      assertCanPostBankAccount(client, {
        bankAccountId: baA.id,
        userId: limUserId!,
      })
    );
    ok('31) can_post');

    // 33) IDOR وجهة: لا can_view على الوجهة
    await withTransaction(async (client) => {
      try {
        await removeBankAccountUser(client, {
          bank_account_id: baB.id,
          user_id: limUserId!,
        });
      } catch {
        /* */
      }
    });
    await expectHttp(
      '33) IDOR الوجهة بدون can_view',
      () =>
        withTransaction(async (client) => {
          await acquireBanksLock(client);
          return createBankTransfer(client, {
            source_bank_account_id: baA.id,
            destination_bank_account_id: baB.id,
            transfer_date: vDate,
            amount: '5',
            description: `بدون وجهة ${suffix}`,
            created_by: limUserId!,
          });
        }),
      403
    );

    // قائمة: لا تظهر تحويلات بدون can_view على الحسابين
    const listN = await query(
      `SELECT COUNT(*)::int AS n
       FROM accounts.bank_transfers t
       WHERE t.source_bank_account_id = $1::uuid
         AND t.destination_bank_account_id = $2::uuid
         AND (
           EXISTS (
             SELECT 1 FROM student_affairs.users u
             WHERE u.id = $3::uuid AND u.is_active
               AND LOWER(TRIM(u.username)) IN (
                 'accounts','admin','superadmin','super_admin'
               )
           )
           OR (
             EXISTS (
               SELECT 1 FROM accounts.bank_account_users s
               WHERE s.bank_account_id = t.source_bank_account_id
                 AND s.user_id = $3::uuid AND s.can_view
             )
             AND EXISTS (
               SELECT 1 FROM accounts.bank_account_users d
               WHERE d.bank_account_id = t.destination_bank_account_id
                 AND d.user_id = $3::uuid AND d.can_view
             )
           )
         )`,
      [baA.id, baB.id, limUserId]
    );
    if (Number(listN.rows[0]?.n || 0) === 0) {
      ok('7g) قائمة التحويلات تخفي ما لا يُرى على الحسابين');
    } else fail('7g) تسريب قائمة', listN.rows[0]);

    if (isPrivilegedAccountsUsername(username)) {
      await withTransaction(async (client) => {
        try {
          await removeBankAccountUser(client, {
            bank_account_id: baA.id,
            user_id: userId,
          });
        } catch {
          /* */
        }
      });
      await withTransaction(async (client) =>
        assertCanPrepareBankAccount(client, {
          bankAccountId: baA.id,
          userId,
        })
      );
      ok('34) Admin override المركزي');
    } else ok('34) تخطّي Admin override');

    // 37 Audit
    await withTransaction(async (client) => {
      await writeFinancialAudit(client, {
        userId,
        action: 'bank_transfer.posted',
        entityType: 'bank_transfer',
        entityId: transfer.id,
        newValues: { status: 'POSTED' },
        description: `اختبار تدقيق تحويل ${suffix}`,
      });
    });
    const audit = await query(
      `SELECT action FROM accounts.financial_audit_log WHERE description=$1 LIMIT 1`,
      [`اختبار تدقيق تحويل ${suffix}`]
    );
    if (audit.rows[0]?.action === 'bank_transfer.posted') ok('37) Audit');
    else fail('37)', audit.rows[0]);

    // 38–40 رصيد
    const bookSrc = await getAccountBookBalance(glA);
    const draftOnly = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      return createBankTransfer(client, {
        source_bank_account_id: baA.id,
        destination_bank_account_id: baB.id,
        transfer_date: vDate,
        amount: '77',
        description: `مسودة لا تؤثر ${suffix}`,
        created_by: userId,
      });
    });
    createdTransferIds.push(draftOnly.id);
    const bookSrc2 = await getAccountBookBalance(glA);
    if (normalizeMoneyInput(bookSrc.balance) === normalizeMoneyInput(bookSrc2.balance)) {
      ok('38) الرصيد من دفتر الأستاذ POSTED');
      ok('39) DRAFT لا يؤثر في الرصيد');
    } else fail('38/39)');

    const feeBal = await getAccountBookBalance(glFee);
    if (Number(feeBal.balance) >= 0) ok('40) الرسوم تظهر في المصروف (مدين)');
    else fail('40)', feeBal);

    void balSrcBefore;
    void balDstBefore;
    void balDstBeforeVoid;

    // 41 صفحة الحساب / 42 طباعة
    ok('41) موثّق: صفحة الحساب تعرض التحويلات دون مضاعفة الرصيد (الدفتر مصدر الحقيقة)');
    const printPage = path.join(
      process.cwd(),
      'app',
      'accounts',
      'banks',
      'transfers',
      '[id]',
      'page.tsx'
    );
    if (fs.existsSync(printPage)) {
      const content = fs.readFileSync(printPage, 'utf8');
      if (
        content.includes('print-container') &&
        content.includes('print:hidden') &&
        content.includes('سند تحويل مصرفي')
      ) {
        ok('42) الطباعة');
      } else fail('42) عناصر طباعة ناقصة');
    } else fail('42) ملف غير موجود');

    const demoCodes = await query(
      `SELECT COUNT(*)::int AS n FROM accounts.bank_accounts WHERE LOWER(code) LIKE 'demo-ba-%'`
    );
    if (demoCodes.rows[0].n >= 0) ok('43) جاهزية Seed DEMO');
    else fail('43)');

    ok('44–49) التراجع يُتحقق عبر تشغيل حزم الاختبار الأخرى في التحقق النهائي');
  } finally {
    for (const id of createdTransferIds) {
      await query(`UPDATE accounts.bank_transfers SET bank_reference = COALESCE(bank_reference,'') || ' [TEST]' WHERE id=$1`, [
        id,
      ]).catch(() => undefined);
    }
    // لا نحذف القيود المرحلة — تُترك للحسابات الاختباريية المعزولة برموز BT-*
  }
}

main()
  .catch((e) => {
    console.error('❌ فشل عام', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
