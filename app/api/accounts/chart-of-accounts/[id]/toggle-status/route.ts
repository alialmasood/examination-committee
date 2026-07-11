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
import { loadChartAccount } from '@/src/lib/accounts/chart-of-accounts';
import {
  acquireChartOfAccountsLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const forceWithActiveChildren = Boolean(body.force_with_active_children);

    const updated = await withTransaction(async (client) => {
      await acquireChartOfAccountsLock(client);
      const current = await loadChartAccount(client, id, true);
      const nextActive = !current.is_active;

      if (!nextActive) {
        const activeChildren = await txQuery<{ c: number }>(
          client,
          `SELECT COUNT(*)::int AS c FROM accounts.chart_of_accounts
           WHERE parent_id = $1 AND is_active = TRUE`,
          [id]
        );
        if (Number(activeChildren.rows[0]?.c || 0) > 0 && !forceWithActiveChildren) {
          throw new AccountsHttpError(
            'لا يمكن تعطيل حساب أب لوجود حسابات فرعية فعالة. أرسل force_with_active_children=true بعد التأكيد.',
            409
          );
        }
        if (forceWithActiveChildren && Number(activeChildren.rows[0]?.c || 0) > 0) {
          await txQuery(
            client,
            `UPDATE accounts.chart_of_accounts
             SET is_active = FALSE, updated_by = $2, updated_at = NOW()
             WHERE parent_id = $1 AND is_active = TRUE`,
            [id, auth.user.id]
          );
        }
      }

      const result = await txQuery(
        client,
        `UPDATE accounts.chart_of_accounts
         SET is_active = $2, updated_by = $3, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, nextActive, auth.user.id]
      );

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'chart_account.toggle_status',
        entityType: 'chart_account',
        entityId: id,
        oldValues: current,
        newValues: result.rows[0],
        description: `${nextActive ? 'تفعيل' : 'تعطيل'} حساب ${current.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({
      data: updated,
      message: updated.is_active ? 'تم تفعيل الحساب' : 'تم تعطيل الحساب',
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
