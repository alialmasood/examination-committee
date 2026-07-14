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
  postBankTransfer,
  serializeBankTransfer,
} from '@/src/lib/accounts/bank-transfers';
import {
  acquireBanksLock,
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
      await acquireBanksLock(client);
      await acquireJournalEntriesLock(client);
      const posted = await postBankTransfer(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });
      if (posted.created) {
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'bank_transfer.posted',
          entityType: 'bank_transfer',
          entityId: posted.transfer.id,
          newValues: {
            ...serializeBankTransfer(posted.transfer),
            journal_entry_id: posted.transfer.journal_entry_id,
          },
          description: `ترحيل التحويل المصرفي ${posted.transfer.transfer_number}`,
        });
      }
      return posted;
    });

    return jsonSuccess({
      data: serializeBankTransfer(result.transfer),
      created: result.created,
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
