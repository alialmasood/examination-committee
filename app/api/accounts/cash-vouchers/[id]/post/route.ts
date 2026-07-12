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
  postCashVoucher,
  serializeCashVoucher,
} from '@/src/lib/accounts/cash-vouchers';
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
      const posted = await postCashVoucher(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });
      if (posted.created) {
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'cash_voucher.posted',
          entityType: 'cash_voucher',
          entityId: posted.voucher.id,
          newValues: {
            ...serializeCashVoucher(posted.voucher),
            journal_entry_id: posted.voucher.journal_entry_id,
          },
          description: `ترحيل السند ${posted.voucher.voucher_number}`,
        });
      }
      return posted;
    });

    return jsonSuccess(
      { data: serializeCashVoucher(result.voucher), created: result.created },
      result.created ? 200 : 200
    );
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
