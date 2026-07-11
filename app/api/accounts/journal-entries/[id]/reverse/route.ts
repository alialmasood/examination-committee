import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { createReversalEntry, loadJournalEntry } from '@/src/lib/accounts/journal-entries';
import { assertJournalTransition } from '@/src/lib/accounts/journal-transitions';
import { toDateOnly } from '@/src/lib/accounts/fiscal';
import {
  acquireJournalEntriesLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { normalizeMoneyInput } from '@/src/lib/accounts/money';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();
    const reason = String(body.reason || '').trim();
    const reversalDate = body.reversal_date
      ? toDateOnly(String(body.reversal_date))
      : toDateOnly(new Date());

    if (!reason) return jsonError('سبب العكس مطلوب', 400);

    const reversal = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      const original = await loadJournalEntry(client, id, true);
      assertJournalTransition('reverse', original.status, reason);
      return createReversalEntry(client, {
        original,
        reversalDate,
        reason,
        userId: auth.user.id,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
    });

    return jsonSuccess(
      {
        data: {
          ...reversal,
          total_debit: normalizeMoneyInput(reversal.total_debit),
          total_credit: normalizeMoneyInput(reversal.total_credit),
        },
        message: 'تم إنشاء وترحيل القيد العكسي',
      },
      201
    );
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
