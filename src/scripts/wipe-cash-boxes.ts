/**
 * حذف جميع الصناديق النقدية (cash_boxes) والبيانات المرتبطة بها.
 * يُبقي أنواع الصناديق (cash_box_types) لأنها ثابتة.
 *
 * npx tsx src/scripts/wipe-cash-boxes.ts --execute
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
  console.log('===== مسح الصناديق النقدية =====');
  const before = await query(`SELECT COUNT(*)::int n FROM accounts.cash_boxes`);
  console.log(`عدد الصناديق الحالي: ${before.rows[0].n}`);
  if (Number(before.rows[0].n) === 0) {
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
    [`student_collections null cash`, `UPDATE accounts.student_collections SET cash_box_id = NULL, cash_box_session_id = NULL WHERE cash_box_id IS NOT NULL`],
    [`student_refunds null cash`, `UPDATE accounts.student_refunds SET cash_box_id = NULL, cash_box_session_id = NULL WHERE cash_box_id IS NOT NULL`],
    [`supplier_payments null cash`, `UPDATE accounts.supplier_payments SET cash_box_id = NULL, cash_box_session_id = NULL WHERE cash_box_id IS NOT NULL`],
    [`direct_expenses null cash`, `UPDATE accounts.direct_expenses SET cash_box_id = NULL, cash_box_session_id = NULL WHERE cash_box_id IS NOT NULL`],

    // عمليات الصندوق (فك الارتباط الدائري بين sessions و counts)
    [`cash_count_adjustments`, `DELETE FROM accounts.cash_count_adjustments`],
    [
      'sessions clear current_count',
      `UPDATE accounts.cash_box_sessions SET current_count_id = NULL WHERE current_count_id IS NOT NULL`,
    ],
    [`cash_counts`, `DELETE FROM accounts.cash_counts`],
    [`cash_transfers`, `DELETE FROM accounts.cash_transfers`],
    [`cash_vouchers`, `DELETE FROM accounts.cash_vouchers`],
    [`cash_box_sessions`, `DELETE FROM accounts.cash_box_sessions`],
    [`cash_box_custodians`, `DELETE FROM accounts.cash_box_custodians`],

    // الصناديق نفسها
    [`cash_boxes`, `DELETE FROM accounts.cash_boxes`],
  ] as const;

  for (const [label, sql] of chain) {
    await tryQuery(label, sql);
  }

  const after = await query(`SELECT COUNT(*)::int n FROM accounts.cash_boxes`);
  const types = await query(`SELECT COUNT(*)::int n FROM accounts.cash_box_types`);
  console.log(`\nالمتبقي — صناديق: ${after.rows[0].n} | أنواع الصناديق: ${types.rows[0].n}`);
  if (Number(after.rows[0].n) === 0) {
    console.log('تم مسح جميع الصناديق.');
  }

  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
