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
  loadBankTransfer,
  serializeBankTransfer,
  voidBankTransfer,
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

    const voided = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      await acquireJournalEntriesLock(client);
      const before = await loadBankTransfer(client, id);
      const result = await voidBankTransfer(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        reason: body.reason,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_transfer.voided',
        entityType: 'bank_transfer',
        entityId: result.id,
        oldValues: serializeBankTransfer(before),
        newValues: {
          ...serializeBankTransfer(result),
          void_reason: result.void_reason,
          reversal_journal_entry_id: result.reversal_journal_entry_id,
        },
        description: `إلغاء التحويل المصرفي ${result.transfer_number}`,
      });
      return result;
    });

    return jsonSuccess({ data: serializeBankTransfer(voided) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
