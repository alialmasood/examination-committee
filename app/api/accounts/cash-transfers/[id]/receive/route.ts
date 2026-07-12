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
  receiveCashTransfer,
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

    const result = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      const received = await receiveCashTransfer(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        destination_session_id: body.destination_session_id,
      });
      if (received.created) {
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'cash_transfer.received',
          entityType: 'cash_transfer',
          entityId: received.transfer.id,
          newValues: serializeCashTransfer(received.transfer),
          description: `استلام تحويل ${received.transfer.transfer_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      }
      return received;
    });

    return jsonSuccess({
      data: serializeCashTransfer(result.transfer),
      created: result.created,
      message: result.created
        ? 'تم تأكيد استلام التحويل وإضافته إلى رصيد الصندوق المستلم.'
        : 'التحويل مُستلم مسبقاً',
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
