/**
 * تحقّق (بلا كتابة) من تطابق إسقاط accounts.gl_account_balances مع مصدر الحقيقة
 * (SUM سطور journal_entry_lines لقيود POSTED) — Sprint A.
 *
 * يخرج بكود 1 عند وجود أي فرق. لا يكتب أي شيء على قاعدة البيانات.
 *
 * npm run accounts:verify-balances
 */
import { closePool, query } from '../lib/db';

type ComputedRow = {
  fiscal_year_id: string;
  gl_account_id: string;
  debit_total: string;
  credit_total: string;
  balance: string;
};

type ProjectedRow = {
  fiscal_year_id: string;
  gl_account_id: string;
  debit_total: string;
  credit_total: string;
  balance: string;
};

function keyOf(r: { fiscal_year_id: string; gl_account_id: string }): string {
  return `${r.fiscal_year_id}::${r.gl_account_id}`;
}

async function main(): Promise<void> {
  const computedRes = await query(
    `SELECT e.fiscal_year_id::text AS fiscal_year_id,
            l.account_id::text AS gl_account_id,
            SUM(l.debit_amount)::text AS debit_total,
            SUM(l.credit_amount)::text AS credit_total,
            SUM(l.debit_amount - l.credit_amount)::text AS balance
     FROM accounts.journal_entry_lines l
     JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
     WHERE e.status = 'POSTED'
     GROUP BY e.fiscal_year_id, l.account_id`
  );
  const computed = { rows: computedRes.rows as ComputedRow[] };
  const projectedRes = await query(
    `SELECT fiscal_year_id::text AS fiscal_year_id,
            gl_account_id::text AS gl_account_id,
            debit_total::text AS debit_total,
            credit_total::text AS credit_total,
            balance::text AS balance
     FROM accounts.gl_account_balances
     WHERE fiscal_period_id IS NULL AND currency_code IS NULL`
  );
  const projected = { rows: projectedRes.rows as ProjectedRow[] };

  const computedMap = new Map<string, ComputedRow>();
  for (const row of computed.rows) computedMap.set(keyOf(row), row);
  const projectedMap = new Map<string, ProjectedRow>();
  for (const row of projected.rows) projectedMap.set(keyOf(row), row);

  const mismatches: string[] = [];
  const missingInProjection: string[] = [];
  const staleInProjection: string[] = [];

  for (const [key, c] of computedMap) {
    const p = projectedMap.get(key);
    if (!p) {
      missingInProjection.push(
        `${key} — مفقود في الإسقاط (balance المتوقع: ${c.balance})`
      );
      continue;
    }
    if (
      Number(c.debit_total) !== Number(p.debit_total) ||
      Number(c.credit_total) !== Number(p.credit_total) ||
      Number(c.balance) !== Number(p.balance)
    ) {
      mismatches.push(
        `${key} — محسوب(debit=${c.debit_total}, credit=${c.credit_total}, balance=${c.balance}) ` +
          `≠ إسقاط(debit=${p.debit_total}, credit=${p.credit_total}, balance=${p.balance})`
      );
    }
  }

  for (const [key] of projectedMap) {
    if (!computedMap.has(key)) {
      staleInProjection.push(`${key} — موجود في الإسقاط بلا أي سطر POSTED محسوب (قديم/بلا حركة)`);
    }
  }

  console.log(`فحص ${computedMap.size} مجموعة (سنة×حساب) من المصدر مقابل ${projectedMap.size} في الإسقاط.`);

  if (mismatches.length === 0 && missingInProjection.length === 0 && staleInProjection.length === 0) {
    console.log('✅ الإسقاط متطابق تماماً مع مصدر الحقيقة (POSTED journal_entry_lines).');
    return;
  }

  if (mismatches.length) {
    console.error(`❌ ${mismatches.length} فرق في القيم:`);
    for (const m of mismatches) console.error(`  - ${m}`);
  }
  if (missingInProjection.length) {
    console.error(`❌ ${missingInProjection.length} صف ناقص في الإسقاط (شغّل npm run accounts:rebuild-balances):`);
    for (const m of missingInProjection) console.error(`  - ${m}`);
  }
  if (staleInProjection.length) {
    console.error(`⚠️  ${staleInProjection.length} صف قديم في الإسقاط بلا مقابل حالي:`);
    for (const m of staleInProjection) console.error(`  - ${m}`);
  }
  process.exitCode = 1;
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (e) => {
    console.error('❌ فشل التحقق:', e);
    process.exitCode = 1;
    await closePool().catch(() => undefined);
  });
