/**
 * ⚠️ ليس benchmark إنتاجي — قياس محلي تقريبي فقط على بيئة التطوير الحالية،
 * بحجم بيانات اصطناعي محدود. الهدف: رصد اتجاه الأداء قبل/بعد فهارس 071 ومناقشة
 * جدوى إسقاط الأرصدة (072)، لا إصدار أرقام SLA رسمية.
 *
 * يقيس:
 * 1) زمن getAccountBookBalance على حساب حقيقي موجود (عدة تكرارات + متوسط).
 * 2) EXPLAIN ANALYZE لاستعلام SUM المستخدم داخلياً (accounts/account-book-balance.ts).
 * 3) نفس القياسين بعد إدراج ~10,000 سطر إضافي على نفس الحساب داخل معاملة تُلغى
 *    بالكامل (ROLLBACK) — لا يبقى أي أثر في القاعدة.
 *
 * npm run accounts:benchmark-balance
 */
import { closePool, query } from '../lib/db';
import { getAccountBookBalance } from '../lib/accounts/account-book-balance';
import { withTransaction } from '../lib/accounts/with-transaction';
import type { TxClient } from '../lib/accounts/with-transaction';

const SUM_QUERY = `SELECT COALESCE(SUM(l.debit_amount - l.credit_amount), 0)::text AS net
     FROM accounts.journal_entry_lines l
     INNER JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
     WHERE l.account_id = $1::uuid
       AND e.status = 'POSTED'`;

async function pickBenchmarkAccount(): Promise<{ id: string; code: string; lineCount: number } | null> {
  const r = await query(
    `SELECT a.id::text AS id, a.code, COUNT(l.id)::text AS line_count
     FROM accounts.chart_of_accounts a
     JOIN accounts.journal_entry_lines l ON l.account_id = a.id
     JOIN accounts.journal_entries e ON e.id = l.journal_entry_id AND e.status = 'POSTED'
     GROUP BY a.id, a.code
     ORDER BY COUNT(l.id) DESC
     LIMIT 1`
  );
  const row = r.rows[0] as
    | { id: string; code: string; line_count: string }
    | undefined;
  if (!row) return null;
  return { id: row.id, code: row.code, lineCount: Number(row.line_count) };
}

async function timeAverage(label: string, runs: number, fn: () => Promise<unknown>): Promise<void> {
  const timings: number[] = [];
  for (let i = 0; i < runs; i++) {
    const started = process.hrtime.bigint();
    await fn();
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    timings.push(elapsedMs);
  }
  const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
  const min = Math.min(...timings);
  const max = Math.max(...timings);
  console.log(
    `⏱️  ${label}: avg=${avg.toFixed(2)}ms min=${min.toFixed(2)}ms max=${max.toFixed(2)}ms (${runs} تكرار)`
  );
}

async function explainAnalyze(
  runner: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
  accountId: string
): Promise<void> {
  const r = await runner(`EXPLAIN (ANALYZE, BUFFERS, TIMING) ${SUM_QUERY}`, [accountId]);
  console.log(r.rows.map((row) => Object.values(row)[0]).join('\n'));
}

