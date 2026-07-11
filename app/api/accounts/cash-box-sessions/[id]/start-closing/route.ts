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
  serializeCashSession,
  startClosingCashSession,
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
      const updated = await startClosingCashSession(client, {
        sessionId: id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_session.closing_started',
        entityType: 'cash_box_session',
        entityId: updated.id,
        newValues: serializeCashSession(updated),
        description: 'بدء إغلاق جلسة الصندوق',
      });
      return updated;
    });

    return jsonSuccess({ data: serializeCashSession(session) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
