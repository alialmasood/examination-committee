/**
 * إعادة بناء إسقاط أرصدة دليل الحسابات (accounts.gl_account_balances) — Sprint A.
 *
 * مصدر الحقيقة يبقى قيود journal_entries بحالة POSTED. هذا السكربت يحذف كل صفوف
 * الإسقاط الحالية ويعيد بناءها بالكامل من مجموع (SUM) سطور القيود المُرحّلة،
 * مُجمّعة على مستوى (سنة مالية × حساب) فقط — fiscal_period_id و currency_code
 * دائماً NULL في Sprint A (انظر db/migrations/072_gl_account_balances.sql).
 *
 * لا مسار كتابة حي بعد — هذا استبدال كامل دوري/يدوي فقط.
 *
 * npm run accounts:rebuild-balances
 * npm run accounts:rebuild-balances -- --demo-only   (يقيّد النطاق على حسابات DEMO% فقط)
 */
import { closePool, query } from '../lib/db';
import { withTransaction } from '../lib/accounts/with-transaction';
import type { TxClient } from '../lib/accounts/with-transaction';

async function rebuild(demoOnly: boolean): Promise<number> {
  return withTransaction(async (client: TxClient) => {
    const demoFilter = demoOnly
      ? `AND EXISTS (
           SELECT 1 FROM accounts.chart_of_accounts c
           WHERE c.id = l.account_id AND c.code LIKE 'DEMO%'
         )`
      : '';

    if (demoOnly) {
      await client.query(
        `DELETE FROM accounts.gl_account_balances b
         WHERE EXISTS (
           SELECT 1 FROM accounts.chart_of_accounts c
           WHERE c.id = b.gl_account_id AND c.code LIKE 'DEMO%'
         )`
      );
    } else {
      await client.query(`TRUNCATE TABLE accounts.gl_account_balances`);
    }

    const result = await client.query(
      `WITH agg AS (
         SELECT e.fiscal_year_id AS fiscal_year_id,
                l.account_id AS gl_account_id,
                SUM(l.debit_amount) AS debit_total,
                SUM(l.credit_amount) AS credit_total
         FROM accounts.journal_entry_lines l
         JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
         WHERE e.status = 'POSTED'
         ${demoFilter}
         GROUP BY e.fiscal_year_id, l.account_id
       ),
       last_entry AS (
         SELECT DISTINCT ON (e.fiscal_year_id, l.account_id)
                e.fiscal_year_id AS fiscal_year_id,
                l.account_id AS gl_account_id,
                e.id AS journal_entry_id
         FROM accounts.journal_entry_lines l
         JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
         WHERE e.status = 'POSTED'
         ${demoFilter}
         ORDER BY e.fiscal_year_id, l.account_id, e.posted_at DESC NULLS LAST, e.id DESC
       )
       INSERT INTO accounts.gl_account_balances
         (fiscal_year_id, fiscal_period_id, gl_account_id, currency_code,
          debit_total, credit_total, balance, last_journal_entry_id, updated_at, row_version)
       SELECT a.fiscal_year_id, NULL, a.gl_account_id, NULL,
              a.debit_total, a.credit_total, a.debit_total - a.credit_total,
              le.journal_entry_id, NOW(), 1
       FROM agg a
       LEFT JOIN last_entry le
         ON le.fiscal_year_id = a.fiscal_year_id AND le.gl_account_id = a.gl_account_id
       RETURNING 1`
    );
    return result.rowCount ?? 0;
  });
}

async function main(): Promise<void> {
  const demoOnly = process.argv.includes('--demo-only');
  console.log(
    `🔄 إعادة بناء accounts.gl_account_balances${demoOnly ? ' (DEMO فقط)' : ' (كامل)'} ...`
  );
  const started = Date.now();
  const rows = await rebuild(demoOnly);
  const elapsedMs = Date.now() - started;

  const totalRows = await query(`SELECT COUNT(*)::int AS n FROM accounts.gl_account_balances`);
  console.log(`✅ تم إدراج ${rows} صف (إجمالي الجدول الآن: ${totalRows.rows[0].n}) في ${elapsedMs}ms`);
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (e) => {
    console.error('❌ فشل إعادة البناء:', e);
    process.exitCode = 1;
    await closePool().catch(() => undefined);
  });