async function insertSyntheticLines(client: TxClient, accountId: string, count: number): Promise<void> {
  const userRes = await client.query<{ id: string }>(
    `SELECT id FROM student_affairs.users WHERE is_active LIMIT 1`
  );
  if (!userRes.rows[0]) throw new Error('لا يوجد مستخدم فعّال لإنشاء قيد اختبار');
  const userId = userRes.rows[0].id;

  const year = await client.query<{ id: string }>(
    `SELECT id FROM accounts.fiscal_years WHERE status = 'ACTIVE' ORDER BY is_default DESC LIMIT 1`
  );
  if (!year.rows[0]) throw new Error('لا سنة مالية ACTIVE لإنشاء قيد اختبار');
  const period = await client.query<{ id: string; start_date: string }>(
    `SELECT id, start_date::text AS start_date FROM accounts.fiscal_periods
     WHERE fiscal_year_id = $1 AND status = 'OPEN' ORDER BY period_number LIMIT 1`,
    [year.rows[0].id]
  );
  if (!period.rows[0]) throw new Error('لا فترة OPEN لإنشاء قيد اختبار');

  const halfAmount = (count / 2) * 1; // 1.000 لكل سطر — نصف مدين ونصف دائن يوازن القيد
  const je = await client.query<{ id: string }>(
    `INSERT INTO accounts.journal_entries
       (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
        description, total_debit, total_credit, status, created_by, updated_by,
        posted_by, posted_at)
     VALUES ($1,$2,$3,$4::date,'MANUAL',$5,$6::numeric,$6::numeric,'POSTED',$7,$7,$7,NOW())
     RETURNING id`,
    [
      `BENCH-${Date.now()}`,
      year.rows[0].id,
      period.rows[0].id,
      period.rows[0].start_date,
      'قيد اصطناعي لقياس الأداء — يُلغى بالكامل (ROLLBACK)',
      halfAmount,
      userId,
    ]
  );
  const journalEntryId = je.rows[0].id;

  await client.query(
    `INSERT INTO accounts.journal_entry_lines
       (journal_entry_id, line_number, account_id, debit_amount, credit_amount)
     SELECT $1::uuid, gs, $2::uuid,
            CASE WHEN gs % 2 = 0 THEN 1.000 ELSE 0 END,
            CASE WHEN gs % 2 = 1 THEN 1.000 ELSE 0 END
     FROM generate_series(1, $3::int) AS gs`,
    [journalEntryId, accountId, count]
  );
}

async function main(): Promise<void> {
  console.log('⚠️  تنبيه: هذا ليس benchmark إنتاجي — قياس تقريبي محلي فقط.\n');

  const account = await pickBenchmarkAccount();
  if (!account) {
    console.log('لا يوجد حساب لديه سطور POSTED — لا يمكن تنفيذ القياس. شغّل seed:accounts-demo أولاً.');
    return;
  }
  console.log(`الحساب المُختار للقياس: ${account.code} (${account.lineCount} سطر POSTED حالياً)\n`);

  console.log('— قبل الإدراج الاصطناعي —');
  await timeAverage('getAccountBookBalance', 5, () => getAccountBookBalance(account.id));
  await explainAnalyze((text, params) => query(text, params), account.id);

  console.log('\n— إدراج 10,000 سطر اصطناعي داخل معاملة تُلغى بالكامل (ROLLBACK) —');
  const SYNTHETIC_LINES = 10_000;

  await withTransaction(async (client) => {
    const insertStarted = process.hrtime.bigint();
    await insertSyntheticLines(client, account.id, SYNTHETIC_LINES);
    const insertMs = Number(process.hrtime.bigint() - insertStarted) / 1_000_000;
    console.log(`⏱️  إدراج ${SYNTHETIC_LINES} سطر: ${insertMs.toFixed(2)}ms`);

    console.log('\n— بعد الإدراج الاصطناعي (داخل نفس المعاملة، قبل الإلغاء) —');
    const timings: number[] = [];
    for (let i = 0; i < 5; i++) {
      const started = process.hrtime.bigint();
      await client.query(SUM_QUERY, [account.id]);
      timings.push(Number(process.hrtime.bigint() - started) / 1_000_000);
    }
    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    console.log(
      `⏱️  استعلام SUM (نفس منطق getAccountBookBalance) داخل tx: avg=${avg.toFixed(2)}ms ` +
        `min=${Math.min(...timings).toFixed(2)}ms max=${Math.max(...timings).toFixed(2)}ms`
    );

    await explainAnalyze((text, params) => client.query(text, params), account.id);

    // ROLLBACK صريح لضمان عدم بقاء أي أثر — withTransaction يعكس عند رمي استثناء
    throw new Error('__BENCHMARK_ROLLBACK__');
  }).catch((e) => {
    if (!(e instanceof Error) || e.message !== '__BENCHMARK_ROLLBACK__') throw e;
    console.log('\n↩️  تم إلغاء (ROLLBACK) كل الإدراج الاصطناعي — لا أثر في القاعدة.');
  });

  console.log(
    '\nملاحظة: الفرق (إن وُجد) يعكس حجم بيانات محلي صغير فقط؛ راجع migration 071 للفهارس ' +
      'و072/D لخيار إسقاط الأرصدة إذا أصبح حجم القيود إنتاجياً كبيراً.'
  );
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (e) => {
    console.error('❌ فشل القياس:', e);
    process.exitCode = 1;
    await closePool().catch(() => undefined);
  });
