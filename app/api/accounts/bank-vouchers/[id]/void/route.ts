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
  loadBankVoucher,
  serializeBankVoucher,
  voidBankVoucher,
} from '@/src/lib/accounts/bank-vouchers';
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
      const before = await loadBankVoucher(client, id);
      const result = await voidBankVoucher(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        reason: body.reason,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_voucher.voided',
        entityType: 'bank_voucher',
        entityId: result.id,
        oldValues: serializeBankVoucher(before),
        newValues: {
          ...serializeBankVoucher(result),
          void_reason: result.void_reason,
          reversal_journal_entry_id: result.reversal_journal_entry_id,
        },
        description: `إلغاء السند المصرفي ${result.voucher_number}`,
      });
      return result;
    });

    return jsonSuccess({ data: serializeBankVoucher(voided) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
