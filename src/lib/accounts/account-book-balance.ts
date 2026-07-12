/**
 * حساب الرصيد الدفتري لحساب من القيود المرحلة فقط.
 * معزول لاستبداله لاحقاً بـ cache / materialized view دون تغيير واجهة الاستدعاء.
 */
import { query } from '@/src/lib/db';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';
import {
  millisToMoney,
  moneyEquals,
  moneyToMillisSigned,
  normalizeSignedMoneyInput,
} from './money';

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
  return normalizeSignedMoneyInput(String(raw));
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
    map.set(row.account_id, normalizeSignedMoneyInput(row.net));
  }
  return map;
}

/** فرق رصيدين كنص مالّي موحّد */
export function subtractBookBalances(a: string, b: string): string {
  return millisToMoney(moneyToMillisSigned(a) - moneyToMillisSigned(b));
}

export type LastPostedEntrySnapshot = {
  entry_id: string;
  posted_at: Date;
};

type Runner = (
  text: string,
  params?: unknown[]
) => Promise<{ rows: Array<Record<string, unknown>> }>;

async function fetchLastPostedEntry(
  runner: Runner,
  accountId: string
): Promise<LastPostedEntrySnapshot | null> {
  const result = await runner(
    `SELECT e.id::text AS entry_id, e.posted_at
     FROM accounts.journal_entry_lines l
     INNER JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
     WHERE l.account_id = $1::uuid
       AND e.status = 'POSTED'
       AND e.posted_at IS NOT NULL
     ORDER BY e.posted_at DESC, e.id DESC
     LIMIT 1`,
    [accountId]
  );
  const row = result.rows[0] as
    | { entry_id: string; posted_at: Date | string }
    | undefined;
  if (!row) return null;
  return {
    entry_id: row.entry_id,
    posted_at:
      row.posted_at instanceof Date ? row.posted_at : new Date(String(row.posted_at)),
  };
}

/** آخر قيد POSTED يؤثر على الحساب (للقطات التدقيق والتحقق) */
export async function getLastPostedEntryForAccount(
  accountId: string
): Promise<LastPostedEntrySnapshot | null> {
  return fetchLastPostedEntry(query, accountId);
}

export async function getLastPostedEntryForAccountTx(
  client: TxClient,
  accountId: string
): Promise<LastPostedEntrySnapshot | null> {
  return fetchLastPostedEntry(
    (text, params) => txQuery(client, text, params),
    accountId
  );
}

export type BookSnapshot = {
  balance: string;
  last_posted_entry_id: string | null;
  last_posted_at: Date | null;
};

/** لقطة رصيد + آخر قيد مرحّل في معاملة واحدة */
export async function captureAccountBookSnapshotTx(
  client: TxClient,
  accountId: string
): Promise<BookSnapshot> {
  const bal = await getAccountBookBalanceTx(client, accountId);
  const last = await getLastPostedEntryForAccountTx(client, accountId);
  return {
    balance: bal.balance,
    last_posted_entry_id: last?.entry_id ?? null,
    last_posted_at: last?.posted_at ?? null,
  };
}

function toMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * هل ظهر نشاط دفتري بعد لقطة الجرد؟
 * يقارن الرصيد وآخر قيد (id + posted_at) ولا يعتمد على الزمن وحده.
 */
export function detectBookDriftSinceCount(params: {
  currentBalance: string;
  currentLast: LastPostedEntrySnapshot | null;
  snapshotBalance: string;
  snapshotEntryId: string | null;
  snapshotPostedAt: Date | string | null;
}): { drifted: boolean; reason: 'balance' | 'entry' | null } {
  if (!moneyEquals(params.currentBalance, params.snapshotBalance)) {
    return { drifted: true, reason: 'balance' };
  }

  const snapId = params.snapshotEntryId;
  const snapAt = toMs(params.snapshotPostedAt);
  const cur = params.currentLast;

  if (!snapId && !cur) {
    return { drifted: false, reason: null };
  }
  if (!snapId && cur) {
    return { drifted: true, reason: 'entry' };
  }
  if (snapId && !cur) {
    return { drifted: true, reason: 'entry' };
  }
  if (!cur || !snapId) {
    return { drifted: true, reason: 'entry' };
  }

  if (cur.entry_id !== snapId) {
    return { drifted: true, reason: 'entry' };
  }

  const curAt = toMs(cur.posted_at);
  if (snapAt != null && curAt != null && curAt > snapAt) {
    return { drifted: true, reason: 'entry' };
  }

  if (
    snapAt != null &&
    curAt != null &&
    curAt === snapAt &&
    cur.entry_id > snapId
  ) {
    return { drifted: true, reason: 'entry' };
  }

  return { drifted: false, reason: null };
}
