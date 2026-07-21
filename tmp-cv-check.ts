import { closePool, query } from "./src/lib/db";
async function main() {
  try {
    await query(`UPDATE accounts.cash_vouchers SET journal_entry_id = NULL WHERE journal_entry_id = $1`, ['bb7c6d2b-9f53-4d0b-8c04-95eb1b497874']);
    console.log('null ok');
  } catch (e: any) {
    console.error('null failed:', e.message);
  }
  // find check constraints mentioning journal_entry on related tables
  const r = await query(`
    SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE contype='c'
      AND pg_get_constraintdef(oid) ILIKE '%journal_entry%'
      AND connamespace = 'accounts'::regnamespace
    ORDER BY 1
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  await closePool();
}
main().catch(async e => { console.error(e); await closePool().catch(()=>{}); process.exit(1); });
