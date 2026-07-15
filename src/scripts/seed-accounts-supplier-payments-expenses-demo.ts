/** بيانات عرض 6.B، آمنة ومتكررة عبر external_reference. */
import { query } from '../lib/db';
import { withTransaction, acquireJournalEntriesLock } from '../lib/accounts/with-transaction';
import {
  createSupplierPayment,
  postSupplierPayment,
  voidSupplierPayment,
} from '../lib/accounts/supplier-payments';
import { createDirectExpense, postDirectExpense, voidDirectExpense } from '../lib/accounts/direct-expenses';
import { createDirectExpenseType } from '../lib/accounts/direct-expense-types';

type SeedP = {
  userId: string;
  entryDate: string;
  ensureAccount: (x: {
    code: string;
    nameAr: string;
    typeCode: string;
    userId: string;
  }) => Promise<{ id: string }>;
};

async function exists(ref: string, table: 'supplier_payments' | 'direct_expenses') {
  const r = await query(`SELECT id FROM accounts.${table} WHERE external_reference=$1 LIMIT 1`, [ref]);
  return Boolean(r.rows[0]);
}

export async function seedSupplierPaymentsExpensesDemo(p: SeedP) {
  const [supplier, invoices, cash, bank, cc] = await Promise.all([
    query(
      `SELECT sa.id supplier_account_id
       FROM accounts.supplier_accounts sa
       JOIN accounts.suppliers s ON s.id = sa.supplier_id
       WHERE s.code = 'DEMO-SUP-01' LIMIT 1`
    ),
    query(
      `SELECT i.id, i.outstanding_amount::text AS outstanding_amount, i.external_reference
       FROM accounts.supplier_invoices i
       JOIN accounts.suppliers s ON s.id = i.supplier_id
       WHERE s.code = 'DEMO-SUP-01'
         AND i.status IN ('POSTED','PARTIALLY_PAID')
         AND i.outstanding_amount > 0
       ORDER BY i.due_date ASC NULLS LAST, i.invoice_date ASC, i.invoice_number ASC
       LIMIT 5`
    ),
    query(
      `SELECT s.id session_id, s.cash_box_id
       FROM accounts.cash_box_sessions s
       JOIN accounts.cash_boxes b ON b.id = s.cash_box_id
       WHERE b.code = 'DEMO-CB-MAIN' AND s.status = 'OPEN' LIMIT 1`
    ),
    query(
      `SELECT id FROM accounts.bank_accounts
       WHERE code = 'DEMO-BA-IQD' AND status = 'ACTIVE' AND allows_payments LIMIT 1`
    ),
    query(`SELECT id FROM accounts.cost_centers WHERE code = 'DEMO-CC-01' LIMIT 1`),
  ]);

  if (!supplier.rows[0] || !cash.rows[0] || !bank.rows[0]) {
    console.log('⚠ تخطّي 6.B DEMO: مورد/جلسة/مصرف غير متاح');
    return;
  }

  const accountId = supplier.rows[0].supplier_account_id as string;
  const cashBoxId = cash.rows[0].cash_box_id as string;
  const sessionId = cash.rows[0].session_id as string;
  const bankId = bank.rows[0].id as string;
  const open = invoices.rows as Array<{
    id: string;
    outstanding_amount: string;
    external_reference: string | null;
  }>;

  const expenseGl = await p.ensureAccount({
    code: 'DEMO-DEX-GL',
    nameAr: 'مصروف مباشر DEMO',
    typeCode: 'EXPENSE',
    userId: p.userId,
  });
  const type = await query(
    `SELECT id FROM accounts.direct_expense_types WHERE code='DEMO-DEX-TYPE' LIMIT 1`
  );
  const typeId =
    (type.rows[0]?.id as string | undefined) ??
    (
      await withTransaction((c) =>
        createDirectExpenseType(c, {
          code: 'DEMO-DEX-TYPE',
          name_ar: 'مصروف تشغيلي DEMO',
          default_expense_gl_account_id: expenseGl.id,
          default_cost_center_id: cc.rows[0]?.id as string | undefined,
          created_by: p.userId,
        })
      )
    ).id;

  // CASH POSTED — تخصيص جزئي على أول فاتورة مفتوحة
  if (!(await exists('DEMO-SPY-CASH', 'supplier_payments')) && open[0]) {
    const amount = Math.min(1000, Number(open[0].outstanding_amount)).toFixed(3);
    if (Number(amount) > 0) {
      await withTransaction(async (c) => {
        await acquireJournalEntriesLock(c);
        const x = await createSupplierPayment(c, {
          supplier_account_id: accountId,
          payment_date: p.entryDate,
          amount,
          payment_method: 'CASH',
          cash_box_id: cashBoxId,
          cash_box_session_id: sessionId,
          external_reference: 'DEMO-SPY-CASH',
          description: 'دفعة نقدية DEMO 6.B',
          allocations: [{ invoice_id: open[0].id, amount }],
          created_by: p.userId,
        });
        await postSupplierPayment(c, {
          id: x.payment.id,
          userId: p.userId,
          version: x.payment.version,
          updated_at: x.payment.updated_at,
        });
      });
    }
  }

  // أعد قراءة الفواتير المفتوحة بعد الدفعة النقدية
  const open2 = (
    await query(
      `SELECT i.id, i.outstanding_amount::text AS outstanding_amount
       FROM accounts.supplier_invoices i
       JOIN accounts.suppliers s ON s.id = i.supplier_id
       WHERE s.code = 'DEMO-SUP-01'
         AND i.status IN ('POSTED','PARTIALLY_PAID')
         AND i.outstanding_amount > 0
       ORDER BY i.due_date ASC NULLS LAST, i.invoice_date ASC, i.invoice_number ASC
       LIMIT 5`
    )
  ).rows as Array<{ id: string; outstanding_amount: string }>;

  // BANK POSTED — قد يغطي فاتورتين إن وُجدتا
  if (!(await exists('DEMO-SPY-BANK', 'supplier_payments')) && open2[0]) {
    const allocs: Array<{ invoice_id: string; amount: string }> = [];
    let left = 1500;
    for (const inv of open2) {
      if (left <= 0) break;
      const take = Math.min(left, Number(inv.outstanding_amount));
      if (take > 0) {
        allocs.push({ invoice_id: inv.id, amount: take.toFixed(3) });
        left -= take;
      }
    }
    const amount = allocs.reduce((s, a) => s + Number(a.amount), 0).toFixed(3);
    if (Number(amount) > 0) {
      await withTransaction(async (c) => {
        await acquireJournalEntriesLock(c);
        const x = await createSupplierPayment(c, {
          supplier_account_id: accountId,
          payment_date: p.entryDate,
          amount,
          payment_method: 'BANK',
          bank_account_id: bankId,
          external_reference: 'DEMO-SPY-BANK',
          description: 'دفعة مصرفية DEMO 6.B (قد تغطي عدة فواتير)',
          allocations: allocs,
          created_by: p.userId,
        });
        await postSupplierPayment(c, {
          id: x.payment.id,
          userId: p.userId,
          version: x.payment.version,
          updated_at: x.payment.updated_at,
        });
      });
    }
  }

  // DRAFT payment
  if (!(await exists('DEMO-SPY-DRAFT', 'supplier_payments')) && open2[0]) {
    const amt = Math.min(100, Number(open2[0].outstanding_amount)).toFixed(3);
    if (Number(amt) > 0) {
      await withTransaction(async (c) => {
        await createSupplierPayment(c, {
          supplier_account_id: accountId,
          payment_date: p.entryDate,
          amount: amt,
          payment_method: 'CASH',
          cash_box_id: cashBoxId,
          cash_box_session_id: sessionId,
          external_reference: 'DEMO-SPY-DRAFT',
          description: 'مسودة دفعة DEMO 6.B',
          allocations: [{ invoice_id: open2[0].id, amount: amt }],
          created_by: p.userId,
        });
      });
    }
  }

  // VOID payment (post then void) — فاتورة صغيرة إن وُجدت رصيد
  if (!(await exists('DEMO-SPY-VOID', 'supplier_payments'))) {
    const open3 = (
      await query(
        `SELECT i.id, i.outstanding_amount::text AS outstanding_amount
         FROM accounts.supplier_invoices i
         JOIN accounts.suppliers s ON s.id = i.supplier_id
         WHERE s.code = 'DEMO-SUP-01'
           AND i.status IN ('POSTED','PARTIALLY_PAID')
           AND i.outstanding_amount >= 50
         ORDER BY i.invoice_number ASC LIMIT 1`
      )
    ).rows as Array<{ id: string; outstanding_amount: string }>;
    if (open3[0]) {
      await withTransaction(async (c) => {
        await acquireJournalEntriesLock(c);
        const x = await createSupplierPayment(c, {
          supplier_account_id: accountId,
          payment_date: p.entryDate,
          amount: '50.000',
          payment_method: 'CASH',
          cash_box_id: cashBoxId,
          cash_box_session_id: sessionId,
          external_reference: 'DEMO-SPY-VOID',
          description: 'دفعة ملغاة DEMO 6.B',
          allocations: [{ invoice_id: open3[0].id, amount: '50.000' }],
          created_by: p.userId,
        });
        const posted = await postSupplierPayment(c, {
          id: x.payment.id,
          userId: p.userId,
          version: x.payment.version,
          updated_at: x.payment.updated_at,
        });
        await voidSupplierPayment(c, {
          id: posted.payment.id,
          userId: p.userId,
          version: posted.payment.version,
          updated_at: posted.payment.updated_at,
          reason: 'إلغاء عرض DEMO',
        });
      });
    }
  }

  // Direct expenses
  if (!(await exists('DEMO-DEX-CASH', 'direct_expenses'))) {
    await withTransaction(async (c) => {
      await acquireJournalEntriesLock(c);
      const x = await createDirectExpense(c, {
        expense_date: p.entryDate,
        expense_type_id: typeId,
        expense_gl_account_id: expenseGl.id,
        cost_center_id: cc.rows[0]?.id,
        amount: '100',
        payment_method: 'CASH',
        cash_box_id: cashBoxId,
        cash_box_session_id: sessionId,
        beneficiary_name: 'مستفيد DEMO',
        external_reference: 'DEMO-DEX-CASH',
        description: 'مصروف نقدي DEMO 6.B',
        created_by: p.userId,
      });
      await postDirectExpense(c, {
        id: x.id,
        userId: p.userId,
        version: x.version,
        updated_at: x.updated_at,
      });
    });
  }

  if (!(await exists('DEMO-DEX-BANK', 'direct_expenses'))) {
    await withTransaction(async (c) => {
      await acquireJournalEntriesLock(c);
      const x = await createDirectExpense(c, {
        expense_date: p.entryDate,
        expense_type_id: typeId,
        expense_gl_account_id: expenseGl.id,
        cost_center_id: cc.rows[0]?.id,
        amount: '75',
        payment_method: 'BANK',
        bank_account_id: bankId,
        beneficiary_name: 'مستفيد مصرفي DEMO',
        external_reference: 'DEMO-DEX-BANK',
        description: 'مصروف مصرفي DEMO 6.B',
        created_by: p.userId,
      });
      await postDirectExpense(c, {
        id: x.id,
        userId: p.userId,
        version: x.version,
        updated_at: x.updated_at,
      });
    });
  }

  if (!(await exists('DEMO-DEX-DRAFT', 'direct_expenses'))) {
    await withTransaction(async (c) => {
      await createDirectExpense(c, {
        expense_date: p.entryDate,
        expense_type_id: typeId,
        expense_gl_account_id: expenseGl.id,
        cost_center_id: cc.rows[0]?.id,
        amount: '25',
        payment_method: 'CASH',
        cash_box_id: cashBoxId,
        cash_box_session_id: sessionId,
        beneficiary_name: 'مسودة مستفيد',
        external_reference: 'DEMO-DEX-DRAFT',
        description: 'مسودة مصروف DEMO 6.B',
        created_by: p.userId,
      });
    });
  }

  if (!(await exists('DEMO-DEX-VOID', 'direct_expenses'))) {
    await withTransaction(async (c) => {
      await acquireJournalEntriesLock(c);
      const x = await createDirectExpense(c, {
        expense_date: p.entryDate,
        expense_type_id: typeId,
        expense_gl_account_id: expenseGl.id,
        cost_center_id: cc.rows[0]?.id,
        amount: '30',
        payment_method: 'CASH',
        cash_box_id: cashBoxId,
        cash_box_session_id: sessionId,
        beneficiary_name: 'ملغى DEMO',
        external_reference: 'DEMO-DEX-VOID',
        description: 'مصروف ملغى DEMO 6.B',
        created_by: p.userId,
      });
      const posted = await postDirectExpense(c, {
        id: x.id,
        userId: p.userId,
        version: x.version,
        updated_at: x.updated_at,
      });
      await voidDirectExpense(c, {
        id: posted.expense.id,
        userId: p.userId,
        version: posted.expense.version,
        updated_at: posted.expense.updated_at,
        reason: 'إلغاء عرض DEMO',
      });
    });
  }

  const links = await query(
    `SELECT payment_number AS num, 'payment' AS kind, status, external_reference
     FROM accounts.supplier_payments
     WHERE external_reference LIKE 'DEMO-SPY-%'
     UNION ALL
     SELECT expense_number, 'expense', status, external_reference
     FROM accounts.direct_expenses
     WHERE external_reference LIKE 'DEMO-DEX-%'
     ORDER BY external_reference`
  );
  console.log('✓ بيانات دفعات ومصروفات DEMO 6.B جاهزة');
  for (const row of links.rows) {
    const path =
      row.kind === 'payment'
        ? `/accounts/suppliers/payments`
        : `/accounts/suppliers/expenses`;
    console.log(`  - ${row.external_reference}: ${row.num} (${row.status}) → ${path}`);
  }
}
