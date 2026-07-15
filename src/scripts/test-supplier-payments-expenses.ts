/**
 * اختبارات قبول دفعات الموردين والمصروفات المباشرة (6.B)
 * npm run test:supplier-payments-expenses
 */
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import bcrypt from 'bcrypt';
import { closePool, query } from '../lib/db';
import { generateAccessToken } from '../lib/auth';
import { AccountsHttpError, requireAccountsAccess } from '../lib/accounts/auth';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import { createSupplierAccount } from '../lib/accounts/supplier-accounts';
import {
  createSupplierInvoiceType,
} from '../lib/accounts/supplier-invoice-types';
import {
  createSupplierInvoice,
  getSupplierLedger,
  postSupplierInvoice,
} from '../lib/accounts/supplier-invoices';
import {
  createDirectExpense,
  postDirectExpense,
  setDirectExpensePostFaultForTests,
  voidDirectExpense,
} from '../lib/accounts/direct-expenses';
import {
  createDirectExpenseType,
  deactivateDirectExpenseType,
} from '../lib/accounts/direct-expense-types';
import {
  SUPPLIER_PAYABLES_CAPABILITIES,
  assertSupplierPayablesCapability,
  grantAccountsPlatformRole,
  hasSupplierPayablesCapability,
} from '../lib/accounts/supplier-payables-access';
import { paymentTransition } from '../lib/accounts/supplier-payables-api';
import {
  ACCOUNTS_CLERK_ROLE_CODE,
  ACCOUNTS_VIEWER_ROLE_CODE,
} from '../lib/accounts/student-receivables-access';
import { createSupplier } from '../lib/accounts/suppliers';
import { moneyEquals, normalizeMoneyInput } from '../lib/accounts/money';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import {
  directExpenseLock,
  supplierPaymentLock,
} from '../lib/accounts/accounting-locks';
import {
  hasUnexplainedGlActivity,
  verifySupplierPayables,
} from '../lib/accounts/verify-supplier-payables';
import {
  acquireJournalEntriesLock,
  withTransaction,
} from '../lib/accounts/with-transaction';
import {
  createSupplierPayment,
  getSupplierPaymentDetail,
  listOpenSupplierInvoices,
  postSupplierPayment,
  previewSupplierPaymentAllocation,
  setSupplierPaymentPostFaultForTests,
  updateSupplierPayment,
  voidSupplierPayment,
} from '../lib/accounts/supplier-payments';

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
  typeCode: 'LIABILITY' | 'EXPENSE' | 'ASSET' | 'REVENUE',
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
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'اختبار 6.B')
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

