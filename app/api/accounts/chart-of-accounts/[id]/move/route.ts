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
  assertNoChartCycle,
  assertValidParentForChild,
  computeChartAccountLevel,
  loadChartAccount,
  nextSiblingSortOrder,
  recountChartSubtreeLevels,
} from '@/src/lib/accounts/chart-of-accounts';
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
    const body = await request.json();
    const newParentId =
      body.parent_id === undefined || body.parent_id === null || body.parent_id === ''
        ? null
        : String(body.parent_id);

    const updated = await withTransaction(async (client) => {
      await acquireChartOfAccountsLock(client);
      const current = await loadChartAccount(client, id, true);

      await assertNoChartCycle(client, id, newParentId);
      await assertValidParentForChild(client, newParentId, current.account_type_id);
      const level = await computeChartAccountLevel(client, newParentId);
      const sortOrder =
        body.sort_order != null
          ? Number(body.sort_order)
          : await nextSiblingSortOrder(client, newParentId);
      if (!Number.isInteger(sortOrder) || sortOrder < 1) {
        throw new AccountsHttpError('ترتيب العرض يجب أن يكون رقماً صحيحاً موجباً', 400);
      }

      const result = await txQuery(
        client,
        `UPDATE accounts.chart_of_accounts
         SET parent_id = $2, level = $3, sort_order = $4, updated_by = $5, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, newParentId, level, sortOrder, auth.user.id]
      );

      await recountChartSubtreeLevels(client, id, level);

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'chart_account.move',
        entityType: 'chart_account',
        entityId: id,
        oldValues: { parent_id: current.parent_id, level: current.level },
        newValues: { parent_id: newParentId, level },
        description: `نقل حساب ${current.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({ data: updated, message: 'تم نقل الحساب' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
