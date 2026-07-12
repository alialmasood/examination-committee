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
  serializeCashVoucher,
  voidCashVoucher,
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

    const voided = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      await acquireJournalEntriesLock(client);
      const result = await voidCashVoucher(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        reason: body.reason,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_voucher.voided',
        entityType: 'cash_voucher',
        entityId: result.id,
        newValues: {
          ...serializeCashVoucher(result),
          void_reason: result.void_reason,
          reversal_journal_entry_id: result.reversal_journal_entry_id,
        },
        description: `إلغاء السند ${result.voucher_number}`,
      });
      return result;
    });

    return jsonSuccess({ data: serializeCashVoucher(voided) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
