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
import { getPostedAdjustmentForCount } from '@/src/lib/accounts/cash-count-adjustments';
import {
  closeCashSession,
  serializeCashSession,
} from '@/src/lib/accounts/cash-box-sessions';
import {
  acquireCashBoxesLock,
  txQuery,
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
      const before = await txQuery<{ current_count_id: string | null }>(
        client,
        `SELECT current_count_id FROM accounts.cash_box_sessions WHERE id = $1::uuid`,
        [id]
      );
      const countIdBefore = before.rows[0]?.current_count_id ?? null;

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

      if (countIdBefore) {
        const adj = await getPostedAdjustmentForCount(client, countIdBefore);
        if (adj) {
          await writeFinancialAudit(client, {
            userId: auth.user.id,
            action: 'cash_session.closed_after_adjustment',
            entityType: 'cash_box_session',
            entityId: closed.id,
            newValues: {
              adjustment_id: adj.id,
              journal_entry_id: adj.journal_entry_id,
              direction: adj.direction,
              variance_amount: adj.variance_amount,
            },
            description: 'إغلاق الجلسة بعد تسوية فرق الجرد',
          });
        }
      }

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