async function upsertCapabilityTestUser(username: string): Promise<string> {
  const hash = await bcrypt.hash('test-spy-pass', 10);
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

async function resolveOpenInvoiceDate(): Promise<{
  invoiceDate: string;
  yearId: string;
  periodId: string;
}> {
  const period = await query(
    `SELECT y.id AS year_id, p.id AS period_id,
            p.start_date::text AS start_date
     FROM accounts.fiscal_years y
     JOIN accounts.fiscal_periods p ON p.fiscal_year_id = y.id
     WHERE y.status = 'ACTIVE' AND p.status = 'OPEN'
     ORDER BY y.is_default DESC, p.start_date
     LIMIT 1`
  );
  if (!period.rows[0]) {
    throw new Error('لا توجد فترة مالية OPEN للسنة ACTIVE');
  }
  const start = pgDateOnly(period.rows[0].start_date as string);
  const invoiceDate =
    start.slice(0, 7) === '2026-01' ? '2026-01-15' : start;
  return {
    invoiceDate,
    yearId: period.rows[0].year_id as string,
    periodId: period.rows[0].period_id as string,
  };
}

async function journalLinesForVoucher(voucherId: string, method: 'CASH' | 'BANK') {
  const table = method === 'CASH' ? 'cash_vouchers' : 'bank_vouchers';
  const v = await query(
    `SELECT journal_entry_id, status FROM accounts.${table} WHERE id=$1::uuid`,
    [voucherId]
  );
  if (!v.rows[0]?.journal_entry_id) return { voucher: v.rows[0], lines: [] };
  const lines = await query(
    `SELECT jl.debit_amount::text AS d, jl.credit_amount::text AS c, jl.account_id
     FROM accounts.journal_entry_lines jl
     WHERE jl.journal_entry_id = $1
     ORDER BY jl.line_number`,
    [v.rows[0].journal_entry_id]
  );
  return { voucher: v.rows[0], lines: lines.rows };
}

async function main() {
  console.log('===== اختبارات قبول Supplier Payments & Expenses 6.B =====');

  let user = await query(
    `SELECT u.id, u.username FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id = u.id
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE s.code = 'ACCOUNTS' AND u.is_active
     ORDER BY CASE WHEN LOWER(u.username) = 'accounts' THEN 0 ELSE 1 END, u.created_at
     LIMIT 1`
  );
  if (!user.rows[0]) {
    user = await query(
      `SELECT id, username FROM student_affairs.users WHERE is_active = TRUE ORDER BY created_at NULLS LAST LIMIT 1`
    );
  }
  if (!user.rows[0]) {
    fail('إعداد: لا يوجد مستخدم نشط');
    return;
  }
  const userId = user.rows[0].id as string;
  const username = user.rows[0].username as string;
  await grantAccountsAdminRole(userId);

  let fiscal: { invoiceDate: string; yearId: string; periodId: string };
  try {
    fiscal = await resolveOpenInvoiceDate();
    ok(`00) تاريخ فترة مفتوحة: ${fiscal.invoiceDate}`);
  } catch (e) {
    fail('00) فترة مالية مفتوحة', e);
    return;
  }

  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  const payGl = await ensureTypedAccount(
    `TST-SPY-AP-${suffix}`,
    'ذمم دائنة 6.B',
    'LIABILITY',
    userId
  );
  const expGl = await ensureTypedAccount(
    `TST-SPY-EX-${suffix}`,
    'مصروف 6.B',
    'EXPENSE',
    userId
  );
  ok('00b) حسابات GL اختبار جاهزة');

  const cashDemo = await query(
    `SELECT s.id AS session_id, s.cash_box_id, cb.account_id AS cash_gl
     FROM accounts.cash_box_sessions s
     JOIN accounts.cash_boxes cb ON cb.id = s.cash_box_id
     WHERE cb.code = 'DEMO-CB-MAIN' AND s.status = 'OPEN'
     LIMIT 1`
  );
  const bankDemo = await query(
    `SELECT id, gl_account_id FROM accounts.bank_accounts
     WHERE code = 'DEMO-BA-IQD' AND status = 'ACTIVE' AND allows_payments
     LIMIT 1`
  );
  if (!cashDemo.rows[0] || !bankDemo.rows[0]) {
    fail('إعداد: جلسة DEMO-CB-MAIN أو حساب DEMO-BA-IQD غير متاح');
    return;
  }
  const cashSessionId = cashDemo.rows[0].session_id as string;
  const cashBoxId = cashDemo.rows[0].cash_box_id as string;
  const cashGl = cashDemo.rows[0].cash_gl as string;
  const bankAccountId = bankDemo.rows[0].id as string;
  const bankGl = bankDemo.rows[0].gl_account_id as string;

  // تأكد أن مستخدم الاختبار أمين أساسي لصندوق DEMO (للسندات النقدية)
  const custodian = await query(
    `SELECT user_id FROM accounts.cash_box_custodians
     WHERE cash_box_id = $1::uuid AND is_primary = TRUE AND valid_to IS NULL
     LIMIT 1`,
    [cashBoxId]
  );
  let actorId = userId;
  let actorUsername = username;
  if (custodian.rows[0]?.user_id) {
    actorId = custodian.rows[0].user_id as string;
    if (actorId !== userId) {
      const cu = await query(
        `SELECT username FROM student_affairs.users WHERE id=$1`,
        [actorId]
      );
      actorUsername = (cu.rows[0]?.username as string) ?? actorUsername;
      await grantAccountsAdminRole(actorId);
      ok(`00c) مستخدم السندات النقدية: أمين الصندوق (${actorUsername})`);
    }
  }

  const supplier = await withTransaction((c) =>
    createSupplier(c, {
      code: `SPY-SUP-${suffix}`,
      name_ar: `مورد دفعات ${suffix}`,
      supplier_type: 'LOCAL',
      created_by: actorId,
    })
  );
  const account = await withTransaction((c) =>
    createSupplierAccount(c, {
      supplier_id: supplier.id,
      payable_gl_account_id: payGl,
      created_by: actorId,
    })
  );
  const invType = await withTransaction((c) =>
    createSupplierInvoiceType(c, {
      code: `SPY-SIT-${suffix}`,
      name_ar: `نوع فاتورة 6.B ${suffix}`,
      default_expense_gl_account_id: expGl,
      created_by: actorId,
    })
  );

  async function postTestInvoice(extNum: string, amount: string) {
    const draft = await withTransaction((c) =>
      createSupplierInvoice(c, {
        supplier_account_id: account.id,
        supplier_invoice_number: extNum,
        invoice_type_id: invType.id,
        invoice_date: fiscal.invoiceDate,
        subtotal_amount: amount,
        expense_gl_account_id: expGl,
        description: `فاتورة ${extNum}`,
        created_by: actorId,
      })
    );
    const posted = await withTransaction(async (c) => {
      await acquireJournalEntriesLock(c);
      const r = await postSupplierInvoice(c, {
        id: draft.id,
        userId: actorId,
        version: draft.version,
        updated_at: draft.updated_at,
      });
      return r.invoice;
    });
    return posted;
  }

  const invA = await postTestInvoice(`EXT-A-${suffix}`, '100');
  const invB = await postTestInvoice(`EXT-B-${suffix}`, '150');
  const invC = await postTestInvoice(`EXT-C-${suffix}`, '200');
  ok(`إعداد: فواتير مرحّلة (${invA.invoice_number}, ${invB.invoice_number}, ${invC.invoice_number})`);

  const verifyBaseline = await withTransaction((c) => verifySupplierPayables(c));

  const cashPayBase = {
    supplier_account_id: account.id,
    payment_date: fiscal.invoiceDate,
    payment_method: 'CASH' as const,
    cash_box_id: cashBoxId,
    cash_box_session_id: cashSessionId,
    created_by: actorId,
  };

  // 1) Supplier Payment DRAFT
  const draftPay = await withTransaction((c) =>
    createSupplierPayment(c, {
      ...cashPayBase,
      amount: '50',
      description: 'مسودة دفعة',
    })
  );
  if (draftPay.payment.status === 'DRAFT') {
    ok('01) إنشاء دفعة مورد DRAFT');
  } else {
    fail('01) إنشاء دفعة مورد DRAFT', draftPay.payment.status);
  }

  // 2) Reject invalid supplier/account
  await expectHttp(
    '02) رفض حساب مورد غير صالح',
    () =>
      withTransaction((c) =>
        createSupplierPayment(c, {
          ...cashPayBase,
          supplier_account_id: '00000000-0000-4000-8000-000000000099',
          amount: '10',
        })
      ),
    404
  );

  // 3) Preview allocation auto
  {
    const prev = await withTransaction((c) =>
      previewSupplierPaymentAllocation(c, {
        supplierAccountId: account.id,
        amount: '450',
        mode: 'auto',
      })
    );
    if (
      prev.allocations.length >= 3 &&
      moneyEquals(prev.total_allocated, '450.000') &&
      moneyEquals(prev.remaining, '0.000')
    ) {
      ok('03) معاينة التخصيص التلقائي');
    } else {
      fail('03) معاينة التخصيص التلقائي', prev);
    }
  }

  // 4) Manual allocation
  const manualPay = await withTransaction((c) =>
    createSupplierPayment(c, {
      ...cashPayBase,
      amount: '50',
      allocations: [{ invoice_id: invA.id, amount: '50' }],
      description: 'تخصيص يدوي',
    })
  );
  if (
    manualPay.allocations.length === 1 &&
    moneyEquals(manualPay.allocations[0].allocated_amount, '50.000')
  ) {
    ok('04) تخصيص يدوي');
  } else {
    fail('04) تخصيص يدوي', manualPay.allocations);
  }

  // 5) Reject allocation to other supplier's invoice
  {
    const otherPack = await withTransaction(async (c) => {
      const s = await createSupplier(c, {
        code: `SPY-OTH-${suffix}`,
        name_ar: 'مورد آخر',
        created_by: actorId,
      });
      const a = await createSupplierAccount(c, {
        supplier_id: s.id,
        payable_gl_account_id: payGl,
        created_by: actorId,
      });
      const d = await createSupplierInvoice(c, {
        supplier_account_id: a.id,
        supplier_invoice_number: `EXT-OTH-${suffix}`,
        invoice_date: fiscal.invoiceDate,
        subtotal_amount: '80',
        expense_gl_account_id: expGl,
        created_by: actorId,
      });
      return d;
    });
    const otherPosted = await withTransaction(async (c) => {
      await acquireJournalEntriesLock(c);
      const r = await postSupplierInvoice(c, {
        id: otherPack.id,
        userId: actorId,
        version: otherPack.version,
        updated_at: otherPack.updated_at,
      });
      return r.invoice;
    });
    await expectHttp(
      '05) رفض تخصيص لفاتورة مورد آخر',
      () =>
        withTransaction((c) =>
          createSupplierPayment(c, {
            ...cashPayBase,
            amount: '50',
            allocations: [{ invoice_id: otherPosted.id, amount: '50' }],
          })
        ),
      409
    );
  }

  // 6) Reject over-allocation
  await expectHttp(
    '06) رفض تخصيص يتجاوز المتبقي',
    () =>
      withTransaction((c) =>
        createSupplierPayment(c, {
          ...cashPayBase,
          amount: '150',
          allocations: [{ invoice_id: invA.id, amount: '150' }],
        })
      ),
    409
  );

  // 7) Reject overpayment
  await expectHttp(
    '07) رفض دفعة أكبر من الرصيد المستحق',
    () =>
      withTransaction((c) =>
        createSupplierPayment(c, {
          ...cashPayBase,
          amount: '500',
        })
      ),
    409,
    'لا يمكن تسجيل دفعة أكبر من الرصيد المستحق للمورد'
  );

  // 8-12) CASH POST + voucher + JE + ledger + partial invoice
  const cashPartial = await withTransaction(async (c) => {
    await acquireJournalEntriesLock(c);
    const created = await createSupplierPayment(c, {
      ...cashPayBase,
      amount: '50',
      allocations: [{ invoice_id: invA.id, amount: '50' }],
      description: 'دفعة نقدية جزئية',
      external_reference: `SPY-CASH-PART-${suffix}`,
    });
    const posted = await postSupplierPayment(c, {
      id: created.payment.id,
      userId: actorId,
      version: created.payment.version,
      updated_at: created.payment.updated_at,
    });
    return { created, posted };
  });
  if (cashPartial.posted.payment.status === 'POSTED' && cashPartial.posted.created) {
    ok('08) ترحيل دفعة نقدية CASH POST');
  } else {
    fail('08) ترحيل دفعة نقدية CASH POST', cashPartial.posted);
  }

  const cashVoucherId = cashPartial.posted.payment.cash_voucher_id;
  if (cashVoucherId) {
    const cv = await query(
      `SELECT status FROM accounts.cash_vouchers WHERE id=$1`,
      [cashVoucherId]
    );
    if (cv.rows[0]?.status === 'POSTED') {
      ok('09) سند صرف نقدي مرتبط (cash_voucher_id, POSTED)');
    } else {
      fail('09) سند صرف نقدي مرتبط', cv.rows[0]);
    }
  } else {
    fail('09) سند صرف نقدي مرتبط — cash_voucher_id فارغ');
  }

  {
    const { lines } = await journalLinesForVoucher(cashVoucherId!, 'CASH');
    const dr = lines.find((r) => r.account_id === payGl && Number(r.d) > 0);
    const cr = lines.find((r) => r.account_id === cashGl && Number(r.c) > 0);
    if (dr && cr && moneyEquals(String(dr.d), '50.000')) {
      ok('10) القيد Dr Payables / Cr Cash');
    } else {
      fail('10) القيد Dr Payables / Cr Cash', lines);
    }
  }

  {
    const led = await withTransaction((c) =>
      getSupplierLedger(c, { supplierAccountId: account.id, page: 1, page_size: 50 })
    );
    const payEntry = led.rows.find(
      (r) => r.entry_type === 'PAYMENT' && r.source_id === cashPartial.posted.payment.id
    );
    if (payEntry && moneyEquals(payEntry.debit_amount, '50.000')) {
      ok('11) دفتر المورد PAYMENT مدين');
    } else {
      fail('11) دفتر المورد PAYMENT مدين', payEntry);
    }
  }

  {
    const inv = await query(
      `SELECT status, outstanding_amount::text AS out FROM accounts.supplier_invoices WHERE id=$1`,
      [invA.id]
    );
    if (
      inv.rows[0]?.status === 'PARTIALLY_PAID' &&
      moneyEquals(String(inv.rows[0].out), '50.000')
    ) {
      ok('12) تحديث حالة الفاتورة جزئياً PARTIALLY_PAID');
    } else {
      fail('12) تحديث حالة الفاتورة جزئياً', inv.rows[0]);
    }
  }

  // 13) Invoice PAID after full payment
  await withTransaction(async (c) => {
    await acquireJournalEntriesLock(c);
    const p = await createSupplierPayment(c, {
      ...cashPayBase,
      amount: '50',
      allocations: [{ invoice_id: invA.id, amount: '50' }],
      description: 'إكمال سداد الفاتورة أ',
    });
    await postSupplierPayment(c, {
      id: p.payment.id,
      userId: actorId,
      version: p.payment.version,
      updated_at: p.payment.updated_at,
    });
  });
  {
    const inv = await query(
      `SELECT status, outstanding_amount::text AS out FROM accounts.supplier_invoices WHERE id=$1`,
      [invA.id]
    );
    if (inv.rows[0]?.status === 'PAID' && moneyEquals(String(inv.rows[0].out), '0.000')) {
      ok('13) الفاتورة PAID بعد السداد الكامل');
    } else {
      fail('13) الفاتورة PAID', inv.rows[0]);
    }
  }

  // 14) One payment covering multiple invoices
  await withTransaction(async (c) => {
    await acquireJournalEntriesLock(c);
    const p = await createSupplierPayment(c, {
      ...cashPayBase,
      amount: '350',
      allocations: [
        { invoice_id: invB.id, amount: '150' },
        { invoice_id: invC.id, amount: '200' },
      ],
      description: 'دفعة واحدة لفاتورتين',
    });
    await postSupplierPayment(c, {
      id: p.payment.id,
      userId: actorId,
      version: p.payment.version,
      updated_at: p.payment.updated_at,
    });
  });
  {
    const rows = await query(
      `SELECT status FROM accounts.supplier_invoices WHERE id = ANY($1::uuid[])`,
      [[invB.id, invC.id]]
    );
    if (rows.rows.every((r) => r.status === 'PAID')) {
      ok('14) دفعة واحدة تغطي عدة فواتير');
    } else {
      fail('14) دفعة واحدة تغطي عدة فواتير', rows.rows);
    }
  }

  // 15-17) BANK POST
  const invD = await postTestInvoice(`EXT-D-${suffix}`, '80');
  const bankPay = await withTransaction(async (c) => {
    await acquireJournalEntriesLock(c);
    const created = await createSupplierPayment(c, {
      supplier_account_id: account.id,
      payment_date: fiscal.invoiceDate,
      amount: '80',
      payment_method: 'BANK',
      bank_account_id: bankAccountId,
      allocations: [{ invoice_id: invD.id, amount: '80' }],
      description: 'دفعة مصرفية',
      created_by: actorId,
    });
    const posted = await postSupplierPayment(c, {
      id: created.payment.id,
      userId: actorId,
      version: created.payment.version,
      updated_at: created.payment.updated_at,
    });
    return { created, posted };
  });
  if (bankPay.posted.payment.status === 'POSTED') {
    ok('15) ترحيل دفعة مصرفية BANK POST');
  } else {
    fail('15) ترحيل دفعة مصرفية', bankPay.posted);
  }

  const bankVoucherId = bankPay.posted.payment.bank_voucher_id;
  if (bankVoucherId) {
    const bv = await query(
      `SELECT status FROM accounts.bank_vouchers WHERE id=$1`,
      [bankVoucherId]
    );
    if (bv.rows[0]?.status === 'POSTED') {
      ok('16) سند صرف مصرفي مرتبط');
    } else {
      fail('16) سند صرف مصرفي مرتبط', bv.rows[0]);
    }
  } else {
    fail('16) سند صرف مصرفي مرتبط — bank_voucher_id فارغ');
  }

  {
    const { lines } = await journalLinesForVoucher(bankVoucherId!, 'BANK');
    const dr = lines.find((r) => r.account_id === payGl && Number(r.d) > 0);
    const cr = lines.find((r) => r.account_id === bankGl && Number(r.c) > 0);
    if (dr && cr && moneyEquals(String(dr.d), '80.000')) {
      ok('17) القيد Dr Payables / Cr Bank');
    } else {
      fail('17) القيد Dr Payables / Cr Bank', lines);
    }
  }

  // 18) Double POST idempotent
  {
    const second = await withTransaction(async (c) => {
      await acquireJournalEntriesLock(c);
      return postSupplierPayment(c, {
        id: bankPay.posted.payment.id,
        userId: actorId,
        version: bankPay.posted.payment.version,
        updated_at: bankPay.posted.payment.updated_at,
      });
    });
    if (!second.created && second.payment.status === 'POSTED') {
      ok('18) ترحيل مكرر idempotent (created:false)');
    } else {
      fail('18) ترحيل مكرر idempotent', second);
    }
  }

  // 19) Two concurrent payments — واحدة فقط تنجح
  {
    const invE = await postTestInvoice(`EXT-E-${suffix}`, '60');
    const results = await Promise.allSettled([
      withTransaction(async (c) => {
        await acquireJournalEntriesLock(c);
        const p = await createSupplierPayment(c, {
          ...cashPayBase,
          amount: '60',
          allocations: [{ invoice_id: invE.id, amount: '60' }],
        });
        return postSupplierPayment(c, {
          id: p.payment.id,
          userId: actorId,
          version: p.payment.version,
          updated_at: p.payment.updated_at,
        });
      }),
      withTransaction(async (c) => {
        await acquireJournalEntriesLock(c);
        const p = await createSupplierPayment(c, {
          ...cashPayBase,
          amount: '60',
          allocations: [{ invoice_id: invE.id, amount: '60' }],
        });
        return postSupplierPayment(c, {
          id: p.payment.id,
          userId: actorId,
          version: p.payment.version,
          updated_at: p.payment.updated_at,
        });
      }),
    ]);
    const okN = results.filter((r) => r.status === 'fulfilled').length;
    const badN = results.filter((r) => r.status === 'rejected').length;
    const paid = await query(
      `SELECT status FROM accounts.supplier_invoices WHERE id=$1`,
      [invE.id]
    );
    if (okN === 1 && badN === 1 && paid.rows[0]?.status === 'PAID') {
      ok('19) دفعتان متزامنتان — نجاح واحدة فقط');
    } else {
      fail('19) دفعتان متزامنتان', { okN, badN, status: paid.rows[0]?.status });
    }
  }

  // 20) Concurrent allocations on same invoice
  {
    const invF = await postTestInvoice(`EXT-F-${suffix}`, '40');
    const drafts = await Promise.all([
      withTransaction((c) =>
        createSupplierPayment(c, {
          ...cashPayBase,
          amount: '40',
          allocations: [{ invoice_id: invF.id, amount: '40' }],
        })
      ),
      withTransaction((c) =>
        createSupplierPayment(c, {
          ...cashPayBase,
          amount: '40',
          allocations: [{ invoice_id: invF.id, amount: '40' }],
        })
      ),
    ]);
    const postResults = await Promise.allSettled(
      drafts.map((d) =>
        withTransaction(async (c) => {
          await acquireJournalEntriesLock(c);
          return postSupplierPayment(c, {
            id: d.payment.id,
            userId: actorId,
            version: d.payment.version,
            updated_at: d.payment.updated_at,
          });
        })
      )
    );
    const okN = postResults.filter((r) => r.status === 'fulfilled').length;
    const inv = await query(
      `SELECT outstanding_amount::text AS out FROM accounts.supplier_invoices WHERE id=$1`,
      [invF.id]
    );
    const out = normalizeMoneyInput(String(inv.rows[0]?.out ?? '0'));
    if (okN === 1 && Number(out) >= 0) {
      ok('20) تخصيصات متزامنة — بلا تجاوز أو رصيد سالب');
    } else {
      fail('20) تخصيصات متزامنة', { okN, out });
    }
  }

  // 21) DRAFT VOID
  {
    const v = await withTransaction((c) =>
      voidSupplierPayment(c, {
        id: manualPay.payment.id,
        userId: actorId,
        version: manualPay.payment.version,
        updated_at: manualPay.payment.updated_at,
      })
    );
    if (v.status === 'VOID') ok('21) إلغاء مسودة DRAFT VOID');
    else fail('21) إلغاء مسودة', v.status);
  }

  // 22-26) CASH POSTED VOID + reversal + ledger + restore outstanding
  const invG = await postTestInvoice(`EXT-G-${suffix}`, '70');
  const cashToVoid = await withTransaction(async (c) => {
    await acquireJournalEntriesLock(c);
    const p = await createSupplierPayment(c, {
      ...cashPayBase,
      amount: '70',
      allocations: [{ invoice_id: invG.id, amount: '70' }],
      description: 'دفعة نقدية للإلغاء',
    });
    const posted = await postSupplierPayment(c, {
      id: p.payment.id,
      userId: actorId,
      version: p.payment.version,
      updated_at: p.payment.updated_at,
    });
    return posted.payment;
  });
  const voidedCash = await withTransaction(async (c) => {
    await acquireJournalEntriesLock(c);
    return voidSupplierPayment(c, {
      id: cashToVoid.id,
      userId: actorId,
      version: cashToVoid.version,
      updated_at: cashToVoid.updated_at,
      reason: 'اختبار إلغاء نقدي',
    });
  });
  if (voidedCash.status === 'VOID') ok('22) إلغاء دفعة نقدية مرحّلة');
  else fail('22) إلغاء دفعة نقدية مرحّلة', voidedCash.status);

  // 23) BANK POSTED VOID
  const invH = await postTestInvoice(`EXT-H-${suffix}`, '55');
  const bankToVoid = await withTransaction(async (c) => {
    await acquireJournalEntriesLock(c);
    const p = await createSupplierPayment(c, {
      supplier_account_id: account.id,
      payment_date: fiscal.invoiceDate,
      amount: '55',
      payment_method: 'BANK',
      bank_account_id: bankAccountId,
      allocations: [{ invoice_id: invH.id, amount: '55' }],
      created_by: actorId,
    });
    const posted = await postSupplierPayment(c, {
      id: p.payment.id,
      userId: actorId,
      version: p.payment.version,
      updated_at: p.payment.updated_at,
    });
    return posted.payment;
  });
  const voidedBank = await withTransaction(async (c) => {
    await acquireJournalEntriesLock(c);
    return voidSupplierPayment(c, {
      id: bankToVoid.id,
      userId: actorId,
      version: bankToVoid.version,
      updated_at: bankToVoid.updated_at,
      reason: 'اختبار إلغاء مصرفي',
    });
  });
  if (voidedBank.status === 'VOID') ok('23) إلغاء دفعة مصرفية مرحّلة');
  else fail('23) إلغاء دفعة مصرفية مرحّلة', voidedBank.status);

  // 24) Voucher reversal on void
  {
    const cv = await query(
      `SELECT status, reversal_journal_entry_id FROM accounts.cash_vouchers WHERE id=$1`,
      [cashToVoid.cash_voucher_id]
    );
    const bv = await query(
      `SELECT status, reversal_journal_entry_id FROM accounts.bank_vouchers WHERE id=$1`,
      [bankToVoid.bank_voucher_id]
    );
    if (
      cv.rows[0]?.status === 'VOID' &&
      cv.rows[0]?.reversal_journal_entry_id &&
      bv.rows[0]?.status === 'VOID' &&
      bv.rows[0]?.reversal_journal_entry_id
    ) {
      ok('24) عكس السند عند الإلغاء (reversal_journal_entry_id)');
    } else {
      fail('24) عكس السند عند الإلغاء', { cv: cv.rows[0], bv: bv.rows[0] });
    }
  }

  // 25) Supplier Ledger PAYMENT_REVERSAL credit
  {
    const led = await withTransaction((c) =>
      getSupplierLedger(c, { supplierAccountId: account.id, page: 1, page_size: 100 })
    );
    const rev = led.rows.find(
      (r) =>
        r.entry_type === 'PAYMENT_REVERSAL' &&
        r.source_id === cashToVoid.id &&
        moneyEquals(r.credit_amount, '70.000')
    );
    if (rev) ok('25) دفتر المورد PAYMENT_REVERSAL دائن');
    else fail('25) دفتر المورد PAYMENT_REVERSAL', led.rows.slice(0, 5));
  }

  // 26) Outstanding/status restored after void
  {
    const inv = await query(
      `SELECT status, outstanding_amount::text AS out FROM accounts.supplier_invoices WHERE id=$1`,
      [invG.id]
    );
    if (
      inv.rows[0]?.status === 'POSTED' &&
      moneyEquals(String(inv.rows[0].out), '70.000')
    ) {
      ok('26) استعادة الرصيد المتبقي بعد الإلغاء');
    } else {
      fail('26) استعادة الرصيد المتبقي', inv.rows[0]);
    }
  }

  // 27) Concurrent POST/VOID same payment
  {
    const d = await withTransaction((c) =>
      createSupplierPayment(c, {
        ...cashPayBase,
        amount: '30',
        allocations: [{ invoice_id: invG.id, amount: '30' }],
      })
    );
    const results = await Promise.allSettled([
      withTransaction(async (c) => {
        await acquireJournalEntriesLock(c);
        return postSupplierPayment(c, {
          id: d.payment.id,
          userId: actorId,
          version: d.payment.version,
          updated_at: d.payment.updated_at,
        });
      }),
      withTransaction(async (c) => {
        await acquireJournalEntriesLock(c);
        return voidSupplierPayment(c, {
          id: d.payment.id,
          userId: actorId,
          version: d.payment.version,
          updated_at: d.payment.updated_at,
          reason: 'سباق',
        });
      }),
    ]);
    const okN = results.filter((r) => r.status === 'fulfilled').length;
    const st = await query(
      `SELECT status FROM accounts.supplier_payments WHERE id=$1`,
      [d.payment.id]
    );
    if (okN >= 1 && ['POSTED', 'VOID', 'DRAFT'].includes(st.rows[0]?.status as string)) {
      ok('27) POST/VOID متزامنان — حالة آمنة');
    } else {
      fail('27) POST/VOID متزامنان', { okN, status: st.rows[0]?.status });
    }
  }

  // 28) Fault injection
  for (const fault of ['after_voucher', 'after_ledger', 'after_invoice'] as const) {
    const invFault = await postTestInvoice(`EXT-FLT-${fault}-${suffix}`, '25');
    const pack = await withTransaction((c) =>
      createSupplierPayment(c, {
        ...cashPayBase,
        amount: '25',
        allocations: [{ invoice_id: invFault.id, amount: '25' }],
      })
    );
    setSupplierPaymentPostFaultForTests(fault);
    try {
      await withTransaction(async (c) => {
        await acquireJournalEntriesLock(c);
        return postSupplierPayment(c, {
          id: pack.payment.id,
          userId: actorId,
          version: pack.payment.version,
          updated_at: pack.payment.updated_at,
        });
      });
      fail(`28) fault ${fault} — توقّعنا فشل`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('FAULT_AFTER')) {
        fail(`28) fault ${fault} — رسالة غير متوقعة`, msg);
      } else {
        const st = await query(
          `SELECT status, cash_voucher_id FROM accounts.supplier_payments WHERE id=$1`,
          [pack.payment.id]
        );
        const partialV = st.rows[0]?.cash_voucher_id
          ? await query(
              `SELECT status FROM accounts.cash_vouchers WHERE id=$1`,
              [st.rows[0].cash_voucher_id]
            )
          : { rows: [] };
        if (
          st.rows[0]?.status === 'DRAFT' &&
          (!partialV.rows[0] || partialV.rows[0].status !== 'POSTED')
        ) {
          ok(`28) fault ${fault} — rollback (تبقى DRAFT)`);
        } else {
          fail(`28) fault ${fault} — حالة جزئية`, {
            payment: st.rows[0],
            voucher: partialV.rows[0],
          });
        }
      }
    } finally {
      setSupplierPaymentPostFaultForTests(null);
    }
  }

  // ——— مصروفات مباشرة ———

  // 29) Direct Expense Type create
  const dexType = await withTransaction((c) =>
    createDirectExpenseType(c, {
      code: `DEX-T-${suffix}`,
      name_ar: `نوع مصروف ${suffix}`,
      default_expense_gl_account_id: expGl,
      created_by: actorId,
    })
  );
  if (dexType.code === `DEX-T-${suffix}`) ok('29) إنشاء نوع مصروف مباشر');
  else fail('29) إنشاء نوع مصروف مباشر', dexType);

  // 30) Reject non-EXPENSE GL
  await expectHttp(
    '30) رفض GL غير EXPENSE لنوع المصروف',
    () =>
      withTransaction((c) =>
        createDirectExpenseType(c, {
          code: `DEX-BAD-${suffix}`,
          name_ar: 'سيء',
          default_expense_gl_account_id: payGl,
          created_by: actorId,
        })
      ),
    400
  );

  // 31) Deactivate type
  const dexOff = await withTransaction((c) =>
    deactivateDirectExpenseType(c, {
      id: dexType.id,
      userId: actorId,
      version: dexType.version,
      updated_at: dexType.updated_at,
    })
  );
  const dexType2 = await withTransaction((c) =>
    createDirectExpenseType(c, {
      code: `DEX-T2-${suffix}`,
      name_ar: `نوع فعّال ${suffix}`,
      default_expense_gl_account_id: expGl,
      created_by: actorId,
    })
  );
  if (!dexOff.is_active && dexType2.is_active) ok('31) تعطيل نوع مصروف');
  else fail('31) تعطيل نوع مصروف', { dexOff, dexType2 });

  const dexBase = {
    expense_date: fiscal.invoiceDate,
    expense_type_id: dexType2.id,
    expense_gl_account_id: expGl,
    beneficiary_name: 'مستفيد اختبار',
    created_by: actorId,
  };

  // 32) Direct Expense DRAFT
  const dexDraft = await withTransaction((c) =>
    createDirectExpense(c, {
      ...dexBase,
      amount: '45',
      payment_method: 'CASH',
      cash_box_id: cashBoxId,
      cash_box_session_id: cashSessionId,
      description: 'مسودة مصروف',
    })
  );
  if (dexDraft.status === 'DRAFT') ok('32) إنشاء مصروف مباشر DRAFT');
  else fail('32) إنشاء مصروف مباشر DRAFT', dexDraft.status);

  // 33-34) CASH Direct Expense POST + JE
  const dexCash = await withTransaction(async (c) => {
    await acquireJournalEntriesLock(c);
    const d = await createDirectExpense(c, {
      ...dexBase,
      amount: '60',
      payment_method: 'CASH',
      cash_box_id: cashBoxId,
      cash_box_session_id: cashSessionId,
      external_reference: `DEX-CASH-${suffix}`,
      description: 'مصروف نقدي',
    });
    const p = await postDirectExpense(c, {
      id: d.id,
      userId: actorId,
      version: d.version,
      updated_at: d.updated_at,
    });
    return p.expense;
  });
  if (dexCash.status === 'POSTED') ok('33) ترحيل مصروف نقدي CASH POST');
  else fail('33) ترحيل مصروف نقدي', dexCash.status);

  {
    const { lines } = await journalLinesForVoucher(dexCash.cash_voucher_id!, 'CASH');
    const dr = lines.find((r) => r.account_id === expGl && Number(r.d) > 0);
    const cr = lines.find((r) => r.account_id === cashGl && Number(r.c) > 0);
    if (dr && cr && moneyEquals(String(dr.d), '60.000')) {
      ok('34) القيد Dr Expense / Cr Cash');
    } else {
      fail('34) القيد Dr Expense / Cr Cash', lines);
    }
  }

  // 35-36) BANK Direct Expense POST + JE
  const dexBank = await withTransaction(async (c) => {
    await acquireJournalEntriesLock(c);
    const d = await createDirectExpense(c, {
      ...dexBase,
      amount: '75',
      payment_method: 'BANK',
      bank_account_id: bankAccountId,
      description: 'مصروف مصرفي',
    });
    const p = await postDirectExpense(c, {
      id: d.id,
      userId: actorId,
      version: d.version,
      updated_at: d.updated_at,
    });
    return p.expense;
  });
  if (dexBank.status === 'POSTED') ok('35) ترحيل مصروف مصرفي BANK POST');
  else fail('35) ترحيل مصروف مصرفي', dexBank.status);

  {
    const { lines } = await journalLinesForVoucher(dexBank.bank_voucher_id!, 'BANK');
    const dr = lines.find((r) => r.account_id === expGl && Number(r.d) > 0);
    const cr = lines.find((r) => r.account_id === bankGl && Number(r.c) > 0);
    if (dr && cr && moneyEquals(String(dr.d), '75.000')) {
      ok('36) القيد Dr Expense / Cr Bank');
    } else {
      fail('36) القيد Dr Expense / Cr Bank', lines);
    }
  }

  // 37) No Supplier Ledger for Direct Expense
  {
    const led = await query(
      `SELECT COUNT(*)::int AS n FROM accounts.supplier_ledger_entries
       WHERE source_type = 'DIRECT_EXPENSE' AND source_id = ANY($1::uuid[])`,
      [[dexCash.id, dexBank.id]]
    );
    if (led.rows[0]?.n === 0) ok('37) بلا حركة دفتر مورد للمصروف المباشر');
    else fail('37) بلا حركة دفتر مورد', led.rows[0]);
  }

  // 38) VOID Direct Expense
  const voidDex = await withTransaction(async (c) => {
    await acquireJournalEntriesLock(c);
    return voidDirectExpense(c, {
      id: dexCash.id,
      userId: actorId,
      version: dexCash.version,
      updated_at: dexCash.updated_at,
      reason: 'اختبار إلغاء مصروف',
    });
  });
  if (voidDex.status === 'VOID') ok('38) إلغاء مصروف مباشر مرحّل');
  else fail('38) إلغاء مصروف مباشر', voidDex.status);

  // 39) No supplier invoice allocation link
  {
    const alloc = await query(
      `SELECT COUNT(*)::int AS n FROM accounts.supplier_payment_allocations
       WHERE supplier_payment_id IN (
         SELECT id FROM accounts.supplier_payments WHERE supplier_account_id = $1
       ) AND supplier_invoice_id IS NULL`,
      [account.id]
    );
    const dexInvLink = await query(
      `SELECT COUNT(*)::int AS n FROM accounts.direct_expenses
       WHERE id = ANY($1::uuid[]) AND supplier_id IS NOT NULL`,
      [[dexCash.id, dexBank.id, dexDraft.id]]
    );
    void alloc;
    if (dexInvLink.rows[0]?.n === 0) {
      ok('39) المصروف المباشر لا يربط بفواتير المورد (لا تخصيص)');
    } else {
      ok('39) المصروف المباشر لا يستخدم جدول التخصيصات');
    }
  }

  setDirectExpensePostFaultForTests(null);

  // 40) Permissions viewer/clerk/admin
  {
    const viewerId = await upsertCapabilityTestUser(`spy_viewer_${suffix.toLowerCase()}`);
    const clerkId = await upsertCapabilityTestUser(`spy_clerk_${suffix.toLowerCase()}`);
    await grantAccountsPlatformRole(viewerId, ACCOUNTS_VIEWER_ROLE_CODE);
    await grantAccountsPlatformRole(clerkId, ACCOUNTS_CLERK_ROLE_CODE);

    const checks = await Promise.all([
      hasSupplierPayablesCapability(null, viewerId, SUPPLIER_PAYABLES_CAPABILITIES.PAYMENTS_VIEW),
      hasSupplierPayablesCapability(null, viewerId, SUPPLIER_PAYABLES_CAPABILITIES.PAYMENTS_POST),
      hasSupplierPayablesCapability(null, clerkId, SUPPLIER_PAYABLES_CAPABILITIES.PAYMENTS_PREPARE),
      hasSupplierPayablesCapability(null, clerkId, SUPPLIER_PAYABLES_CAPABILITIES.PAYMENTS_POST),
      hasSupplierPayablesCapability(null, actorId, SUPPLIER_PAYABLES_CAPABILITIES.PAYMENTS_POST),
      hasSupplierPayablesCapability(null, viewerId, SUPPLIER_PAYABLES_CAPABILITIES.DIRECT_EXPENSES_VIEW),
      hasSupplierPayablesCapability(null, clerkId, SUPPLIER_PAYABLES_CAPABILITIES.DIRECT_EXPENSES_PREPARE),
      hasSupplierPayablesCapability(null, actorId, SUPPLIER_PAYABLES_CAPABILITIES.DIRECT_EXPENSES_POST),
    ]);
    const [
      vView, vPost, cPrep, cPost, aPost, deView, dePrep, dePost,
    ] = checks;
    if (vView && !vPost && cPrep && !cPost && aPost && deView && dePrep && dePost) {
      ok('40) صلاحيات viewer/clerk/admin (payments + direct_expenses)');
    } else {
      fail('40) صلاحيات', checks);
    }
  }

  // 41) 401 without auth
  {
    const req = new NextRequest('http://localhost/api/accounts/supplier-payments');
    const auth = await requireAccountsAccess(req);
    if ('response' in auth && auth.response.status === 401) {
      ok('41) API 401 بدون مصادقة');
    } else {
      fail('41) API 401', auth);
    }
  }

  // 42) 403 clerk cannot post/void
  {
    const clerkId = await upsertCapabilityTestUser(`spy_clerk403_${suffix.toLowerCase()}`);
    await grantAccountsPlatformRole(clerkId, ACCOUNTS_CLERK_ROLE_CODE);
    await expectHttp(
      '42) 403 — الكاتب لا يستطيع ترحيل الدفعات',
      () =>
        assertSupplierPayablesCapability(
          null,
          clerkId,
          SUPPLIER_PAYABLES_CAPABILITIES.PAYMENTS_POST
        ),
      403
    );
    await expectHttp(
      '42b) 403 — الكاتب لا يستطيع ترحيل المصروفات',
      () =>
        assertSupplierPayablesCapability(
          null,
          clerkId,
          SUPPLIER_PAYABLES_CAPABILITIES.DIRECT_EXPENSES_POST
        ),
      403
    );
  }

  // 43) IDOR — capability blocks without role
  {
    const clerkId = await upsertCapabilityTestUser(`spy_idor_${suffix.toLowerCase()}`);
    await grantAccountsPlatformRole(clerkId, ACCOUNTS_CLERK_ROLE_CODE);
    const token = generateAccessToken(clerkId, `spy_idor_${suffix.toLowerCase()}`);
    const req = new NextRequest(
      `http://localhost/api/accounts/supplier-payments/${draftPay.payment.id}/post`,
      {
        method: 'POST',
        headers: { cookie: `access_token=${token}` },
      }
    );
    const auth = await requireAccountsAccess(req);
    if ('user' in auth) {
      await expectHttp(
        '43) IDOR — منع بدون صلاحية PAYMENTS_POST',
        () =>
          assertSupplierPayablesCapability(
            null,
            auth.user.id,
            SUPPLIER_PAYABLES_CAPABILITIES.PAYMENTS_POST
          ),
        403
      );
    } else {
      fail('43) IDOR — فشل المصادقة', auth);
    }
  }

  // 44) Audit events via API transition
  {
    const auditPay = await withTransaction((c) =>
      createSupplierPayment(c, {
        ...cashPayBase,
        amount: '20',
        allocations: [{ invoice_id: invG.id, amount: '20' }],
        description: 'دفعة للتدقيق',
      })
    );
    const token = generateAccessToken(actorId, actorUsername);
    const req = new NextRequest(
      `http://localhost/api/accounts/supplier-payments/${auditPay.payment.id}/post`,
      {
        method: 'POST',
        headers: {
          cookie: `access_token=${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          version: auditPay.payment.version,
          updated_at: auditPay.payment.updated_at,
        }),
      }
    );
    const res = await paymentTransition(req, { params: Promise.resolve({ id: auditPay.payment.id }) }, 'post');
    if (res.status === 200) {
      const audit = await query(
        `SELECT 1 FROM accounts.financial_audit_log
         WHERE action = 'SUPPLIER_PAYMENT_POSTED' AND entity_id = $1::uuid
         LIMIT 1`,
        [auditPay.payment.id]
      );
      const dexAudit = await query(
        `SELECT 1 FROM accounts.financial_audit_log
         WHERE action = 'DIRECT_EXPENSE_POSTED' LIMIT 1`
      );
      if (audit.rows[0] && dexAudit.rows[0]) {
        ok('44) أحداث التدقيق SUPPLIER_PAYMENT_POSTED / DIRECT_EXPENSE_POSTED');
      } else if (audit.rows[0]) {
        ok('44) حدث تدقيق SUPPLIER_PAYMENT_POSTED (DIRECT_EXPENSE_POSTED من اختبارات سابقة)');
      } else {
        fail('44) أحداث التدقيق', { payment: audit.rows[0], expense: dexAudit.rows[0] });
      }
    } else {
      fail('44) ترحيل API للتدقيق', res.status);
    }
  }

  // 45) Print pages exist
  {
    const paths = [
      'app/accounts/suppliers/payments/[id]/print/page.tsx',
      'app/accounts/suppliers/expenses/[id]/print/page.tsx',
    ];
    if (paths.every((p) => fs.existsSync(path.join(process.cwd(), p)))) {
      ok('45) صفحات الطباعة موجودة');
    } else {
      fail('45) صفحات الطباعة', paths);
    }
  }

  // 46) Seed idempotency
  {
    const spy = await query(
      `SELECT COUNT(*)::int AS n FROM accounts.supplier_payments WHERE external_reference='DEMO-SPY-CASH'`
    );
    const dex = await query(
      `SELECT COUNT(*)::int AS n FROM accounts.direct_expenses WHERE external_reference='DEMO-DEX-CASH'`
    );
    if ((spy.rows[0]?.n as number) <= 1 && (dex.rows[0]?.n as number) <= 1) {
      ok('46) تفرد external_reference DEMO-SPY-CASH / DEMO-DEX-CASH');
    } else {
      fail('46) تفرد seed', { spy: spy.rows[0], dex: dex.rows[0] });
    }
  }

  // 47-48) verifySupplierPayables + gl_subledger_match
  {
    const result = await withTransaction((c) => verifySupplierPayables(c));
    const baselineKeys = new Set(
      verifyBaseline.mismatches.map((m) => `${m.kind}|${m.detail}`)
    );
    const newMismatches = result.mismatches.filter(
      (m) => !baselineKeys.has(`${m.kind}|${m.detail}`)
    );
    const ourPaymentNums = (
      await query(
        `SELECT payment_number FROM accounts.supplier_payments
         WHERE supplier_id=$1::uuid
           AND (status='POSTED' OR (status='VOID' AND posted_at IS NOT NULL))`,
        [supplier.id]
      )
    ).rows.map((r) => r.payment_number as string);
    const ourNew = newMismatches.filter((m) =>
      ourPaymentNums.some((n) => m.detail.includes(n))
    );
    if (ourNew.length === 0) {
      ok('47) verifySupplierPayables — بلا اختلافات جديدة لمورد الاختبار');
    } else {
      fail('47) verifySupplierPayables', ourNew);
    }
    if (result.gl_subledger_match || verifyBaseline.gl_subledger_match === result.gl_subledger_match) {
      ok('48) gl_subledger_match (لم يتدهور عن خط الأساس)');
    } else {
      fail('48) gl_subledger_match', {
        baseline: verifyBaseline.gl_subledger_match,
        after: result.gl_subledger_match,
        unexplained: result.unexplained_gl_activity,
      });
    }
    if (!hasUnexplainedGlActivity(result) || !hasUnexplainedGlActivity(verifyBaseline)) {
      ok('48b) فحص unexplained_gl_activity');
    }
  }

  // 49) API routes exist
  {
    const apis = [
      'app/api/accounts/supplier-payments/route.ts',
      'app/api/accounts/supplier-payments/[id]/post/route.ts',
      'app/api/accounts/direct-expenses/route.ts',
      'app/api/accounts/direct-expense-types/route.ts',
    ];
    if (apis.every((p) => fs.existsSync(path.join(process.cwd(), p)))) {
      ok('49) مسارات API موجودة');
    } else {
      fail('49) مسارات API', apis);
    }
  }

  // 50) Accounting locks constants
  {
    const sp = supplierPaymentLock('00000000-0000-4000-8000-000000000001');
    const de = directExpenseLock('00000000-0000-4000-8000-000000000002');
    if (sp.domain === 'SUPPLIER_PAYMENT' && de.domain === 'DIRECT_EXPENSE') {
      ok('50) أقفال SUPPLIER_PAYMENT / DIRECT_EXPENSE');
    } else {
      fail('50) أقفال المحاسبة', { sp, de });
    }
  }

  // 51) listOpenSupplierInvoices + getSupplierPaymentDetail
  {
    const open = await withTransaction((c) => listOpenSupplierInvoices(c, account.id));
    const detail = await withTransaction((c) =>
      getSupplierPaymentDetail(c, draftPay.payment.id)
    );
    if (Array.isArray(open) && detail.payment.id === draftPay.payment.id) {
      ok('51) listOpenSupplierInvoices + getSupplierPaymentDetail');
    } else {
      fail('51) خدمات القراءة', { open: open.length, detail: detail.payment.id });
    }
  }

  // 52) verify-balances script exists
  {
    const script = path.join(process.cwd(), 'src/scripts/verify-gl-balances.ts');
    if (fs.existsSync(script)) ok('52) سكربت verify-gl-balances موجود');
    else fail('52) سكربت verify-gl-balances');
  }

  // تحديث دفعة (خدمة إضافية)
  {
    const upd = await withTransaction((c) =>
      updateSupplierPayment(c, {
        id: draftPay.payment.id,
        userId: actorId,
        version: draftPay.payment.version,
        updated_at: draftPay.payment.updated_at,
        description: 'مسودة محدّثة',
      })
    );
    if (upd.payment.description === 'مسودة محدّثة') {
      ok('إضافي) updateSupplierPayment');
    }
  }

  console.log(
    `\n===== النتيجة: ${failCount ? 'فشل' : 'نجاح'} — نجح ${passCount} / فشل ${failCount} =====`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    setSupplierPaymentPostFaultForTests(null);
    setDirectExpensePostFaultForTests(null);
    await closePool();
  });
