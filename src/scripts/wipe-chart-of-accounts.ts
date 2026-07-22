/**
 * حذف جميع حسابات دليل الحسابات (chart_of_accounts)
 *
 * npx tsx src/scripts/wipe-chart-of-accounts.ts --execute
 */
import { closePool, query } from '../lib/db';

const EXECUTE = process.argv.includes('--execute');

async function tryQuery(label: string, sql: string) {
  try {
    const r = await query(sql);
    console.log(`  ✓ ${label}${r.rowCount != null ? ` (${r.rowCount})` : ''}`);
    return r;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`  ✗ ${label}: ${msg.split('\n')[0]}`);
    return null;
  }
}

async function main() {
  console.log('===== مسح دليل الحسابات =====');
  const before = await query(`SELECT COUNT(*)::int n FROM accounts.chart_of_accounts`);
  console.log(`العدد الحالي: ${before.rows[0].n}`);
  if (Number(before.rows[0].n) === 0) {
    console.log('فارغ مسبقاً');
    await closePool();
    return;
  }
  if (!EXECUTE) {
    console.log('معاينة فقط — أضف --execute');
    await closePool();
    return;
  }

  console.log('\n--- تنظيف السلاسل المرتبطة ---');
  const chain = [
    // بنك
    `DELETE FROM accounts.bank_reconciliation_matches`,
    `DELETE FROM accounts.bank_statement_lines`,
    `DELETE FROM accounts.bank_statements`,
    `DELETE FROM accounts.bank_transfers`,
    `DELETE FROM accounts.bank_vouchers`,
    `DELETE FROM accounts.bank_accounts`,
    // نقد
    `DELETE FROM accounts.cash_count_adjustments`,
    `DELETE FROM accounts.cash_transfers`,
    `DELETE FROM accounts.cash_vouchers`,
    `UPDATE accounts.cash_boxes SET account_id = NULL, closed_account_id = NULL`,
    // أصول
    `DELETE FROM accounts.asset_disposals`,
    `DELETE FROM accounts.depreciation_run_lines`,
    `DELETE FROM accounts.depreciation_runs`,
    `DELETE FROM accounts.asset_movements`,
    `DELETE FROM accounts.fixed_assets`,
    `DELETE FROM accounts.asset_categories`,
    // طلاب (الأعمق أولاً)
    `DELETE FROM accounts.student_installments`,
    `DELETE FROM accounts.student_ledger_entries`,
    `DELETE FROM accounts.student_collections`,
    `DELETE FROM accounts.student_charges`,
    `DELETE FROM accounts.student_reliefs`,
    `DELETE FROM accounts.student_credit_notes`,
    `DELETE FROM accounts.student_billing_plans`,
    `DELETE FROM accounts.student_accounts`,
    `DELETE FROM accounts.student_fee_types`,
    `DELETE FROM accounts.student_relief_types`,
    // موردون / مشتريات
    `DELETE FROM accounts.supplier_ledger_entries`,
    `DELETE FROM accounts.supplier_payments`,
    `DELETE FROM accounts.supplier_invoice_lines`,
    `DELETE FROM accounts.supplier_invoices`,
    `DELETE FROM accounts.supplier_accounts`,
    `DELETE FROM accounts.supplier_invoice_types`,
    `DELETE FROM accounts.direct_expenses`,
    `DELETE FROM accounts.direct_expense_types`,
    `DELETE FROM accounts.purchase_order_lines`,
    `DELETE FROM accounts.purchase_orders`,
    `DELETE FROM accounts.purchase_requisition_lines`,
    `DELETE FROM accounts.purchase_requisitions`,
    // رواتب
    `DELETE FROM accounts.payroll_account_mappings`,
    `UPDATE accounts.payroll_components SET expense_account_id = NULL, liability_account_id = NULL`,
    `UPDATE accounts.payroll_contracts SET default_expense_account_id = NULL, payable_account_id = NULL`,
    // قيود
    `DELETE FROM accounts.gl_account_balances`,
    `DELETE FROM accounts.journal_entry_lines`,
  ];

  for (const sql of chain) {
    await tryQuery(sql.slice(0, 60), sql);
  }

  console.log('\n--- حذف دليل الحسابات ---');
  // الفهرس الفريد (ليس CONSTRAINT)
  await tryQuery(
    'drop unique index',
    `DROP INDEX IF EXISTS accounts.uq_chart_of_accounts_sibling_sort`
  );
  await tryQuery('clear parents', `UPDATE accounts.chart_of_accounts SET parent_id = NULL`);
  await tryQuery('DELETE ALL', `DELETE FROM accounts.chart_of_accounts`);
  await tryQuery(
    'restore unique index',
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_chart_of_accounts_sibling_sort
       ON accounts.chart_of_accounts (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), sort_order)`
  );

  const left = await query(`SELECT COUNT(*)::int n FROM accounts.chart_of_accounts`);
  console.log(`\nالمتبقي: ${left.rows[0].n}`);
  if (Number(left.rows[0].n) === 0) console.log('تم مسح دليل الحسابات بالكامل.');

  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
