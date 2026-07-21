import { closePool, query } from "./src/lib/db";
async function main() {
  const cols = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='accounts' AND table_name='cash_count_adjustments'
    ORDER BY ordinal_position
  `);
  console.log("cols", cols.rows);
  const sample = await query(`
    SELECT id, journal_entry_id FROM accounts.cash_count_adjustments
    WHERE journal_entry_id = '1244b0c4-f01e-4612-bbc3-52f82ecd79c8'
  `);
  console.log("refs", sample.rows);
  await closePool();
}
main().catch(async e => { console.error(e); await closePool().catch(()=>{}); process.exit(1); });
