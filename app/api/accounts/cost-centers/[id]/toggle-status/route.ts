import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import {
  acquireCostCentersLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;

    const updated = await withTransaction(async (client) => {
      await acquireCostCentersLock(client);
      const existing = await txQuery(client, `SELECT * FROM accounts.cost_centers WHERE id = $1`, [id]);
      if (existing.rows.length === 0) throw new AccountsHttpError('مركز الكلفة غير موجود', 404);
      const current = existing.rows[0];
      const nextActive = !current.is_active;

      const result = await txQuery(
        client,
        `UPDATE accounts.cost_centers
         SET is_active = $2, updated_by = $3, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, nextActive, auth.user.id]
      );

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cost_center.toggle_status',
        entityType: 'cost_center',
        entityId: id,
        oldValues: current,
        newValues: result.rows[0],
        description: `${nextActive ? 'تفعيل' : 'تعطيل'} مركز كلفة ${current.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({
      data: updated,
      message: updated.is_active ? 'تم تفعيل مركز الكلفة' : 'تم تعطيل مركز الكلفة',
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
