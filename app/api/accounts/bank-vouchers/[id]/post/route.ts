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
  postBankVoucher,
  serializeBankVoucher,
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

    const result = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      await acquireJournalEntriesLock(client);
      const posted = await postBankVoucher(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });
      if (posted.created) {
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'bank_voucher.posted',
          entityType: 'bank_voucher',
          entityId: posted.voucher.id,
          newValues: {
            ...serializeBankVoucher(posted.voucher),
            journal_entry_id: posted.voucher.journal_entry_id,
          },
          description: `ترحيل السند المصرفي ${posted.voucher.voucher_number}`,
        });
      }
      return posted;
    });

    return jsonSuccess({
      data: serializeBankVoucher(result.voucher),
      created: result.created,
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
