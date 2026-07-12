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
  cancelCashTransfer,
  serializeCashTransfer,
} from '@/src/lib/accounts/cash-transfers';
import {
  acquireCashBoxesLock,
  acquireJournalEntriesLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const cancelled = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      const row = await cancelCashTransfer(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        reason: body.reason ?? body.cancellation_reason,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_transfer.cancelled',
        entityType: 'cash_transfer',
        entityId: row.id,
        newValues: serializeCashTransfer(row),
        description: `إلغاء تحويل ${row.transfer_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeCashTransfer(cancelled) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
