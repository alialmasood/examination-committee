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
  cancelClosingCashSession,
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
    const body = await request.json();

    const session = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const cancelled = await cancelClosingCashSession(client, {
        sessionId: id,
        userId: auth.user.id,
        reason: body.reason,
        version: body.version,
        updated_at: body.updated_at,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_session.closing_cancelled',
        entityType: 'cash_box_session',
        entityId: cancelled.id,
        newValues: {
          ...serializeCashSession(cancelled),
          cancel_closing_reason: cancelled.cancel_closing_reason,
        },
        description: 'إلغاء إغلاق جلسة الصندوق',
      });
      return cancelled;
    });

    return jsonSuccess({ data: serializeCashSession(session) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
