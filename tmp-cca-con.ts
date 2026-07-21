import { closePool, query } from "./src/lib/db";
async function main() {
  const r = await query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'accounts.cash_count_adjustments'::regclass
  `);
  console.log(r.rows);
  await closePool();
}
main().catch(async e => { console.error(e); await closePool().catch(()=>{}); process.exit(1); });
