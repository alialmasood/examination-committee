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
  dispatchCashTransfer,
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
      const dispatched = await dispatchCashTransfer(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });
      if (dispatched.created) {
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'cash_transfer.dispatched',
          entityType: 'cash_transfer',
          entityId: dispatched.transfer.id,
          newValues: serializeCashTransfer(dispatched.transfer),
          description: `إرسال تحويل ${dispatched.transfer.transfer_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      }
      return dispatched;
    });

    return jsonSuccess({
      data: serializeCashTransfer(result.transfer),
      created: result.created,
      message: result.created
        ? 'تم إرسال التحويل وخُصم من رصيد الصندوق المرسل'
        : 'التحويل مُرسل مسبقاً',
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
