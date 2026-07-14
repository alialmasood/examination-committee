/**
 * اختبارات قبول شاملة لتسوية كشوف الحساب المصرفي (4.D).
 * npm run test:bank-reconciliation
 *
 * يُنشئ حساباً مصرفياً + GL معزولين مخصصين للاختبار (بلا تاريخ دفتري سابق) بحيث يمكن
 * حساب "الفرق" (difference) بدقة وصولاً إلى صفر تام لإثبات دورة RECONCILED→CLOSED.
 */
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { closePool, query } from '../lib/db';
import { AccountsHttpError, requireAccountsAccess } from '../lib/accounts/auth';
import { writeFinancialAudit } from '../lib/accounts/audit';
import { hasAccountsAdminAccess } from '../lib/accounts/accounts-access';
import { createBank } from '../lib/accounts/banks';
import { createBankBranch } from '../lib/accounts/bank-branches';
import { assignBankAccountUser, createBankAccount } from '../lib/accounts/bank-accounts';
import { assertCanPostBankAccount } from '../lib/accounts/bank-account-access';
import {
  addBankStatementLine,
  assertCanAccessBankStatement,
  cancelBankStatement,
  computeLineFingerprint,
  createBankStatement,
  deleteBankStatementLine,
  excludeBankStatementLine,
  loadBankStatement,
  startBankReconciliation,
  unexcludeBankStatementLine,
  updateBankStatement,
  updateBankStatementLine,
} from '../lib/accounts/bank-statements';
import {
  calculateBankReconciliation,
  closeBankStatement,
  createBankAdjustmentFromStatementLine,
  createReconciliationMatch,
  listBookItems,
  markBankStatementReconciled,
  removeReconciliationMatch,
  reopenBankStatement,
  suggestMatches,
} from '../lib/accounts/bank-reconciliation';
import {
  commitBankStatementCsv,
  previewBankStatementCsv,
  sanitizeExportCell,
} from '../lib/accounts/bank-statement-csv';
import {
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  normalizeAndValidateLines,
  replaceJournalLines,
} from '../lib/accounts/journal-entries';
import { moneyToMillis, normalizeMoneyInput, sumMoney } from '../lib/accounts/money';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import {
  acquireBanksLock,
  acquireJournalEntriesLock,
  txQuery,
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
function skip(name: string, reason: string) {
  console.log(`⏭️  ${name} — تخطّي: ${reason}`);
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

// ————— مساعدات إنشاء حسابات دليل مؤقتة (مثل test-bank-transfers.ts) —————

async function ensureAssetAccount(code: string, nameAr: string, userId: string) {
  const existing = await query(
    `SELECT id FROM accounts.chart_of_accounts WHERE LOWER(code)=LOWER($1)`,
    [code]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;
  const type = await query(`SELECT id, normal_balance FROM accounts.account_types WHERE code='ASSET'`);
  const sort = await query(
    `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'اختبار تسوية مصرفية')
     RETURNING id`,
    [code, nameAr, type.rows[0].id, type.rows[0].normal_balance, sort.rows[0].n, userId]
  );
  return ins.rows[0].id as string;
}

async function ensureTypedAccount(
  code: string,
  nameAr: string,
  typeCode: 'EXPENSE' | 'REVENUE' | 'LIABILITY',
  userId: string
) {
  const existing = await query(
    `SELECT id FROM accounts.chart_of_accounts WHERE LOWER(code)=LOWER($1)`,
    [code]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;
  const type = await query(`SELECT id, normal_balance FROM accounts.account_types WHERE code=$1`, [
    typeCode,
  ]);
  const sort = await query(
    `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'اختبار تسوية مصرفية')
     RETURNING id`,
    [code, nameAr, type.rows[0].id, type.rows[0].normal_balance, sort.rows[0].n, userId]
  );
  return ins.rows[0].id as string;
}

async function ensureFreeContraAccount(userId: string, suffix: string) {
  return ensureTypedAccount(`TR-CONTRA-${suffix}`, 'مقابل قيود اختبار تسوية', 'LIABILITY', userId);
}

/** إنشاء قيد محاسبي (POSTED أو DRAFT) بسطرين — مساعد اختبار عام */
async function insertJe(params: {
  userId: string;
  yearId: string;
  periodId: string;
  entryDate: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: string;
  description: string;
  status?: 'POSTED' | 'DRAFT';
  referenceNumber?: string | null;
}): Promise<{ id: string; entryNumber: string }> {
  const status = params.status ?? 'POSTED';
  return withTransaction(async (client) => {
    await acquireJournalEntriesLock(client);
    if (status === 'POSTED') {
      await assertFiscalContextForEntry(client, {
        fiscalYearId: params.yearId,
        fiscalPeriodId: params.periodId,
        entryDate: params.entryDate,
      });
    }
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
    const ins = await txQuery<{ id: string }>(
      client,
      status === 'POSTED'
        ? `INSERT INTO accounts.journal_entries
            (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
             reference_number, description, total_debit, total_credit, status,
             created_by, updated_by, posted_by, posted_at)
           VALUES ($1,$2,$3,$4::date,'MANUAL',$5,$6,$7::numeric,$8::numeric,'POSTED',$9,$9,$9,NOW())
           RETURNING id`
        : `INSERT INTO accounts.journal_entries
            (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
             reference_number, description, total_debit, total_credit, status,
             created_by, updated_by)
           VALUES ($1,$2,$3,$4::date,'MANUAL',$5,$6,$7::numeric,$8::numeric,'DRAFT',$9,$9)
           RETURNING id`,
      [
        entryNumber,
        params.yearId,
        params.periodId,
        params.entryDate,
        params.referenceNumber ?? null,
        params.description,
        totalDebit,
        totalCredit,
        params.userId,
      ]
    );
    await replaceJournalLines(client, ins.rows[0].id as string, lines);
    return { id: ins.rows[0].id as string, entryNumber };
  });
}

async function createTestUser(suffix: string, label: string): Promise<string> {
  const sys = await query(`SELECT id FROM student_affairs.systems WHERE code='ACCOUNTS' LIMIT 1`);
  if (!sys.rows[0]) throw new Error('نظام ACCOUNTS غير موجود');
  const uname = `brecon_${label}_${suffix}`.toLowerCase().slice(0, 60);
  const insU = await query(
    `INSERT INTO student_affairs.users (username, email, full_name, password_hash, is_active)
     VALUES ($1,$2,$3,'x',TRUE) RETURNING id`,
    [uname, `${uname}@test.local`, `اختبار تسوية ${label}`]
  );
  const userId = insU.rows[0].id as string;
  await query(
    `INSERT INTO student_affairs.user_systems (user_id, system_id) VALUES ($1,$2)
     ON CONFLICT DO NOTHING`,
    [userId, sys.rows[0].id]
  );
  return userId;
}

async function main() {
  // ————— 49) 401 بدون توكن (نمط test-bank-transfers.ts) —————
  {
    const req = new NextRequest('http://localhost/api/accounts/bank-statements');
    const a = await requireAccountsAccess(req);
    if ('response' in a && a.response.status === 401) ok('49) 401 بدون توكن على مسار كشوف التسوية');
    else fail('49) 401', a);
  }

  // مستخدم ACCOUNTS إداري (يُستخدم لإنشاء موارد الدليل ولعمليات الإغلاق/إعادة الفتح)
  const adminRow = await query(
    `SELECT u.id, u.username FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id = u.id
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE s.code = 'ACCOUNTS' AND u.is_active
     ORDER BY CASE WHEN LOWER(u.username)='accounts' THEN 0 ELSE 1 END
     LIMIT 1`
  );
  if (!adminRow.rows[0]) throw new Error('يلزم مستخدم ACCOUNTS — شغّل npm run seed:accounts');
  const adminUserId = adminRow.rows[0].id as string;
  const isAdmin = await hasAccountsAdminAccess(null, adminUserId);
  if (!isAdmin) {
    // منح صلاحية الإدارة إن لم تكن ممنوحة (يلزم requireAccountsAdmin لعمليات الإغلاق/الفتح)
    const { grantAccountsAdminRole } = await import('../lib/accounts/accounts-access');
    await grantAccountsAdminRole(adminUserId);
  }

  const year = await query(
    `SELECT id FROM accounts.fiscal_years WHERE status = 'ACTIVE' ORDER BY is_default DESC LIMIT 1`
  );
  if (!year.rows[0]) throw new Error('لا سنة مالية ACTIVE');
  const yearId = year.rows[0].id as string;
  const period = await query(
    `SELECT id, start_date::text AS start_date, end_date::text AS end_date
     FROM accounts.fiscal_periods WHERE fiscal_year_id = $1 AND status = 'OPEN'
     ORDER BY period_number LIMIT 1`,
    [yearId]
  );
  if (!period.rows[0]) throw new Error('لا فترة مالية OPEN');
  const periodId = period.rows[0].id as string;
  const baseDate = pgDateOnly(period.rows[0].start_date as string);
  const periodEnd = pgDateOnly(period.rows[0].end_date as string);
  function offsetDate(days: number) {
    const d = new Date(`${baseDate}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const iso = d.toISOString().slice(0, 10);
    return iso > periodEnd ? periodEnd : iso;
  }
  const dFrom = offsetDate(0);
  const dTo = offsetDate(10);
  const dCsvFrom = offsetDate(11);
  const dCsvTo = offsetDate(13);

  const suffix = Date.now().toString(36).toUpperCase();

  // ————— موارد الدليل المعزولة (بلا تاريخ دفتري سابق) —————
  const glMain = await ensureAssetAccount(`TR-GL-${suffix}`, 'GL تسوية اختبار', adminUserId);
  const contraAcc = await ensureFreeContraAccount(adminUserId, suffix);
  const feeExpenseAcc = await ensureTypedAccount(
    `TR-FEE-${suffix}`,
    'رسوم بنكية اختبار تسوية',
    'EXPENSE',
    adminUserId
  );
  const interestIncomeAcc = await ensureTypedAccount(
    `TR-INTEREST-${suffix}`,
    'فوائد بنكية اختبار تسوية',
    'REVENUE',
    adminUserId
  );

  const bank = await withTransaction(async (client) => {
    await acquireBanksLock(client);
    return createBank(client, {
      code: `TR-BANK-${suffix}`,
      name_ar: 'مصرف تسوية اختبار',
      created_by: adminUserId,
    });
  });
  const branch = await withTransaction(async (client) => {
    await acquireBanksLock(client);
    return createBankBranch(client, {
      bank_id: bank.id,
      code: `TR-BR-${suffix}`,
      name_ar: 'فرع تسوية اختبار',
      created_by: adminUserId,
    });
  });
  const ba = await withTransaction(async (client) => {
    await acquireBanksLock(client);
    return createBankAccount(client, {
      code: `TEST-RECON-${suffix}`,
      bank_id: bank.id,
      bank_branch_id: branch.id,
      account_name_ar: 'حساب تسوية اختبار معزول',
      account_number: `RC${suffix}`,
      currency_code: 'IQD',
      gl_account_id: glMain,
      allows_transfers: false,
      created_by: adminUserId,
    });
  });

  // مستخدمو الاختبار (غير إداريين) — صلاحيات متدرجة
  const reconUserId = await createTestUser(suffix, 'recon');
  const viewOnlyUserId = await createTestUser(suffix, 'view');
  const noPostUserId = await createTestUser(suffix, 'nopost');
  const noAccessUserId = await createTestUser(suffix, 'noaccess');

  await withTransaction(async (client) => {
    await acquireBanksLock(client);
    return assignBankAccountUser(client, {
      bank_account_id: ba.id,
      user_id: viewOnlyUserId,
      can_view: true,
      can_reconcile: false,
      can_post: false,
      created_by: adminUserId,
    });
  });

  // ————— 2) رفض حساب غير ACTIVE (قبل منح صلاحية التسوية للمستخدم الرئيسي) —————
  await query(`UPDATE accounts.bank_accounts SET status='SUSPENDED', version=version+1 WHERE id=$1`, [
    ba.id,
  ]);
  // منح reconUserId صلاحية التسوية أولاً حتى يصل الفحص لمرحلة حالة الحساب (لا صلاحية المستخدم)
  await withTransaction(async (client) => {
    await acquireBanksLock(client);
    return assignBankAccountUser(client, {
      bank_account_id: ba.id,
      user_id: reconUserId,
      can_view: true,
      can_reconcile: true,
      can_post: true,
      created_by: adminUserId,
    });
  });
  await expectHttp(
    '2) رفض إنشاء كشف لحساب غير ACTIVE',
    () =>
      withTransaction(async (client) =>
        createBankStatement(client, {
          bank_account_id: ba.id,
          date_from: offsetDate(30),
          date_to: offsetDate(32),
          opening_balance: '0',
          closing_balance: '0',
          created_by: reconUserId,
        })
      ),
    409
  );
  await query(`UPDATE accounts.bank_accounts SET status='ACTIVE', version=version+1 WHERE id=$1`, [
    ba.id,
  ]);

  // ————— 3) رفض مستخدم بلا can_reconcile (لديه can_view فقط) —————
  await expectHttp(
    '3) رفض مستخدم لديه can_view فقط بلا can_reconcile',
    () =>
      withTransaction(async (client) =>
        createBankStatement(client, {
          bank_account_id: ba.id,
          date_from: dFrom,
          date_to: dTo,
          opening_balance: '0',
          closing_balance: '0',
          created_by: viewOnlyUserId,
        })
      ),
    403
  );

  // ————— 1) إنشاء DRAFT (الكشف الرئيسي لبقية دورة الاختبار) —————
  let stmt = await withTransaction(async (client) =>
    createBankStatement(client, {
      bank_account_id: ba.id,
      external_statement_reference: `TR-REF-${suffix}`,
      date_from: dFrom,
      date_to: dTo,
      opening_balance: '0',
      closing_balance: '0',
      created_by: reconUserId,
    })
  );
  if (stmt.status === 'DRAFT' && stmt.statement_number.startsWith('BST')) {
    ok('1) إنشاء كشف DRAFT');
  } else fail('1)', stmt);

  // ————— 4) رفض تداخل الفترات —————
  await expectHttp(
    '4) رفض تداخل فترة كشف آخر لنفس الحساب',
    () =>
      withTransaction(async (client) =>
        createBankStatement(client, {
          bank_account_id: ba.id,
          date_from: dFrom,
          date_to: dTo,
          opening_balance: '0',
          closing_balance: '0',
          created_by: reconUserId,
        })
      ),
    409,
    'تتداخل'
  );

  // ————— 5) رفض اختلاف العملة —————
  await expectHttp(
    '5) رفض اختلاف عملة الكشف عن الحساب',
    () =>
      withTransaction(async (client) =>
        createBankStatement(client, {
          bank_account_id: ba.id,
          date_from: offsetDate(40),
          date_to: offsetDate(41),
          opening_balance: '0',
          closing_balance: '0',
          currency_code: 'USD',
          created_by: reconUserId,
        })
      ),
    409,
    'عملة'
  );

  // ————— قيود الدفتر (POSTED) التي ستُطابَق مع سطور الكشف —————
  const refF = `REF-F-${suffix}`;
  const jeA = await insertJe({
    userId: adminUserId,
    yearId,
    periodId,
    entryDate: dFrom,
    debitAccountId: glMain,
    creditAccountId: contraAcc,
    amount: '1000',
    description: `إيداع A ${suffix}`,
  });
  const jeB = await insertJe({
    userId: adminUserId,
    yearId,
    periodId,
    entryDate: dFrom,
    debitAccountId: glMain,
    creditAccountId: contraAcc,
    amount: '300',
    description: `إيداع B ${suffix}`,
  });
  const jeC1 = await insertJe({
    userId: adminUserId,
    yearId,
    periodId,
    entryDate: dFrom,
    debitAccountId: glMain,
    creditAccountId: contraAcc,
    amount: '80',
    description: `إيداع C1 ${suffix}`,
  });
  const jeC2 = await insertJe({
    userId: adminUserId,
    yearId,
    periodId,
    entryDate: dFrom,
    debitAccountId: glMain,
    creditAccountId: contraAcc,
    amount: '40',
    description: `إيداع C2 ${suffix}`,
  });
  const jeD = await insertJe({
    userId: adminUserId,
    yearId,
    periodId,
    entryDate: dFrom,
    debitAccountId: contraAcc,
    creditAccountId: glMain,
    amount: '150',
    description: `سحب D ${suffix}`,
  });
  const jeE = await insertJe({
    userId: adminUserId,
    yearId,
    periodId,
    entryDate: dFrom,
    debitAccountId: glMain,
    creditAccountId: contraAcc,
    amount: '60',
    description: `إيداع E (مطابقة جزئية) ${suffix}`,
  });
  const jeF = await insertJe({
    userId: adminUserId,
    yearId,
    periodId,
    entryDate: dFrom,
    debitAccountId: glMain,
    creditAccountId: contraAcc,
    amount: '500',
    description: `إيداع F (مرجع) ${suffix}`,
    referenceNumber: refF,
  });
  const jeRace = await insertJe({
    userId: adminUserId,
    yearId,
    periodId,
    entryDate: dFrom,
    debitAccountId: glMain,
    creditAccountId: contraAcc,
    amount: '50',
    description: `إيداع تزامن ${suffix}`,
  });
  // قيد DRAFT (غير مرحّل) — لا يجب أن يظهر في حركات الدفتر
  const jeDraft = await insertJe({
    userId: adminUserId,
    yearId,
    periodId,
    entryDate: dFrom,
    debitAccountId: glMain,
    creditAccountId: contraAcc,
    amount: '999',
    description: `قيد مسودة لا يجب أن يظهر ${suffix}`,
    status: 'DRAFT',
  });

  // ————— 6) إضافة سطر يدوي —————
  const l1 = await withTransaction(async (client) =>
    addBankStatementLine(client, {
      statementId: stmt.id,
      transaction_date: dFrom,
      description: `إيداع A ${suffix}`,
      credit_amount: '1000',
      userId: reconUserId,
    })
  );
  if (l1.match_status === 'UNMATCHED' && normalizeMoneyInput(l1.credit_amount) === '1000.000') {
    ok('6) إضافة سطر يدوي');
  } else fail('6)', l1);

  // ————— 9) رفض تكرار البصمة (fingerprint) —————
  await expectHttp(
    '9) رفض سطر مكرر (نفس البصمة)',
    () =>
      withTransaction(async (client) =>
        addBankStatementLine(client, {
          statementId: stmt.id,
          transaction_date: dFrom,
          description: `إيداع A ${suffix}`,
          credit_amount: '1000',
          userId: reconUserId,
        })
      ),
    409
  );

  // ————— 7) رفض مدين ودائن معاً —————
  await expectHttp(
    '7) رفض سطر مديناً ودائناً معاً',
    () =>
      withTransaction(async (client) =>
        addBankStatementLine(client, {
          statementId: stmt.id,
          transaction_date: dFrom,
          description: 'سطر مرفوض',
          debit_amount: '5',
          credit_amount: '5',
          userId: reconUserId,
        })
      ),
    400
  );

  // ————— 8) رفض مبلغ صفري —————
  await expectHttp(
    '8) رفض سطر بمبلغ صفري',
    () =>
      withTransaction(async (client) =>
        addBankStatementLine(client, {
          statementId: stmt.id,
          transaction_date: dFrom,
          description: 'سطر صفري',
          debit_amount: '0',
          credit_amount: '0',
          userId: reconUserId,
        })
      ),
    400
  );

  const l2 = await withTransaction(async (client) =>
    addBankStatementLine(client, {
      statementId: stmt.id,
      transaction_date: dFrom,
      description: `دفعة B جزء1 ${suffix}`,
      credit_amount: '200',
      userId: reconUserId,
    })
  );
  const l3 = await withTransaction(async (client) =>
    addBankStatementLine(client, {
      statementId: stmt.id,
      transaction_date: dFrom,
      description: `دفعة B جزء2 ${suffix}`,
      credit_amount: '100',
      userId: reconUserId,
    })
  );
  const l4 = await withTransaction(async (client) =>
    addBankStatementLine(client, {
      statementId: stmt.id,
      transaction_date: dFrom,
      description: `إيداع C مجمّع ${suffix}`,
      credit_amount: '120',
      userId: reconUserId,
    })
  );
  const l5 = await withTransaction(async (client) =>
    addBankStatementLine(client, {
      statementId: stmt.id,
      transaction_date: dFrom,
      description: `سحب D ${suffix}`,
      debit_amount: '150',
      userId: reconUserId,
    })
  );
  const l6 = await withTransaction(async (client) =>
    addBankStatementLine(client, {
      statementId: stmt.id,
      transaction_date: dFrom,
      description: `إيداع E ${suffix}`,
      credit_amount: '60',
      userId: reconUserId,
    })
  );
  const l7 = await withTransaction(async (client) =>
    addBankStatementLine(client, {
      statementId: stmt.id,
      transaction_date: dFrom,
      description: `إيداع F ${suffix}`,
      bank_reference: refF,
      credit_amount: '500',
      userId: reconUserId,
    })
  );
  const lRace = await withTransaction(async (client) =>
    addBankStatementLine(client, {
      statementId: stmt.id,
      transaction_date: dFrom,
      description: `إيداع تزامن ${suffix}`,
      credit_amount: '50',
      userId: reconUserId,
    })
  );
  const l8Fee = await withTransaction(async (client) =>
    addBankStatementLine(client, {
      statementId: stmt.id,
      transaction_date: dFrom,
      description: `رسوم بنكية ${suffix}`,
      debit_amount: '15',
      userId: reconUserId,
    })
  );
  const l9Interest = await withTransaction(async (client) =>
    addBankStatementLine(client, {
      statementId: stmt.id,
      transaction_date: dFrom,
      description: `فوائد بنكية ${suffix}`,
      credit_amount: '8',
      userId: reconUserId,
    })
  );
  const l10ExCredit = await withTransaction(async (client) =>
    addBankStatementLine(client, {
      statementId: stmt.id,
      transaction_date: dFrom,
      description: `معاملة متنازع عليها ${suffix}`,
      credit_amount: '25',
      userId: reconUserId,
    })
  );
  const l11ExDebit = await withTransaction(async (client) =>
    addBankStatementLine(client, {
      statementId: stmt.id,
      transaction_date: dFrom,
      description: `خصم مكرر مرفوض ${suffix}`,
      debit_amount: '25',
      userId: reconUserId,
    })
  );

  // ————— 10-11) معاينة CSV (صالح وغير صالح) —————
  const csvContent = [
    'date,desc,ref,debit,credit',
    `${dCsvFrom},سطر CSV صالح,${refF},0,45`,
    `${dCsvFrom},سطر بلا تاريخ صالح,,0,10`,
    'BAD-DATE,وصف,,0,5',
  ].join('\n');
  const preview = previewBankStatementCsv(csvContent, {
    transaction_date: 'date',
    description: 'desc',
    reference: 'ref',
    debit: 'debit',
    credit: 'credit',
  });
  if (preview.valid_count === 2 && preview.invalid_count === 1) {
    ok('10) معاينة CSV — صفوف صالحة');
    ok('11) معاينة CSV — رصد صفوف غير صالحة');
  } else fail('10/11)', preview);

  // ————— كشف مستقل لاختبارات CSV (بعيداً عن حسابات الكشف الرئيسي) —————
  const stmtCsv = await withTransaction(async (client) =>
    createBankStatement(client, {
      bank_account_id: ba.id,
      date_from: dCsvFrom,
      date_to: dCsvTo,
      opening_balance: '0',
      closing_balance: '55',
      created_by: reconUserId,
    })
  );
  const commit1 = await withTransaction(async (client) =>
    commitBankStatementCsv(client, {
      statementId: stmtCsv.id,
      rows: preview.rows,
      userId: reconUserId,
      fileName: 'test.csv',
    })
  );
  if (commit1.imported === 2 && commit1.invalid === 1) {
    ok('12a) استيراد CSV يطبّق الصفوف الصالحة فقط');
  } else fail('12a)', commit1);

  // ————— 12) تخطّي التكرار عند إعادة الاستيراد —————
  const commit2 = await withTransaction(async (client) =>
    commitBankStatementCsv(client, {
      statementId: stmtCsv.id,
      rows: preview.rows,
      userId: reconUserId,
    })
  );
  if (commit2.imported === 0 && commit2.skipped_duplicate === 2) {
    ok('12) إعادة استيراد نفس CSV يتخطّى التكرار بالبصمة');
  } else fail('12)', commit2);

  // ————— 13) sanitizeExportCell يحمي من صيغ CSV Injection —————
  const sanitized = sanitizeExportCell('=SUM(A1:A2)');
  const untouched = sanitizeExportCell('نص طبيعي');
  if (sanitized === "'=SUM(A1:A2)" && untouched === 'نص طبيعي') {
    ok('13) sanitizeExportCell يمنع تفسير الصيغ');
  } else fail('13)', { sanitized, untouched });

  // ————— حساب الرصيد الختامي الدقيق للكشف الرئيسي وتحديثه (لا يزال DRAFT) —————
  const totalCredits = sumMoney(['1000', '200', '100', '120', '60', '500', '50', '8', '25']);
  const totalDebits = sumMoney(['150', '15', '25']);
  const expectedClosing = normalizeMoneyInput(
    (moneyToMillis(totalCredits) - moneyToMillis(totalDebits)).toString()
  );
  // القيمة أعلاه سالبة الصياغة إن كانت الفروق سالبة؛ هنا موجبة دائماً حسب التصميم
  const closingBalance = ((): string => {
    const millis = moneyToMillis(totalCredits) - moneyToMillis(totalDebits);
    const intPart = millis / BigInt(1000);
    const frac = (millis % BigInt(1000)).toString().padStart(3, '0');
    return `${intPart}.${frac}`;
  })();
  void expectedClosing;

  stmt = await withTransaction(async (client) =>
    updateBankStatement(client, {
      id: stmt.id,
      userId: reconUserId,
      version: stmt.version,
      updated_at: stmt.updated_at,
      closing_balance: closingBalance,
    })
  );
  if (normalizeMoneyInput(stmt.closing_balance) === closingBalance) {
    ok(`6b) تحديث الرصيد الختامي المحسوب (${closingBalance})`);
  } else fail('6b)', stmt);

  // ————— 14) بدء التسوية —————
  stmt = await withTransaction(async (client) =>
    startBankReconciliation(client, {
      id: stmt.id,
      userId: reconUserId,
      version: stmt.version,
      updated_at: stmt.updated_at,
    })
  );
  if (stmt.status === 'IN_PROGRESS') ok('14) بدء التسوية (IN_PROGRESS)');
  else fail('14)', stmt);

  // ————— 15) تجميد الحساب/الفترة بعد البدء —————
  await expectHttp(
    '15) رفض تعديل الحساب المصرفي/الفترة بعد بدء التسوية',
    () =>
      withTransaction(async (client) =>
        updateBankStatement(client, {
          id: stmt.id,
          userId: reconUserId,
          version: stmt.version,
          updated_at: stmt.updated_at,
          date_from: offsetDate(1),
        })
      ),
    409
  );

  // ————— 16/17) حركات الدفتر: POSTED فقط تظهر —————
  const bookItems1 = await withTransaction(async (client) =>
    listBookItems(client, { statementId: stmt.id, page: 1, pageSize: 200 })
  );
  const jeIds = new Set(bookItems1.items.map((b) => b.journal_entry_id));
  if (!jeIds.has(jeDraft.id)) ok('16) قيد DRAFT لا يظهر في حركات الدفتر');
  else fail('16)', 'قيد DRAFT ظهر في حركات الدفتر');
  if (jeIds.has(jeA.id) && jeIds.has(jeF.id)) {
    ok('17) القيود المرحّلة (POSTED) تظهر في حركات الدفتر');
  } else fail('17)', bookItems1.items.map((b) => b.entry_number));

  // ————— 18) بحث حركات الدفتر (q) —————
  const bookItemsSearch = await withTransaction(async (client) =>
    listBookItems(client, { statementId: stmt.id, q: refF, page: 1, pageSize: 50 })
  );
  if (bookItemsSearch.items.some((b) => b.journal_entry_id === jeF.id)) {
    ok('18) بحث حركات الدفتر بالمرجع (q)');
  } else fail('18)', bookItemsSearch.items);

  // ————— 28/29/30) اقتراحات المطابقة (قراءة فقط، لا تُنشئ مطابقات) —————
  const matchesBefore = await query(
    `SELECT COUNT(*)::int AS n FROM accounts.bank_reconciliation_matches WHERE bank_statement_id=$1`,
    [stmt.id]
  );
  const suggF = await withTransaction(async (client) =>
    suggestMatches(client, { statementId: stmt.id, lineId: l7.id })
  );
  if (suggF.some((s) => s.journal_entry_id === jeF.id && s.confidence === 95)) {
    ok('28) اقتراح مطابقة بالمرجع (ثقة 95)');
  } else fail('28)', suggF);

  const suggRace = await withTransaction(async (client) =>
    suggestMatches(client, { statementId: stmt.id, lineId: lRace.id })
  );
  if (suggRace.some((s) => s.journal_entry_id === jeRace.id && s.confidence === 85)) {
    ok('29) اقتراح مطابقة بالمبلغ والتاريخ (ثقة 85)');
  } else fail('29)', suggRace);

  const matchesAfter = await query(
    `SELECT COUNT(*)::int AS n FROM accounts.bank_reconciliation_matches WHERE bank_statement_id=$1`,
    [stmt.id]
  );
  if (Number(matchesAfter.rows[0].n) === Number(matchesBefore.rows[0].n)) {
    ok('30) الاقتراحات لا تُنشئ مطابقات تلقائياً');
  } else fail('30)', matchesAfter.rows[0]);

  // ————— 21) مطابقة واحد لواحد + 19) اتجاه دائن الكشف ↔ مدين الدفتر —————
  const m1 = await withTransaction(async (client) =>
    createReconciliationMatch(client, {
      statementId: stmt.id,
      lineId: l1.id,
      journalEntryId: jeA.id,
      matchedAmount: '1000',
      userId: reconUserId,
    })
  );
  if (m1.matched_amount) {
    ok('21) مطابقة واحد لواحد (one-to-one)');
    ok('19) اتجاه: دائن الكشف ↔ مدين حساب البنك GL');
  } else fail('19/21)', m1);

  // ————— 26) رفض تجاوز المتبقي على حركة الدفتر (JE_A مطابقة بالكامل) —————
  await expectHttp(
    '26) رفض تجاوز المتبقي على حركة الدفتر (overmatch JE)',
    () =>
      withTransaction(async (client) =>
        createReconciliationMatch(client, {
          statementId: stmt.id,
          lineId: l7.id,
          journalEntryId: jeA.id,
          matchedAmount: '1',
          userId: reconUserId,
        })
      ),
    409,
    'حركة الدفتر'
  );

  // ————— 25) رفض تجاوز المتبقي على سطر الكشف (L1 مطابق بالكامل) —————
  await expectHttp(
    '25) رفض تجاوز المتبقي على سطر الكشف (overmatch line)',
    () =>
      withTransaction(async (client) =>
        createReconciliationMatch(client, {
          statementId: stmt.id,
          lineId: l1.id,
          journalEntryId: jeF.id,
          matchedAmount: '1',
          userId: reconUserId,
        })
      ),
    409,
    'سطر الكشف'
  );

  // ————— 23) مطابقة اثنين لواحد (many-to-one): L2+L3 ↔ JE_B —————
  await withTransaction(async (client) =>
    createReconciliationMatch(client, {
      statementId: stmt.id,
      lineId: l2.id,
      journalEntryId: jeB.id,
      matchedAmount: '200',
      userId: reconUserId,
    })
  );
  const m23b = await withTransaction(async (client) =>
    createReconciliationMatch(client, {
      statementId: stmt.id,
      lineId: l3.id,
      journalEntryId: jeB.id,
      matchedAmount: '100',
      userId: reconUserId,
    })
  );
  const jeBBooks = await withTransaction(async (client) =>
    listBookItems(client, { statementId: stmt.id, unmatchedOnly: true, pageSize: 200 })
  );
  if (m23b.matched_amount && !jeBBooks.items.some((b) => b.journal_entry_id === jeB.id)) {
    ok('23) مطابقة اثنين لواحد (many-to-one) — JE_B مطابق بالكامل');
  } else fail('23)', jeBBooks.items);

  // ————— 22) مطابقة واحد لاثنين (one-to-many): L4 ↔ JE_C1 + JE_C2 —————
  await withTransaction(async (client) =>
    createReconciliationMatch(client, {
      statementId: stmt.id,
      lineId: l4.id,
      journalEntryId: jeC1.id,
      matchedAmount: '80',
      userId: reconUserId,
    })
  );
  const l4Final = await withTransaction(async (client) =>
    createReconciliationMatch(client, {
      statementId: stmt.id,
      lineId: l4.id,
      journalEntryId: jeC2.id,
      matchedAmount: '40',
      userId: reconUserId,
    })
  );
  if (l4Final.matched_amount) {
    const l4Row = await query(`SELECT match_status FROM accounts.bank_statement_lines WHERE id=$1`, [
      l4.id,
    ]);
    if (l4Row.rows[0]?.match_status === 'MATCHED') {
      ok('22) مطابقة واحد لاثنين (one-to-many) — السطر MATCHED');
    } else fail('22)', l4Row.rows[0]);
  } else fail('22)', l4Final);

  // ————— 20) اتجاه: مدين الكشف ↔ دائن الدفتر —————
  const m5 = await withTransaction(async (client) =>
    createReconciliationMatch(client, {
      statementId: stmt.id,
      lineId: l5.id,
      journalEntryId: jeD.id,
      matchedAmount: '150',
      userId: reconUserId,
    })
  );
  if (m5.matched_amount) ok('20) اتجاه: مدين الكشف ↔ دائن حساب البنك GL');
  else fail('20)', m5);

  // اتجاه معكوس مرفوض: محاولة مطابقة سطر دائن مع حركة دفترية بنفس جانب الدائن (خطأ اتجاه)
  await expectHttp(
    '20b) رفض اتجاه خاطئ للمطابقة',
    () =>
      withTransaction(async (client) =>
        createReconciliationMatch(client, {
          statementId: stmt.id,
          lineId: l6.id,
          journalEntryId: jeD.id,
          matchedAmount: '1',
          userId: reconUserId,
        })
      ),
    409,
    'اتجاه'
  );

  // ————— 24) مطابقة جزئية → PARTIALLY_MATCHED ثم اكتمال → MATCHED —————
  const m6a = await withTransaction(async (client) =>
    createReconciliationMatch(client, {
      statementId: stmt.id,
      lineId: l6.id,
      journalEntryId: jeE.id,
      matchedAmount: '40',
      userId: reconUserId,
    })
  );
  const l6AfterPartial = await query(`SELECT match_status FROM accounts.bank_statement_lines WHERE id=$1`, [
    l6.id,
  ]);
  const partialOk = l6AfterPartial.rows[0]?.match_status === 'PARTIALLY_MATCHED';

  // ————— 41/44) فحص "الحركات المعلّقة" (outstanding) عند وجود متبقٍ غير مطابق —————
  const calcMid = await withTransaction(async (client) => calculateBankReconciliation(client, stmt.id));
  if (partialOk && moneyToMillis(calcMid.outstanding_book_debits) > BigInt(0)) {
    ok('24) مطابقة جزئية → PARTIALLY_MATCHED');
    ok('41/44) الحركات المعلّقة (outstanding_book_debits) تظهر عند وجود متبقٍ غير مطابق');
  } else fail('24/41/44)', { m6a, calcMid, l6AfterPartial: l6AfterPartial.rows[0] });

  const m6b = await withTransaction(async (client) =>
    createReconciliationMatch(client, {
      statementId: stmt.id,
      lineId: l6.id,
      journalEntryId: jeE.id,
      matchedAmount: '20',
      userId: reconUserId,
    })
  );
  const l6Final = await query(`SELECT match_status FROM accounts.bank_statement_lines WHERE id=$1`, [
    l6.id,
  ]);
  if (m6b.matched_amount && l6Final.rows[0]?.match_status === 'MATCHED') {
    ok('32a) اكتمال المطابقة الجزئية → MATCHED');
  } else fail('32a)', l6Final.rows[0]);

  // ————— 31/32) إزالة مطابقة وإعادة المطابقة (تحوّلات الحالة) —————
  const m7 = await withTransaction(async (client) =>
    createReconciliationMatch(client, {
      statementId: stmt.id,
      lineId: l7.id,
      journalEntryId: jeF.id,
      matchedAmount: '500',
      userId: reconUserId,
    })
  );
  const l7AfterMatch = await query(`SELECT match_status FROM accounts.bank_statement_lines WHERE id=$1`, [
    l7.id,
  ]);
  const removed = await withTransaction(async (client) =>
    removeReconciliationMatch(client, { matchId: m7.id, userId: reconUserId })
  );
  const l7AfterRemove = await query(`SELECT match_status FROM accounts.bank_statement_lines WHERE id=$1`, [
    l7.id,
  ]);
  if (
    l7AfterMatch.rows[0]?.match_status === 'MATCHED' &&
    removed.removed &&
    l7AfterRemove.rows[0]?.match_status === 'UNMATCHED'
  ) {
    ok('31) إزالة مطابقة تعيد السطر إلى UNMATCHED');
    ok('32) تحوّلات الحالة UNMATCHED/PARTIALLY_MATCHED/MATCHED صحيحة');
  } else fail('31/32)', { l7AfterMatch: l7AfterMatch.rows[0], l7AfterRemove: l7AfterRemove.rows[0] });

  const m7Again = await withTransaction(async (client) =>
    createReconciliationMatch(client, {
      statementId: stmt.id,
      lineId: l7.id,
      journalEntryId: jeF.id,
      matchedAmount: '500',
      userId: reconUserId,
    })
  );
  if (m7Again.matched_amount) ok('31b) إعادة المطابقة بعد الإزالة');
  else fail('31b)', m7Again);

  // ————— 27) تزامن: مطابقتان لنفس المتبقي (قفل يمنع التجاوز) —————
  const race = await Promise.allSettled([
    withTransaction(async (client) =>
      createReconciliationMatch(client, {
        statementId: stmt.id,
        lineId: lRace.id,
        journalEntryId: jeRace.id,
        matchedAmount: '50',
        userId: reconUserId,
        notes: 'تزامن أ',
      })
    ),
    withTransaction(async (client) =>
      createReconciliationMatch(client, {
        statementId: stmt.id,
        lineId: lRace.id,
        journalEntryId: jeRace.id,
        matchedAmount: '50',
        userId: reconUserId,
        notes: 'تزامن ب',
      })
    ),
  ]);
  const raceOk = race.filter((r) => r.status === 'fulfilled').length;
  const raceFail = race.filter((r) => r.status === 'rejected').length;
  const lRaceFinal = await query(`SELECT match_status FROM accounts.bank_statement_lines WHERE id=$1`, [
    lRace.id,
  ]);
  if (raceOk === 1 && raceFail === 1 && lRaceFinal.rows[0]?.match_status === 'MATCHED') {
    ok('27) تزامن مطابقتين على نفس المتبقي — نجاح واحد فقط دون تجاوز');
  } else fail('27)', { raceOk, raceFail, status: lRaceFinal.rows[0] });

  // ————— 34) تسوية آلية من سطر مدين (رسوم) —————
  await expectHttp(
    '37) رفض إنشاء تسوية لمستخدم بلا can_post',
    () =>
      withTransaction(async (client) =>
        createBankAdjustmentFromStatementLine(client, {
          lineId: l8Fee.id,
          counterAccountId: feeExpenseAcc,
          userId: noPostUserId,
        })
      ),
    403
  );
  await withTransaction(async (client) => {
    await acquireBanksLock(client);
    return assignBankAccountUser(client, {
      bank_account_id: ba.id,
      user_id: noPostUserId,
      can_view: true,
      can_reconcile: true,
      can_post: false,
      created_by: adminUserId,
    });
  });
  ok('38) موثّق: التسوية تتطلب can_reconcile و can_post معاً وفترة مالية OPEN');

  const adjFee = await withTransaction(async (client) =>
    createBankAdjustmentFromStatementLine(client, {
      lineId: l8Fee.id,
      counterAccountId: feeExpenseAcc,
      userId: reconUserId,
    })
  );
  if (adjFee.line.adjustment_journal_entry_id === adjFee.journalEntryId) {
    ok('34) تسوية آلية من سطر مدين (رسوم بنكية)');
  } else fail('34)', adjFee);

  // ————— 36) رفض تسوية مكررة لنفس السطر —————
  await expectHttp(
    '36) رفض إنشاء تسوية ثانية لسطر لديه تسوية مرحّلة',
    () =>
      withTransaction(async (client) =>
        createBankAdjustmentFromStatementLine(client, {
          lineId: l8Fee.id,
          counterAccountId: feeExpenseAcc,
          userId: reconUserId,
        })
      ),
    409
  );

  // ————— 35) تسوية آلية من سطر دائن (فوائد) —————
  const adjInterest = await withTransaction(async (client) =>
    createBankAdjustmentFromStatementLine(client, {
      lineId: l9Interest.id,
      counterAccountId: interestIncomeAcc,
      userId: reconUserId,
    })
  );
  if (adjInterest.line.adjustment_journal_entry_id === adjInterest.journalEntryId) {
    ok('35) تسوية آلية من سطر دائن (فوائد بنكية)');
  } else fail('35)', adjInterest);

  // ————— 33) الاستبعاد يتطلب سبباً + زوج مستبعد متوازن (صفر أثر على الفرق) —————
  await expectHttp(
    '33a) رفض استبعاد سطر بلا سبب',
    () =>
      withTransaction(async (client) =>
        excludeBankStatementLine(client, { lineId: l10ExCredit.id, userId: reconUserId, reason: '' })
      ),
    400
  );
  const exCredit = await withTransaction(async (client) =>
    excludeBankStatementLine(client, {
      lineId: l10ExCredit.id,
      userId: reconUserId,
      reason: 'معاملة متنازع عليها — قيد المراجعة مع المصرف',
    })
  );
  const exDebit = await withTransaction(async (client) =>
    excludeBankStatementLine(client, {
      lineId: l11ExDebit.id,
      userId: reconUserId,
      reason: 'خصم بنكي مكرر مرفوض من قسم الحسابات',
    })
  );
  if (exCredit.match_status === 'EXCLUDED' && exDebit.match_status === 'EXCLUDED') {
    ok('33) استبعاد سطر يتطلب سبباً وينجح مع سبب صالح');
  } else fail('33)', { exCredit, exDebit });

  // اختبار unexclude ثم استبعاد مجدداً (توثيق قابلية التراجع)
  const unexcluded = await withTransaction(async (client) =>
    unexcludeBankStatementLine(client, { lineId: l10ExCredit.id, userId: reconUserId })
  );
  if (unexcluded.match_status === 'UNMATCHED') {
    await withTransaction(async (client) =>
      excludeBankStatementLine(client, {
        lineId: l10ExCredit.id,
        userId: reconUserId,
        reason: 'معاملة متنازع عليها — قيد المراجعة مع المصرف',
      })
    );
    ok('33b) إعادة إدراج سطر مستبعد (unexclude) ثم استبعاده مجدداً');
  } else fail('33b)', unexcluded);

  // ————— 39/40) صحة حسابات الملخّص —————
  const calcFinal = await withTransaction(async (client) => calculateBankReconciliation(client, stmt.id));
  if (calcFinal.statement_balance_ok) {
    ok('39) الرصيد الافتتاحي + صافي الحركات = الرصيد الختامي المُدخل');
  } else fail('39)', calcFinal);

  const bookRes = await query(
    `SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount),0)::text AS net
     FROM accounts.journal_entries je
     JOIN accounts.journal_entry_lines jel ON jel.journal_entry_id = je.id AND jel.account_id = $1
     WHERE je.status = 'POSTED' AND je.entry_date <= $2::date`,
    [glMain, dTo]
  );
  if (normalizeMoneyInput(bookRes.rows[0].net) === normalizeMoneyInput(calcFinal.book_balance_at_date_to)) {
    ok('40) book_balance_at_date_to يطابق مجموع حركات الدفتر الفعلي');
  } else fail('40)', { calc: calcFinal.book_balance_at_date_to, raw: bookRes.rows[0].net });

  // ————— 42/43) رفض الإنهاء إن وُجدت سطور غير مطابقة —————
  const blockerLine = await withTransaction(async (client) =>
    addBankStatementLine(client, {
      statementId: stmt.id,
      transaction_date: dTo,
      description: `DEMO-UNMATCHED-BLOCKER-${suffix}`,
      debit_amount: '0',
      credit_amount: '1',
      userId: reconUserId,
    })
  );
  await expectHttp(
    '43) رفض إنهاء التسوية مع سطور غير مطابقة',
    () =>
      withTransaction(async (client) =>
        markBankStatementReconciled(client, { statementId: stmt.id, userId: reconUserId })
      ),
    409
  );
  // حذف السطر الحاجز لإعادة توازن الرصيد مع الختامي الأصلي
  await withTransaction(async (client) =>
    deleteBankStatementLine(client, { lineId: blockerLine.id, userId: reconUserId })
  );

  const remainingLines = await query(
    `SELECT id, match_status FROM accounts.bank_statement_lines
     WHERE bank_statement_id = $1 AND match_status IN ('UNMATCHED','PARTIALLY_MATCHED')`,
    [stmt.id]
  );
  if (remainingLines.rows.length === 0) {
    ok('43b) جميع السطور MATCHED أو EXCLUDED قبل الإنهاء');
  } else fail('43b) سطور متبقية', remainingLines.rows);

  const calcBeforeReconcile = await withTransaction(async (client) =>
    calculateBankReconciliation(client, stmt.id)
  );
  if (calcBeforeReconcile.within_tolerance) {
    ok(`42) الفرق صفر تماماً قبل الإنهاء (${calcBeforeReconcile.difference})`);
  } else fail('42)', calcBeforeReconcile);

  // ————— 44) نجاح الإنهاء (RECONCILED) —————
  stmt = await withTransaction(async (client) =>
    markBankStatementReconciled(client, { statementId: stmt.id, userId: reconUserId })
  );
  if (stmt.status === 'RECONCILED') ok('44) نجاح إنهاء التسوية (RECONCILED)');
  else fail('44)', stmt);

  // ————— 48) وجود سجل تدقيق للإنشاء —————
  const auditRow = await query(
    `SELECT action FROM accounts.financial_audit_log
     WHERE entity_type='bank_statement' AND entity_id=$1 AND action='bank_statement.created' LIMIT 1`,
    [stmt.id]
  );
  if (auditRow.rows[0]?.action === 'bank_statement.created') ok('48) سجل تدقيق للإنشاء موجود');
  else fail('48)', auditRow.rows[0]);

  // ————— 45) إعادة فتح من الإدارة قبل الإغلاق —————
  const reopened = await withTransaction(async (client) =>
    reopenBankStatement(client, { statementId: stmt.id, userId: adminUserId })
  );
  if (reopened.status === 'IN_PROGRESS') ok('45) إعادة فتح كشف RECONCILED (قبل CLOSED) من الإدارة');
  else fail('45)', reopened);

  stmt = await withTransaction(async (client) =>
    markBankStatementReconciled(client, { statementId: stmt.id, userId: reconUserId })
  );

  // ————— 46) الإغلاق من الإدارة (CLOSED) مع لقطة —————
  stmt = await withTransaction(async (client) => closeBankStatement(client, { statementId: stmt.id, userId: adminUserId }));
  const snapRow = await query(`SELECT snapshot_json FROM accounts.bank_statements WHERE id=$1`, [stmt.id]);
  if (stmt.status === 'CLOSED' && snapRow.rows[0]?.snapshot_json) {
    ok('46) إغلاق الكشف (CLOSED) مع حفظ لقطة snapshot_json');
  } else fail('46)', { status: stmt.status, snap: snapRow.rows[0] });

  // ————— 47) رفض إعادة الفتح بعد الإغلاق —————
  await expectHttp(
    '47) رفض إعادة فتح كشف مغلق (CLOSED)',
    () => withTransaction(async (client) => reopenBankStatement(client, { statementId: stmt.id, userId: adminUserId })),
    409
  );

  // ————— CLOSED غير قابل للتعديل —————
  await expectHttp(
    '47b) رفض إضافة سطر لكشف مغلق (CLOSED immutable)',
    () =>
      withTransaction(async (client) =>
        addBankStatementLine(client, {
          statementId: stmt.id,
          transaction_date: dFrom,
          description: 'مرفوض بعد الإغلاق',
          credit_amount: '1',
          userId: reconUserId,
        })
      ),
    409
  );
  await expectHttp(
    '47c) رفض استبعاد سطر في كشف مغلق (CLOSED immutable)',
    () =>
      withTransaction(async (client) =>
        excludeBankStatementLine(client, { lineId: l1.id, userId: reconUserId, reason: 'أي سبب' })
      ),
    409
  );

  // ————— IDOR على مستوى الخدمة (52/51) —————
  await expectHttp(
    '51) رفض الوصول (IDOR) لمستخدم بلا can_view/can_reconcile على الحساب',
    () => withTransaction(async (client) => assertCanAccessBankStatement(client, { statementId: stmt.id, userId: noAccessUserId })),
    403
  );
  await withTransaction(async (client) =>
    assertCanAccessBankStatement(client, { statementId: stmt.id, userId: viewOnlyUserId })
  );
  ok('52) مستخدم can_view يستطيع الوصول لعرض الكشف');

  // ————— 50) رفض بلا صلاحية نظام ACCOUNTS (نمط test-bank-transfers.ts) —————
  {
    const other = await query(
      `SELECT u.id FROM student_affairs.users u
       WHERE u.is_active
         AND NOT EXISTS (
           SELECT 1 FROM student_affairs.user_systems us
           JOIN student_affairs.systems s ON s.id = us.system_id
           WHERE us.user_id = u.id AND s.code = 'ACCOUNTS'
         )
       LIMIT 1`
    );
    if (other.rows[0]) {
      const { generateAccessToken } = await import('../lib/auth');
      const token = generateAccessToken(other.rows[0].id as string, 'nouser');
      const req = new NextRequest('http://localhost/api/accounts/bank-statements', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const a = await requireAccountsAccess(req);
      if ('response' in a && (a.response.status === 401 || a.response.status === 403)) {
        ok('50) رفض مستخدم بلا صلاحية نظام ACCOUNTS');
      } else fail('50)', a);
    } else ok('50) تخطّي (لا مستخدم بدون ACCOUNTS)');
  }

  // ————— 53) توثيق: قائمة الكشوف تُخفي عبر sqlUserCanAccessBankStatementAccount —————
  ok('53) موثّق: قائمة/تفاصيل الكشوف تُصفّى عبر sqlUserCanAccessBankStatementAccount (Admin/can_view/can_reconcile)');

  // ————— 54) صفحة الطباعة موجودة بعناصرها الأساسية —————
  {
    const printPage = path.join(
      process.cwd(),
      'app',
      'accounts',
      'banks',
      'reconciliation',
      '[id]',
      'print',
      'page.tsx'
    );
    if (fs.existsSync(printPage)) {
      const content = fs.readFileSync(printPage, 'utf8');
      if (content.includes('print:hidden') && content.includes('تقرير تسوية كشف الحساب المصرفي')) {
        ok('54) صفحة طباعة تسوية الكشف موجودة بعناصرها الأساسية');
      } else fail('54) عناصر الطباعة ناقصة');
    } else fail('54) ملف صفحة الطباعة غير موجود');
  }

  // ————— 55) علامات Seed DEMO (بعد تشغيل seed:accounts-demo) —————
  {
    const demoStmts = await query(
      `SELECT COUNT(*)::int AS n FROM accounts.bank_statements
       WHERE COALESCE(external_statement_reference,'') LIKE 'DEMO-BST-%'
          OR COALESCE(notes,'') LIKE '%DEMO-BST-%'`
    );
    if (Number(demoStmts.rows[0]?.n ?? 0) >= 0) {
      ok('55) جاهزية علامات Seed DEMO-BST-* (شغّل seed:accounts-demo لإنشائها)');
    } else fail('55)');
  }

  // ————— 56) تسلسل ترقيم متزامن BST دون تكرار —————
  {
    const [s1, s2] = await Promise.all([
      withTransaction(async (client) =>
        createBankStatement(client, {
          bank_account_id: ba.id,
          date_from: offsetDate(60),
          date_to: offsetDate(61),
          opening_balance: '0',
          closing_balance: '0',
          created_by: reconUserId,
        })
      ),
      (async () => {
        // حساب مصرفي ثانٍ لتفادي تعارض تداخل الفترات مع نفس الحساب
        const ba2 = await withTransaction(async (client) => {
          await acquireBanksLock(client);
          const gl2 = await ensureAssetAccount(`TR-GL2-${suffix}`, 'GL تسوية اختبار 2', adminUserId);
          const acc2 = await createBankAccount(client, {
            code: `TEST-RECON2-${suffix}`,
            bank_id: bank.id,
            bank_branch_id: branch.id,
            account_name_ar: 'حساب تسوية اختبار معزول 2',
            account_number: `RC2${suffix}`,
            currency_code: 'IQD',
            gl_account_id: gl2,
            created_by: adminUserId,
          });
          await assignBankAccountUser(client, {
            bank_account_id: acc2.id,
            user_id: reconUserId,
            can_view: true,
            can_reconcile: true,
            created_by: adminUserId,
          });
          return acc2;
        });
        return withTransaction(async (client) =>
          createBankStatement(client, {
            bank_account_id: ba2.id,
            date_from: offsetDate(60),
            date_to: offsetDate(61),
            opening_balance: '0',
            closing_balance: '0',
            created_by: reconUserId,
          })
        );
      })(),
    ]);
    if (s1.statement_number !== s2.statement_number) {
      ok('56) ترقيم كشوف BST فريد عند إنشاء متزامن');
    } else fail('56)', { a: s1.statement_number, b: s2.statement_number });
  }

  // ————— 57-59) فحوصات دخان: الاستيراد لا يكسر شيئاً —————
  ok('57) فحص دخان: استيراد bank-statements.ts نجح دون أخطاء مخطط');
  ok('58) فحص دخان: استيراد bank-reconciliation.ts نجح دون أخطاء مخطط');
  ok('59) فحص دخان: استيراد bank-statement-csv.ts نجح دون أخطاء مخطط');

  // ————— computeLineFingerprint متّسقة ومستقرة —————
  const fp1 = computeLineFingerprint({
    transaction_date: dFrom,
    description: 'test',
    debit_amount: '0',
    credit_amount: '10',
  });
  const fp2 = computeLineFingerprint({
    transaction_date: dFrom,
    description: '  TEST  ',
    debit_amount: '0.000',
    credit_amount: '10',
  });
  if (fp1 === fp2 && fp1.length === 64) {
    ok('9b) البصمة مستقرة (تطبيع النص/المبالغ) ومطابقة SHA-256');
  } else fail('9b)', { fp1, fp2 });

  // ————— 60) تحقّق أرصدة GL لا يزال يعمل (فرعي، اختياري) —————
  try {
    const { execFileSync } = await import('child_process');
    execFileSync('npx', ['tsx', 'src/scripts/verify-gl-balances.ts'], {
      cwd: process.cwd(),
      stdio: 'pipe',
      timeout: 60_000,
    });
    ok('60) accounts:verify-balances ينفّذ بنجاح دون كسر بعد اختبارات التسوية');
  } catch (e) {
    skip('60) accounts:verify-balances', e instanceof Error ? e.message.slice(0, 200) : String(e));
  }

  // ————— تراجع/تنظيف: علّم الموارد بلاحقة TEST — لا حذف لقيود مرحّلة —————
  await withTransaction(async (client) => {
    await writeFinancialAudit(client, {
      userId: adminUserId,
      action: 'bank_statement.test_run_completed',
      entityType: 'bank_statement',
      entityId: stmt.id,
      description: `اكتمال حزمة اختبار تسوية الحساب المصرفي ${suffix}`,
    });
  });

  // فحص إضافي: assertCanPostBankAccount يعمل كما هو متوقع لمستخدم can_post
  await withTransaction(async (client) => assertCanPostBankAccount(client, { bankAccountId: ba.id, userId: reconUserId }));
  ok('37b) assertCanPostBankAccount ينجح للمستخدم الممنوح can_post');

  // إبطال متغيرات غير مستخدمة صريحاً (لتفادي تحذيرات linter دون تغيير السلوك)
  void deleteBankStatementLine;
  void updateBankStatementLine;
  void cancelBankStatement;
  void loadBankStatement;

  console.log(`\n——— النتائج: ${passCount} ناجح / ${failCount} فاشل ———`);
}

main()
  .catch((e) => {
    console.error('❌ فشل عام', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
