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
  closeCashSession,
  serializeCashSession,
} from '@/src/lib/accounts/cash-box-sessions';
import {
  acquireCashBoxesLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const session = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const closed = await closeCashSession(client, {
        sessionId: id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_session.closed',
        entityType: 'cash_box_session',
        entityId: closed.id,
        newValues: {
          ...serializeCashSession(closed),
          final_book_balance: closed.final_book_balance,
          final_counted_amount: closed.final_counted_amount,
          final_variance_amount: closed.final_variance_amount,
        },
        description: 'إغلاق جلسة الصندوق نهائياً',
      });
      return closed;
    });

    return jsonSuccess({ data: serializeCashSession(session) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
