import { AccountsHttpError } from './auth';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type CustodianRole = 'CUSTODIAN' | 'SUPERVISOR';

export type CashBoxCustodianRow = {
  id: string;
  cash_box_id: string;
  user_id: string;
  role: CustodianRole;
  is_primary: boolean;
  valid_from: Date | string;
  valid_to: Date | string | null;
  notes: string | null;
  username?: string;
  full_name?: string | null;
};

export async function listCashBoxCustodians(
  client: TxClient,
  cashBoxId: string,
  activeOnly = false
): Promise<CashBoxCustodianRow[]> {
  const r = await txQuery<CashBoxCustodianRow>(
    client,
    `SELECT c.*, u.username, COALESCE(u.full_name, u.username) AS full_name
     FROM accounts.cash_box_custodians c
     JOIN student_affairs.users u ON u.id = c.user_id
     WHERE c.cash_box_id = $1::uuid
       AND ($2::boolean = FALSE OR c.valid_to IS NULL)
     ORDER BY c.is_primary DESC, c.valid_from DESC`,
    [cashBoxId, activeOnly]
  );
  return r.rows;
}

async function assertActiveUser(client: TxClient, userId: string): Promise<void> {
  const r = await txQuery(
    client,
    `SELECT id FROM student_affairs.users WHERE id = $1::uuid AND is_active = TRUE`,
    [userId]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('المستخدم غير موجود أو غير نشط', 400);
  }
}

/**
 * تعيين أمين أساسي ساري: يُنهي أي أمين أساسي سابق ثم يدرج تعييناً جديداً.
 */
export async function assignPrimaryCustodian(
  client: TxClient,
  params: {
    cashBoxId: string;
    userId: string;
    role?: unknown;
    notes?: unknown;
    createdBy: string;
  }
): Promise<CashBoxCustodianRow> {
  await assertActiveUser(client, params.userId);

  const roleRaw = String(params.role ?? 'CUSTODIAN').toUpperCase();
  if (roleRaw !== 'CUSTODIAN' && roleRaw !== 'SUPERVISOR') {
    throw new AccountsHttpError('دور الأمين غير صالح', 400);
  }

  await txQuery(
    client,
    `UPDATE accounts.cash_box_custodians
     SET valid_to = NOW(),
         updated_by = $2::uuid,
         updated_at = NOW()
     WHERE cash_box_id = $1::uuid
       AND is_primary = TRUE
       AND valid_to IS NULL`,
    [params.cashBoxId, params.createdBy]
  );

  const ins = await txQuery<CashBoxCustodianRow>(
    client,
    `INSERT INTO accounts.cash_box_custodians (
       cash_box_id, user_id, role, is_primary, valid_from, notes, created_by, updated_by
     ) VALUES (
       $1::uuid, $2::uuid, $3, TRUE, NOW(), $4, $5::uuid, $5::uuid
     )
     RETURNING *`,
    [
      params.cashBoxId,
      params.userId,
      roleRaw,
      params.notes != null ? String(params.notes).trim() || null : null,
      params.createdBy,
    ]
  );

  return ins.rows[0];
}

export async function endCustodianAssignment(
  client: TxClient,
  params: {
    cashBoxId: string;
    custodianId: string;
    endedBy: string;
  }
): Promise<CashBoxCustodianRow> {
  const r = await txQuery<CashBoxCustodianRow>(
    client,
    `UPDATE accounts.cash_box_custodians
     SET valid_to = NOW(),
         updated_by = $3::uuid,
         updated_at = NOW()
     WHERE id = $1::uuid
       AND cash_box_id = $2::uuid
       AND valid_to IS NULL
     RETURNING *`,
    [params.custodianId, params.cashBoxId, params.endedBy]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('تعيين الأمين غير موجود أو منتهٍ مسبقاً', 404);
  }
  return r.rows[0];
}

export async function getActivePrimaryCustodian(
  client: TxClient,
  cashBoxId: string
): Promise<CashBoxCustodianRow | null> {
  const r = await txQuery<CashBoxCustodianRow>(
    client,
    `SELECT c.*, u.username
     FROM accounts.cash_box_custodians c
     JOIN student_affairs.users u ON u.id = c.user_id
     WHERE c.cash_box_id = $1::uuid
       AND c.is_primary = TRUE
       AND c.valid_to IS NULL
     LIMIT 1`,
    [cashBoxId]
  );
  return r.rows[0] ?? null;
}
