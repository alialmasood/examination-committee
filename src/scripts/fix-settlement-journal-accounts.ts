/**
 * تصحيح حسابات قيود تسديد الطلبة الموجودة:
 * مدين → الصندوق (1111) | دائن → إيرادات الطلبة (4100)
 *
 * npx tsx src/scripts/fix-settlement-journal-accounts.ts --execute
 */
import { closePool, query } from '../lib/db';

const EXECUTE = process.argv.includes('--execute');

async function main() {
  console.log('===== تصحيح حسابات قيود تسديد الطلبة =====');

  // تسمية أوضح في دفتر اليومية حسب المطلوب
  await query(`
    UPDATE accounts.chart_of_accounts
    SET name_ar = 'الصندوق', updated_at = NOW()
    WHERE code = '1111' AND name_ar <> 'الصندوق'
  `);

  // تهيئة إيرادات الطلبة للترحيل
  await query(`
    UPDATE accounts.chart_of_accounts
    SET is_group = FALSE, allow_posting = TRUE, updated_at = NOW()
    WHERE code = '4100'
  `);

  const cash = await query(
    `SELECT id, code, name_ar FROM accounts.chart_of_accounts
     WHERE code = '1111' AND is_active AND NOT is_group AND allow_posting
     LIMIT 1`
  );
  const revenue = await query(
    `SELECT id, code, name_ar FROM accounts.chart_of_accounts
     WHERE code = '4100' AND is_active AND allow_posting
     LIMIT 1`
  );

  if (!cash.rows[0] || !revenue.rows[0]) {
    throw new Error('حساب الصندوق 1111 أو إيرادات الطلبة 4100 غير متاح');
  }

  console.log(`مدين: ${cash.rows[0].code} — ${cash.rows[0].name_ar}`);
  console.log(`دائن: ${revenue.rows[0].code} — ${revenue.rows[0].name_ar}`);

  const debitLines = await query(
    `SELECT l.id, e.entry_number, a.code AS old_code, a.name_ar AS old_name
     FROM accounts.journal_entry_lines l
     JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
     JOIN accounts.chart_of_accounts a ON a.id = l.account_id
     WHERE e.source_type = 'STUDENT_SETTLEMENT_RECEIPT'
       AND l.debit_amount > 0
       AND l.account_id <> $1::uuid`,
    [cash.rows[0].id]
  );

  const creditLines = await query(
    `SELECT l.id, e.entry_number, a.code AS old_code, a.name_ar AS old_name
     FROM accounts.journal_entry_lines l
     JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
     JOIN accounts.chart_of_accounts a ON a.id = l.account_id
     WHERE e.source_type = 'STUDENT_SETTLEMENT_RECEIPT'
       AND l.credit_amount > 0
       AND l.account_id <> $1::uuid`,
    [revenue.rows[0].id]
  );

  console.log(`سطور مدين بحاجة تصحيح: ${debitLines.rows.length}`);
  console.log(`سطور دائن بحاجة تصحيح: ${creditLines.rows.length}`);

  if (!EXECUTE) {
    console.log('معاينة فقط — أضف --execute للتنفيذ');
    await closePool();
    return;
  }

  const d = await query(
    `UPDATE accounts.journal_entry_lines l
     SET account_id = $1::uuid,
         description = CASE
           WHEN l.description ILIKE '%قبض%' THEN l.description
           ELSE 'قبض نقدي — تسديد قسط طالب'
         END
     FROM accounts.journal_entries e
     WHERE e.id = l.journal_entry_id
       AND e.source_type = 'STUDENT_SETTLEMENT_RECEIPT'
       AND l.debit_amount > 0
       AND l.account_id <> $1::uuid`,
    [cash.rows[0].id]
  );

  const c = await query(
    `UPDATE accounts.journal_entry_lines l
     SET account_id = $1::uuid,
         description = CASE
           WHEN l.description ILIKE '%إيرادات الطلبة%' THEN l.description
           ELSE REPLACE(COALESCE(l.description, ''), 'إيراد قسط دراسي', 'إيرادات الطلبة')
         END
     FROM accounts.journal_entries e
     WHERE e.id = l.journal_entry_id
       AND e.source_type = 'STUDENT_SETTLEMENT_RECEIPT'
       AND l.credit_amount > 0
       AND l.account_id <> $1::uuid`,
    [revenue.rows[0].id]
  );

  console.log(`تم تصحيح المدين: ${d.rowCount ?? 0}`);
  console.log(`تم تصحيح الدائن: ${c.rowCount ?? 0}`);
  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
