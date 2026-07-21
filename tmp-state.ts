import { closePool, query } from "./src/lib/db";
async function main() {
  const total = await query(`SELECT COUNT(*)::int n FROM accounts.journal_entries`);
  const lines = await query(`SELECT COUNT(*)::int n FROM accounts.journal_entry_lines`);
  const orphanLines = await query(`
    SELECT COUNT(*)::int n FROM accounts.journal_entries je
    WHERE NOT EXISTS (SELECT 1 FROM accounts.journal_entry_lines jel WHERE jel.journal_entry_id = je.id)
  `);
  const cca = await query(`SELECT COUNT(*)::int n FROM accounts.cash_count_adjustments WHERE journal_entry_id IS NOT NULL`);
  console.log({ total: total.rows[0].n, lines: lines.rows[0].n, entriesWithoutLines: orphanLines.rows[0].n, ccaWithJe: cca.rows[0].n });
  await closePool();
}
main().catch(async e => { console.error(e); await closePool().catch(()=>{}); process.exit(1); });
