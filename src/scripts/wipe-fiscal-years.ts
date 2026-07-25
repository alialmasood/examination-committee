/**
 * حذف جميع السنوات المالية والفترات والتسلسلات المرتبطة.
 * يفك الارتباطات الشائعة أولاً حتى لا تفشل قيود FK.
 *
 * npx tsx src/scripts/wipe-fiscal-years.ts --execute
 */
import { closePool, query } from '../lib/db';

const EXECUTE = process.argv.includes('--execute');

async function tryQuery(label: string, sql: string, params: unknown[] = []) {
  try {
    const r = await query(sql, params);
    console.log(`  ✓ ${label}${r.rowCount != null ? ` (${r.rowCount})` : ''}`);
    return r;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`  ✗ ${label}: ${msg.split('\n')[0]}`);
    return null;
  }
}

async function main() {
  console.log('===== مسح السنوات المالية =====');

  const years = await query(
    `SELECT id::text, code, status, start_date::text, end_date::text
     FROM accounts.fiscal_years
     ORDER BY start_date`
  );
  console.log(`عدد السنوات الحالي: ${years.rows.length}`);
  for (const y of years.rows) {
    console.log(`  - ${y.code} [${y.status}] ${y.start_date} → ${y.end_date}`);
  }

  if (years.rows.length === 0) {
    console.log('فارغ مسبقاً');
    await closePool();
    return;
  }

  if (!EXECUTE) {
    console.log('\nمعاينة فقط — أضف --execute للتنفيذ');
    await closePool();
    return;
  }

  console.log('\n--- فك الارتباطات وحذف التوابع ---');

  const chain: Array<[string, string]> = [
    // قيود يومية وروابطها
    [
      'journal reverse links',
      `UPDATE accounts.journal_entries
       SET reverses_entry_id = NULL, reversal_entry_id = NULL`,
    ],
    [
      'settlement journal null',
      `UPDATE accounts.student_settlement_receipts
       SET journal_entry_id = NULL
       WHERE journal_entry_id IS NOT NULL`,
    ],
    [
      'cash vouchers journal null',
      `UPDATE accounts.cash_vouchers SET journal_entry_id = NULL WHERE journal_entry_id IS NOT NULL`,
    ],
    [
      'bank vouchers journal null',
      `UPDATE accounts.bank_vouchers SET journal_entry_id = NULL WHERE journal_entry_id IS NOT NULL`,
    ],
    [
      'bank transfers journal null',
      `UPDATE accounts.bank_transfers SET journal_entry_id = NULL WHERE journal_entry_id IS NOT NULL`,
    ],
    [
      'cash transfers journal null',
      `UPDATE accounts.cash_transfers SET journal_entry_id = NULL WHERE journal_entry_id IS NOT NULL`,
    ],
    [
      'cash count adj journal null',
      `UPDATE accounts.cash_count_adjustments SET journal_entry_id = NULL WHERE journal_entry_id IS NOT NULL`,
    ],
    [
      'student charges journal null',
      `UPDATE accounts.student_charges
       SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
       WHERE journal_entry_id IS NOT NULL OR reversal_journal_entry_id IS NOT NULL`,
    ],
    [
      'student collections journal null',
      `UPDATE accounts.student_collections SET journal_entry_id = NULL WHERE journal_entry_id IS NOT NULL`,
    ],
    [
      'student reliefs journal null',
      `UPDATE accounts.student_reliefs SET journal_entry_id = NULL WHERE journal_entry_id IS NOT NULL`,
    ],
    [
      'student credit notes journal null',
      `UPDATE accounts.student_credit_notes SET journal_entry_id = NULL WHERE journal_entry_id IS NOT NULL`,
    ],
    [
      'student ledger journal null',
      `UPDATE accounts.student_ledger_entries SET journal_entry_id = NULL WHERE journal_entry_id IS NOT NULL`,
    ],
    [
      'supplier invoices journal null',
      `UPDATE accounts.supplier_invoices
       SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
       WHERE journal_entry_id IS NOT NULL OR reversal_journal_entry_id IS NOT NULL`,
    ],
    [
      'supplier payments journal null',
      `UPDATE accounts.supplier_payments SET journal_entry_id = NULL WHERE journal_entry_id IS NOT NULL`,
    ],
    [
      'direct expenses journal null',
      `UPDATE accounts.direct_expenses SET journal_entry_id = NULL WHERE journal_entry_id IS NOT NULL`,
    ],
    [
      'supplier ledger journal null',
      `UPDATE accounts.supplier_ledger_entries SET journal_entry_id = NULL WHERE journal_entry_id IS NOT NULL`,
    ],
    [
      'fixed assets acq journal null',
      `UPDATE accounts.fixed_assets SET acquisition_journal_entry_id = NULL WHERE acquisition_journal_entry_id IS NOT NULL`,
    ],
    [
      'asset movements journal null',
      `UPDATE accounts.fixed_asset_movements
       SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
       WHERE journal_entry_id IS NOT NULL OR reversal_journal_entry_id IS NOT NULL`,
    ],
    [
      'asset disposals journal null',
      `UPDATE accounts.fixed_asset_disposals
       SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
       WHERE journal_entry_id IS NOT NULL OR reversal_journal_entry_id IS NOT NULL`,
    ],
    [
      'bank stmt adj journal null',
      `UPDATE accounts.bank_statement_lines SET adjustment_journal_entry_id = NULL WHERE adjustment_journal_entry_id IS NOT NULL`,
    ],
    [
      'gl balances last journal null',
      `UPDATE accounts.gl_account_balances SET last_journal_entry_id = NULL WHERE last_journal_entry_id IS NOT NULL`,
    ],
    [
      'payroll run postings',
      `DELETE FROM accounts.payroll_run_postings`,
    ],
    [
      'payroll runs posting journal null',
      `UPDATE accounts.payroll_runs SET posting_journal_entry_id = NULL WHERE posting_journal_entry_id IS NOT NULL`,
    ],
    [`journal entry lines`, `DELETE FROM accounts.journal_entry_lines`],
    [`journal entries`, `DELETE FROM accounts.journal_entries`],

    // أرصدة GL
    [`gl account balances`, `DELETE FROM accounts.gl_account_balances`],

    // رواتب مرتبطة بالسنة/الفترة
    [`payroll runs`, `DELETE FROM accounts.payroll_runs`],
    [
      'payroll periods period null',
      `UPDATE accounts.payroll_periods SET fiscal_period_id = NULL WHERE fiscal_period_id IS NOT NULL`,
    ],
    [`payroll periods`, `DELETE FROM accounts.payroll_periods`],

    // صندوق / بنك مرتبط بالسنة
    [
      'sessions clear current_count',
      `UPDATE accounts.cash_box_sessions SET current_count_id = NULL WHERE current_count_id IS NOT NULL`,
    ],
    [`cash count adjustments`, `DELETE FROM accounts.cash_count_adjustments`],
    [`cash counts`, `DELETE FROM accounts.cash_counts`],
    [`cash transfers`, `DELETE FROM accounts.cash_transfers`],
    [`cash vouchers`, `DELETE FROM accounts.cash_vouchers`],
    [`cash box sessions`, `DELETE FROM accounts.cash_box_sessions`],
    [`bank transfers`, `DELETE FROM accounts.bank_transfers`],
    [`bank vouchers`, `DELETE FROM accounts.bank_vouchers`],

    // طلاب / موردين / مشتريات / أصول تشير للسنة
    [`student refunds`, `DELETE FROM accounts.student_refunds`],
    [`student credit notes`, `DELETE FROM accounts.student_credit_notes`],
    [`student reliefs`, `DELETE FROM accounts.student_reliefs`],
    [`student collection allocations`, `DELETE FROM accounts.student_collection_allocations`],
    [`student collections`, `DELETE FROM accounts.student_collections`],
    [`student installments`, `DELETE FROM accounts.student_installments`],
    [`student billing plans`, `DELETE FROM accounts.student_billing_plans`],
    [`student charges`, `DELETE FROM accounts.student_charges`],
    [`supplier payment allocations`, `DELETE FROM accounts.supplier_payment_allocations`],
    [`supplier payments`, `DELETE FROM accounts.supplier_payments`],
    [`direct expenses`, `DELETE FROM accounts.direct_expenses`],
    [`supplier invoices`, `DELETE FROM accounts.supplier_invoices`],
    [`goods receipts`, `DELETE FROM accounts.goods_receipts`],
    [`purchase orders`, `DELETE FROM accounts.purchase_orders`],
    [`purchase requisitions`, `DELETE FROM accounts.purchase_requisitions`],
    [`fixed asset disposals`, `DELETE FROM accounts.fixed_asset_disposals`],
    [`fixed asset depreciation`, `DELETE FROM accounts.fixed_asset_depreciation_entries`],
    [`fixed asset movements`, `DELETE FROM accounts.fixed_asset_movements`],
    [
      'fixed assets period null',
      `UPDATE accounts.fixed_assets
       SET acquisition_fiscal_period_id = NULL
       WHERE acquisition_fiscal_period_id IS NOT NULL`,
    ],
    [
      'fixed assets year null / delete demo',
      `UPDATE accounts.fixed_assets
       SET fiscal_year_id = NULL
       WHERE fiscal_year_id IS NOT NULL`,
    ],

    // السنة والفترات والتسلسلات
    [`document sequences`, `DELETE FROM accounts.document_sequences`],
    [`fiscal periods`, `DELETE FROM accounts.fiscal_periods`],
    [`fiscal years`, `DELETE FROM accounts.fiscal_years`],
  ];

  for (const [label, sql] of chain) {
    await tryQuery(label, sql);
  }

  const after = await query(`SELECT COUNT(*)::int n FROM accounts.fiscal_years`);
  const periods = await query(`SELECT COUNT(*)::int n FROM accounts.fiscal_periods`);
  console.log(`\nالمتبقي — سنوات: ${after.rows[0].n} | فترات: ${periods.rows[0].n}`);
  if (Number(after.rows[0].n) === 0) {
    console.log('تم مسح جميع السنوات المالية.');
  } else {
    console.log('تحذير: بقيت سنوات — راجع الأخطاء أعلاه.');
  }

  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
