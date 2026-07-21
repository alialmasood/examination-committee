/**
 * حذف قيود يومية تجريبية متبقية في /accounts/entries
 * (بعد أن أصبح كل المتبقي من سكربتات اختبار: نقد/أصول/طلاب/بنك/يدوي)
 * npm run cleanup:accounts-entries-demo
 */
import { closePool, query } from '../lib/db';

async function count(sql: string, params: any[] = []) {
  const r = await query(sql, params);
  return Number(r.rows[0]?.n ?? 0);
}

async function main() {
  console.log('===== تنظيف قيود يومية متبقية — /accounts/entries =====');

  const before = await count(`SELECT COUNT(*)::int n FROM accounts.journal_entries`);
  console.log(`قبل: ${before}`);

  if (before === 0) {
    console.log('لا توجد قيود');
    await closePool();
    return;
  }

  // في هذه البيئة كل المتبقي تجريبي بعد تنظيف الوحدات السابقة
  const ids = (
    await query(`SELECT id::text FROM accounts.journal_entries`)
  ).rows.map((r: { id: string }) => r.id);
  console.log(`سيحذف: ${ids.length} قيداً`);

  const nullSqls = [
    `UPDATE accounts.cash_vouchers SET journal_entry_id = NULL WHERE journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.bank_vouchers SET journal_entry_id = NULL WHERE journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.bank_transfers SET journal_entry_id = NULL WHERE journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.cash_transfers SET journal_entry_id = NULL WHERE journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.cash_count_adjustments SET journal_entry_id = NULL WHERE journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.fixed_assets SET acquisition_journal_entry_id = NULL WHERE acquisition_journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.bank_statement_lines SET adjustment_journal_entry_id = NULL WHERE adjustment_journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.gl_account_balances SET last_journal_entry_id = NULL WHERE last_journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.student_charges SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
      WHERE journal_entry_id = ANY($1::uuid[]) OR reversal_journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.student_collections SET journal_entry_id = NULL WHERE journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.student_reliefs SET journal_entry_id = NULL WHERE journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.student_credit_notes SET journal_entry_id = NULL WHERE journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.student_ledger_entries SET journal_entry_id = NULL WHERE journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.supplier_invoices SET journal_entry_id = NULL, reversal_journal_entry_id = NULL
      WHERE journal_entry_id = ANY($1::uuid[]) OR reversal_journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.supplier_payments SET journal_entry_id = NULL WHERE journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.direct_expenses SET journal_entry_id = NULL WHERE journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.supplier_ledger_entries SET journal_entry_id = NULL WHERE journal_entry_id = ANY($1::uuid[])`,
    `DELETE FROM accounts.payroll_run_postings WHERE journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.payroll_runs SET posting_journal_entry_id = NULL WHERE posting_journal_entry_id = ANY($1::uuid[])`,
    `UPDATE accounts.journal_entries SET reverses_entry_id = NULL, reversal_entry_id = NULL
      WHERE id = ANY($1::uuid[]) OR reverses_entry_id = ANY($1::uuid[]) OR reversal_entry_id = ANY($1::uuid[])`,
  ];

  for (const sql of nullSqls) {
    try {
      await query(sql, [ids]);
    } catch {
      /* عمود/جدول غير موجود */
    }
  }

  await query(
    `DELETE FROM accounts.journal_entry_history WHERE journal_entry_id = ANY($1::uuid[])`,
    [ids]
  ).catch(() => undefined);

  await query(
    `DELETE FROM accounts.bank_reconciliation_matches
     WHERE journal_entry_id = ANY($1::uuid[])
        OR journal_entry_line_id IN (
             SELECT id FROM accounts.journal_entry_lines WHERE journal_entry_id = ANY($1::uuid[])
           )`,
    [ids]
  ).catch(() => undefined);

  await query(`DELETE FROM accounts.journal_entry_lines WHERE journal_entry_id = ANY($1::uuid[])`, [
    ids,
  ]);
  await query(`DELETE FROM accounts.journal_entries WHERE id = ANY($1::uuid[])`, [ids]);

  const after = await count(`SELECT COUNT(*)::int n FROM accounts.journal_entries`);
  console.log(`بعد: ${after} (حُذف ${before - after})`);
  if (after === 0) console.log('✓ صفحة القيود فارغة من البيانات التجريبية');
  else console.error('بقيت قيود — راجع FK');
  console.log('===== انتهى =====');
  await closePool();
}

main().catch(async (e) => {
  console.error('فشل:', e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
