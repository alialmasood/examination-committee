/**
 * حذف جميع المصارف وفروعها وحساباتها المصرفية والبيانات المرتبطة.
 *
 * npx tsx src/scripts/wipe-banks.ts --execute
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
  console.log('===== مسح المصارف والحسابات المصرفية =====');

  const counts = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM accounts.banks) AS banks,
      (SELECT COUNT(*)::int FROM accounts.bank_branches) AS branches,
      (SELECT COUNT(*)::int FROM accounts.bank_accounts) AS accounts
  `);
  const c = counts.rows[0];
  console.log(`مصارف: ${c.banks} | فروع: ${c.branches} | حسابات: ${c.accounts}`);

  if (Number(c.banks) === 0 && Number(c.branches) === 0 && Number(c.accounts) === 0) {
    console.log('فارغ مسبقاً');
    await closePool();
    return;
  }
  if (!EXECUTE) {
    console.log('معاينة فقط — أضف --execute للتنفيذ');
    await closePool();
    return;
  }

  console.log('\n--- تفريغ السجلات المرتبطة ---');
  const chain = [
    // إشارات اختيارية من وحدات أخرى
    [`student_collections null bank`, `UPDATE accounts.student_collections SET bank_account_id = NULL WHERE bank_account_id IS NOT NULL`],
    [`student_refunds null bank`, `UPDATE accounts.student_refunds SET bank_account_id = NULL WHERE bank_account_id IS NOT NULL`],
    [`supplier_payments null bank`, `UPDATE accounts.supplier_payments SET bank_account_id = NULL WHERE bank_account_id IS NOT NULL`],
    [`direct_expenses null bank`, `UPDATE accounts.direct_expenses SET bank_account_id = NULL WHERE bank_account_id IS NOT NULL`],

    // عمليات بنكية
    [`bank_reconciliation_matches`, `DELETE FROM accounts.bank_reconciliation_matches`],
    [`bank_statement_lines`, `DELETE FROM accounts.bank_statement_lines`],
    [`bank_statements`, `DELETE FROM accounts.bank_statements`],
    [`bank_transfers`, `DELETE FROM accounts.bank_transfers`],
    [`bank_vouchers`, `DELETE FROM accounts.bank_vouchers`],
    [`bank_account_users`, `DELETE FROM accounts.bank_account_users`],
    [`bank_accounts`, `DELETE FROM accounts.bank_accounts`],
    [`bank_branches`, `DELETE FROM accounts.bank_branches`],
    [`banks`, `DELETE FROM accounts.banks`],
  ] as const;

  for (const [label, sql] of chain) {
    await tryQuery(label, sql);
  }

  const after = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM accounts.banks) AS banks,
      (SELECT COUNT(*)::int FROM accounts.bank_branches) AS branches,
      (SELECT COUNT(*)::int FROM accounts.bank_accounts) AS accounts
  `);
  const a = after.rows[0];
  console.log(`\nالمتبقي — مصارف: ${a.banks} | فروع: ${a.branches} | حسابات: ${a.accounts}`);
  if (Number(a.banks) === 0) console.log('تم مسح جميع المصارف.');

  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
