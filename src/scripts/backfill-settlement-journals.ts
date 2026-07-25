/**
 * ترحيل رجعي لوصولات التسديد التي لم تُرحَّل إلى دفتر اليومية.
 * npx tsx src/scripts/backfill-settlement-journals.ts --execute
 */
import { postStudentSettlementJournalEntry } from '../lib/accounts/student-settlement-gl';
import { closePool, query } from '../lib/db';
import { withTransaction } from '../lib/accounts/with-transaction';

const EXECUTE = process.argv.includes('--execute');

async function main() {
  console.log('===== ترحيل رجعي لوصولات التسديد =====');

  const receipts = await query(`
    SELECT r.id, r.receipt_number, r.settlement_date::text AS settlement_date,
           r.pay_amount::float8 AS pay_amount, r.student_name, r.university_id,
           r.study_type, r.created_by::text AS created_by, r.journal_entry_id
    FROM accounts.student_settlement_receipts r
    WHERE r.journal_entry_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM accounts.journal_entries e
         WHERE e.source_type = 'STUDENT_SETTLEMENT_RECEIPT'
           AND e.source_id = r.id
       )
    ORDER BY r.settlement_date, r.created_at
  `);

  console.log(`وصولات بانتظار الترحيل: ${receipts.rows.length}`);
  if (receipts.rows.length === 0) {
    await closePool();
    return;
  }

  let userId =
    receipts.rows.find((r) => r.created_by)?.created_by ||
    (
      await query(
        `SELECT id::text FROM student_affairs.users WHERE is_active = TRUE ORDER BY created_at LIMIT 1`
      )
    ).rows[0]?.id;

  if (!userId) {
    throw new Error('لا يوجد مستخدم لترحيل القيود');
  }

  if (!EXECUTE) {
    for (const r of receipts.rows) {
      console.log(`  - ${r.receipt_number} | ${r.settlement_date} | ${r.pay_amount}`);
    }
    console.log('معاينة فقط — أضف --execute للتنفيذ');
    await closePool();
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const r of receipts.rows) {
    try {
      const posted = await withTransaction((client) =>
        postStudentSettlementJournalEntry(client, {
          receiptId: r.id,
          receiptNumber: r.receipt_number,
          settlementDate: String(r.settlement_date).slice(0, 10),
          amount: Number(r.pay_amount),
          studentName: r.student_name,
          universityId: r.university_id,
          studyType: r.study_type,
          userId: r.created_by || userId,
        })
      );
      await query(
        `UPDATE accounts.student_settlement_receipts SET journal_entry_id = $2 WHERE id = $1`,
        [r.id, posted.id]
      ).catch(() => undefined);
      console.log(`  ✓ ${r.receipt_number} → ${posted.entry_number}`);
      ok += 1;
    } catch (e) {
      fail += 1;
      console.error(`  ✗ ${r.receipt_number}:`, e instanceof Error ? e.message : e);
    }
  }

  console.log(`\nنجح: ${ok} | فشل: ${fail}`);
  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
