import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { pool } from '@/src/lib/db';

export type TxClient = PoolClient;

export async function withTransaction<T>(
  fn: (client: TxClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('فشل Rollback للمعاملة:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function txQuery<T extends QueryResultRow = QueryResultRow>(
  client: TxClient,
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return client.query<T>(text, params);
}

/** قفل ثابت لعمليات السنوات المالية */
export const ADVISORY_LOCK_FISCAL_YEARS = 58001001;

/** نطاق قفل الفترات (المفتاح الثاني = hashtext(fiscal_year_id)) */
export const ADVISORY_LOCK_FISCAL_PERIODS = 58001002;

/** قفل شجرة مراكز الكلفة */
export const ADVISORY_LOCK_COST_CENTERS = 58001003;

/** قفل دليل الحسابات */
export const ADVISORY_LOCK_CHART_OF_ACCOUNTS = 58001004;

/** قفل عمليات القيود المحاسبية */
export const ADVISORY_LOCK_JOURNAL_ENTRIES = 58001005;

/** قفل عمليات الصناديق */
export const ADVISORY_LOCK_CASH_BOXES = 58001006;

export async function acquireFiscalYearsLock(client: TxClient): Promise<void> {
  await txQuery(client, 'SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_FISCAL_YEARS]);
}

export async function acquireFiscalPeriodsLock(
  client: TxClient,
  fiscalYearId: string
): Promise<void> {
  await txQuery(client, 'SELECT pg_advisory_xact_lock($1, hashtext($2::text))', [
    ADVISORY_LOCK_FISCAL_PERIODS,
    fiscalYearId,
  ]);
}

export async function acquireCostCentersLock(client: TxClient): Promise<void> {
  await txQuery(client, 'SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_COST_CENTERS]);
}

export async function acquireChartOfAccountsLock(client: TxClient): Promise<void> {
  await txQuery(client, 'SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_CHART_OF_ACCOUNTS]);
}

export async function acquireJournalEntriesLock(client: TxClient): Promise<void> {
  await txQuery(client, 'SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_JOURNAL_ENTRIES]);
}

export async function acquireCashBoxesLock(client: TxClient): Promise<void> {
  await txQuery(client, 'SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_CASH_BOXES]);
}
