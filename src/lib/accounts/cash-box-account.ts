import { AccountsHttpError } from './auth';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type CashEligibleAccount = {
  id: string;
  code: string;
  name_ar: string;
  is_group: boolean;
  allow_posting: boolean;
  is_active: boolean;
  account_type_code: string;
};

/**
 * يتحقق أن الحساب صالح لربطه بصندوق:
 * ASSET · تفصيلي · allow_posting · فعّال · غير مستخدم لصندوق ACTIVE/SUSPENDED آخر.
 */
export async function assertCashBoxAccountEligible(
  client: TxClient,
  accountId: string,
  excludeCashBoxId?: string | null
): Promise<CashEligibleAccount> {
  const acc = await txQuery<CashEligibleAccount>(
    client,
    `SELECT a.id, a.code, a.name_ar, a.is_group, a.allow_posting, a.is_active,
            t.code AS account_type_code
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE a.id = $1::uuid`,
    [accountId]
  );

  if (!acc.rows[0]) {
    throw new AccountsHttpError('الحساب المحدد غير موجود', 404);
  }

  const row = acc.rows[0];

  if (row.account_type_code !== 'ASSET') {
    throw new AccountsHttpError('يجب أن يكون حساب الصندوق من نوع الأصول (ASSET)', 400);
  }
  if (row.is_group) {
    throw new AccountsHttpError('لا يمكن ربط الصندوق بحساب تجميعي', 400);
  }
  if (!row.allow_posting) {
    throw new AccountsHttpError('الحساب غير قابل للترحيل', 400);
  }
  if (!row.is_active) {
    throw new AccountsHttpError('الحساب غير فعّال', 400);
  }

  const conflict = await txQuery(
    client,
    `SELECT id, code, status
     FROM accounts.cash_boxes
     WHERE account_id = $1::uuid
       AND status IN ('ACTIVE', 'SUSPENDED')
       AND ($2::uuid IS NULL OR id <> $2::uuid)
     LIMIT 1`,
    [accountId, excludeCashBoxId ?? null]
  );

  if (conflict.rows[0]) {
    throw new AccountsHttpError(
      `الحساب مرتبط بصندوق حي آخر (${conflict.rows[0].code})`,
      409
    );
  }

  return row;
}

export async function listEligibleCashAccounts(client?: TxClient): Promise<CashEligibleAccount[]> {
  const sql = `
    SELECT a.id, a.code, a.name_ar, a.is_group, a.allow_posting, a.is_active,
           t.code AS account_type_code
    FROM accounts.chart_of_accounts a
    JOIN accounts.account_types t ON t.id = a.account_type_id
    WHERE t.code = 'ASSET'
      AND a.is_group = FALSE
      AND a.allow_posting = TRUE
      AND a.is_active = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM accounts.cash_boxes cb
        WHERE cb.account_id = a.id
          AND cb.status IN ('ACTIVE', 'SUSPENDED')
      )
    ORDER BY a.code ASC
  `;
  if (client) {
    const r = await txQuery<CashEligibleAccount>(client, sql);
    return r.rows;
  }
  const { query } = await import('@/src/lib/db');
  const r = await query(sql);
  return r.rows as CashEligibleAccount[];
}
