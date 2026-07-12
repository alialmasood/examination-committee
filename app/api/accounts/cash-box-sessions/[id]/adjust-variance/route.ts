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
  adjustCashCountVariance,
  serializeCashCountAdjustment,
} from '@/src/lib/accounts/cash-count-adjustments';
import { serializeCashSession } from '@/src/lib/accounts/cash-box-sessions';
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
      const settled = await adjustCashCountVariance(client, {
        sessionId: id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        notes: body.notes,
      });

      if (settled.created) {
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'cash_count_adjustment.created',
          entityType: 'cash_count_adjustment',
          entityId: settled.adjustment.id,
          newValues: serializeCashCountAdjustment(settled.adjustment),
          description: 'إنشاء تسوية فرق جرد',
        });
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'cash_count_adjustment.posted',
          entityType: 'cash_count_adjustment',
          entityId: settled.adjustment.id,
          newValues: {
            ...serializeCashCountAdjustment(settled.adjustment),
            journal_entry_id: settled.adjustment.journal_entry_id,
            cash_count_id: settled.count.id,
            session_id: settled.session.id,
            cash_box_id: settled.session.cash_box_id,
            direction: settled.adjustment.direction,
            variance_amount: settled.adjustment.variance_amount,
          },
          description: 'ترحيل قيد تسوية فرق الجرد',
        });
      }

      return settled;
    });

    return jsonSuccess(
      {
        data: {
          adjustment: serializeCashCountAdjustment(result.adjustment),
          session: serializeCashSession(result.session),
          created: result.created,
        },
      },
      result.created ? 201 : 200
    );
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
