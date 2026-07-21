import { closePool, query } from "./src/lib/db";
async function main() {
  const total = await query(`SELECT COUNT(*)::int n FROM accounts.journal_entries`);
  const fa = await query(`
    SELECT COUNT(*)::int n FROM accounts.journal_entries
    WHERE COALESCE(description,'') ILIKE '%FA-VINV%'
       OR COALESCE(description,'') ILIKE '%VINV%'
  `);
  const sample = await query(`
    SELECT LEFT(COALESCE(description,'(null)'), 120) AS description,
           COALESCE(reference_number,'') AS ref,
           COALESCE(source_type,'') AS source_type
    FROM accounts.journal_entries
    ORDER BY entry_date DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 10
  `);
  const sampleFa = await query(`
    SELECT LEFT(COALESCE(description,'(null)'), 120) AS description,
           COALESCE(reference_number,'') AS ref
    FROM accounts.journal_entries
    WHERE COALESCE(description,'') ILIKE '%VINV%'
       OR COALESCE(description,'') ILIKE '%FA-%'
    ORDER BY entry_date DESC NULLS LAST
    LIMIT 10
  `);
  const topPatterns = await query(`
    SELECT LEFT(COALESCE(description,'(empty)'), 80) AS d, COUNT(*)::int n
    FROM accounts.journal_entries
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 15
  `);
  console.log(JSON.stringify({
    total: total.rows[0].n,
    vinv_or_fa_vinv_count: fa.rows[0].n,
    sample_10: sample.rows,
    sample_fa_vinv: sampleFa.rows,
    top_descriptions: topPatterns.rows,
  }, null, 2));
  await closePool();
}
main().catch(async e => { console.error(e); await closePool().catch(()=>{}); process.exit(1); });
