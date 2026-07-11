/**
 * Seed آمن لأنواع الصناديق.
 * افتراضي: dry-run. التنفيذ: npm run seed:cash-box-types:execute
 */
import { closePool, query } from '../lib/db';
import { CASH_BOX_TYPE_SEED } from '../lib/accounts/cash-box-type-seed-data';
import { txQuery, withTransaction } from '../lib/accounts/with-transaction';

function parseArgs(argv: string[]) {
  const execute =
    argv.includes('--execute') ||
    argv.includes('-x') ||
    process.env.SEED_CASH_BOX_TYPES_EXECUTE === '1';
  return { dryRun: !execute };
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));

  const table = await query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'accounts' AND table_name = 'cash_box_types'`
  );
  if (!table.rows[0]) {
    throw new Error('جدول cash_box_types غير موجود — شغّل npm run migrate (062)');
  }

  const existing = await query(
    `SELECT code FROM accounts.cash_box_types`
  );
  const existingSet = new Set(
    (existing.rows as Array<{ code: string }>).map((r) => r.code.toUpperCase())
  );

  const toInsert = CASH_BOX_TYPE_SEED.filter(
    (t) => !existingSet.has(t.code.toUpperCase())
  );
  const toSkip = CASH_BOX_TYPE_SEED.filter((t) =>
    existingSet.has(t.code.toUpperCase())
  );

  console.log(dryRun ? '🔍 Dry-run (بدون إدراج)' : '✍️ Execute (إدراج فقط)');
  console.log(`موجود مسبقاً: ${toSkip.map((t) => t.code).join(', ') || '—'}`);
  console.log(`سيُدرج: ${toInsert.map((t) => t.code).join(', ') || '—'}`);

  if (dryRun) {
    console.log('\nللتنفيذ الفعلي: npm run seed:cash-box-types:execute');
    return;
  }

  if (toInsert.length === 0) {
    console.log('لا يوجد جديد للإدراج.');
    return;
  }

  await withTransaction(async (client) => {
    for (const t of toInsert) {
      await txQuery(
        client,
        `INSERT INTO accounts.cash_box_types
           (code, name_ar, name_en, description, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (code) DO NOTHING`,
        [t.code, t.name_ar, t.name_en, t.description, t.sort_order]
      );
    }
  });

  console.log(`✅ تم إدراج ${toInsert.length} نوعاً.`);
}

main()
  .catch((err) => {
    console.error('❌', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
