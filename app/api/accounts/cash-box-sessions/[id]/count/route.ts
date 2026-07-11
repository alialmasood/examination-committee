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
  recordCashCount,
  serializeCashCount,
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

    const result = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const recorded = await recordCashCount(client, {
        sessionId: id,
        userId: auth.user.id,
        counted_amount: body.counted_amount,
        notes: body.notes,
        version: body.version,
        updated_at: body.updated_at,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_session.count_recorded',
        entityType: 'cash_box_session',
        entityId: recorded.session.id,
        newValues: {
          session: serializeCashSession(recorded.session),
          count: serializeCashCount(recorded.count),
          book_balance_at_count: recorded.count.book_balance_at_count,
          counted_amount: recorded.count.counted_amount,
          variance_amount: recorded.count.variance_amount,
        },
        description: 'تسجيل جرد إغلاق للجلسة',
      });
      return recorded;
    });

    return jsonSuccess(
      {
        data: {
          session: serializeCashSession(result.session),
          count: serializeCashCount(result.count),
        },
      },
      201
    );
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
