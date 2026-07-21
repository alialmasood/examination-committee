import { closePool, query } from "./src/lib/db";
async function main() {
  const r = await query(`
    SELECT is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='accounts' AND table_name='cash_count_adjustments' AND column_name='journal_entry_id'
  `);
  console.log(r.rows);
  // try nulling that one row
  try {
    await query(`UPDATE accounts.cash_count_adjustments SET journal_entry_id = NULL WHERE id = $1`, ['182c9213-342e-4b1c-82f7-f9b8d442d6d5']);
    console.log('null ok');
  } catch (e: any) {
    console.error('null failed', e.message);
  }
  await closePool();
}
main().catch(async e => { console.error(e); await closePool().catch(()=>{}); process.exit(1); });
