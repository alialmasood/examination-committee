import { closePool, query } from "./src/lib/db";
async function main() {
  const r = await query(`
    SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE confrelid = 'accounts.journal_entry_lines'::regclass
       OR confrelid = 'accounts.journal_entries'::regclass
    ORDER BY 1, 2
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  await closePool();
}
main().catch(async (e) => { console.error(e); await closePool().catch(() => undefined); process.exit(1); });
