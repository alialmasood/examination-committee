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
  assertCashBoxOptimisticConcurrency,
} from '@/src/lib/accounts/cash-box-concurrency';
import {
  assignPrimaryCustodian,
  endCustodianAssignment,
  listCashBoxCustodians,
} from '@/src/lib/accounts/cash-box-custodians';
import {
  acquireCashBoxesLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { loadCashBox, serializeCashBox } from '@/src/lib/accounts/cash-boxes';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const activeOnly = request.nextUrl.searchParams.get('active_only') === 'true';
    const data = await withTransaction(async (client) => {
      await loadCashBox(client, id);
      return listCashBoxCustodians(client, id, activeOnly);
    });
    return jsonSuccess({ data });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}

/**
 * PUT body:
 * - تعيين أمين أساسي: { user_id, role?, notes?, version, updated_at }
 * - إنهاء تعيين: { end_custodian_id, version, updated_at }
 */
export async function PUT(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const result = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const box = await loadCashBox(client, id, true);
      assertCashBoxOptimisticConcurrency({
        currentVersion: box.version,
        currentUpdatedAt: box.updated_at,
        expectedVersion: body.version,
        expectedUpdatedAt: body.updated_at,
      });

      if (body.end_custodian_id) {
        const ended = await endCustodianAssignment(client, {
          cashBoxId: id,
          custodianId: String(body.end_custodian_id),
          endedBy: auth.user.id,
        });
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'cash_box.custodian_removed',
          entityType: 'cash_box_custodian',
          entityId: ended.id,
          oldValues: ended,
          description: `إنهاء تعيين أمين للصندوق ${box.code}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
        // bump box concurrency token
        await txQuery(
          client,
          `UPDATE accounts.cash_boxes
           SET version = version + 1, updated_by = $2::uuid, updated_at = NOW()
           WHERE id = $1::uuid`,
          [id, auth.user.id]
        );
        return {
          action: 'removed' as const,
          custodian: ended,
          custodians: await listCashBoxCustodians(client, id, false),
          box: serializeCashBox(await loadCashBox(client, id)),
        };
      }

      if (!body.user_id) {
        throw new AccountsHttpError('معرف المستخدم مطلوب لتعيين الأمين', 400);
      }

      const assigned = await assignPrimaryCustodian(client, {
        cashBoxId: id,
        userId: String(body.user_id),
        role: body.role,
        notes: body.notes,
        createdBy: auth.user.id,
      });

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_box.custodian_assigned',
        entityType: 'cash_box_custodian',
        entityId: assigned.id,
        newValues: assigned,
        description: `تعيين أمين أساسي للصندوق ${box.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      await txQuery(
        client,
        `UPDATE accounts.cash_boxes
         SET version = version + 1, updated_by = $2::uuid, updated_at = NOW()
         WHERE id = $1::uuid`,
        [id, auth.user.id]
      );

      return {
        action: 'assigned' as const,
        custodian: assigned,
        custodians: await listCashBoxCustodians(client, id, false),
        box: serializeCashBox(await loadCashBox(client, id)),
      };
    });

    return jsonSuccess({ data: result });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
