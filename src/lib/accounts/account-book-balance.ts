/**
 * حساب الرصيد الدفتري لحساب من القيود المرحلة فقط.
 * معزول لاستبداله لاحقاً بـ cache / materialized view دون تغيير واجهة الاستدعاء.
 */
import { query } from '@/src/lib/db';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';
import { millisToMoney, moneyToMillis, normalizeMoneyInput } from './money';

export type BookBalanceSource = 'POSTED_JOURNAL_LINES';

export type AccountBookBalance = {
  account_id: string;
  balance: string;
  source: BookBalanceSource;
};

async function sumPostedNet(
  runner: (
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: Array<{ net: string | null }> }>,
  accountId: string
): Promise<string> {
  const result = await runner(
    `SELECT COALESCE(SUM(l.debit_amount - l.credit_amount), 0)::text AS net
     FROM accounts.journal_entry_lines l
     INNER JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
     WHERE l.account_id = $1::uuid
       AND e.status = 'POSTED'`,
    [accountId]
  );
  const raw = result.rows[0]?.net ?? '0';
  return normalizeMoneyInput(String(raw));
}

/** رصيد حساب واحد (مدين − دائن) من قيود POSTED فقط */
export async function getAccountBookBalance(accountId: string): Promise<AccountBookBalance> {
  const balance = await sumPostedNet(query, accountId);
  return { account_id: accountId, balance, source: 'POSTED_JOURNAL_LINES' };
}

export async function getAccountBookBalanceTx(
  client: TxClient,
  accountId: string
): Promise<AccountBookBalance> {
  const balance = await sumPostedNet(
    (text: string, params?: unknown[]) => txQuery(client, text, params),
    accountId
  );
  return { account_id: accountId, balance, source: 'POSTED_JOURNAL_LINES' };
}

/** أرصدة عدة حسابات دفعة واحدة (نفس مصدر الحقيقة) */
export async function getAccountsBookBalances(
  accountIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(accountIds.filter(Boolean))];
  for (const id of unique) map.set(id, '0.000');
  if (unique.length === 0) return map;

  const result = await query(
    `SELECT l.account_id::text AS account_id,
            COALESCE(SUM(l.debit_amount - l.credit_amount), 0)::text AS net
     FROM accounts.journal_entry_lines l
     INNER JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
     WHERE l.account_id = ANY($1::uuid[])
       AND e.status = 'POSTED'
     GROUP BY l.account_id`,
    [unique]
  );

  for (const row of result.rows as Array<{ account_id: string; net: string }>) {
    map.set(row.account_id, normalizeMoneyInput(row.net));
  }
  return map;
}

/** فرق رصيدين كنص مالّي موحّد */
export function subtractBookBalances(a: string, b: string): string {
  return millisToMoney(moneyToMillis(a) - moneyToMillis(b));
}
