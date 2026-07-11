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
  acquireFiscalPeriodsLock,
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
    const forceFromOpen = Boolean(body.confirm_lock_from_open);

    const updated = await withTransaction(async (client) => {
      const existing = await txQuery(client, `SELECT * FROM accounts.fiscal_periods WHERE id = $1`, [id]);
      if (existing.rows.length === 0) throw new AccountsHttpError('الفترة المحاسبية غير موجودة', 404);
      const period = existing.rows[0];

      await acquireFiscalPeriodsLock(client, period.fiscal_year_id);

      if (period.status === 'LOCKED') {
        return period;
      }

      if (period.status === 'OPEN' && !forceFromOpen) {
        throw new AccountsHttpError(
          'يفضّل إغلاق الفترة أولاً قبل قفلها. للقفل المباشر أرسل confirm_lock_from_open=true',
          409
        );
      }

      const result = await txQuery(
        client,
        `UPDATE accounts.fiscal_periods
         SET status = 'LOCKED', locked_by = $2, locked_at = NOW(),
             closed_by = COALESCE(closed_by, $2),
             closed_at = COALESCE(closed_at, NOW()),
             updated_by = $2, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, auth.user.id]
      );

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'fiscal_period.lock',
        entityType: 'fiscal_period',
        entityId: id,
        oldValues: period,
        newValues: result.rows[0],
        description: `قفل الفترة المحاسبية ${period.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({ data: updated, message: 'تم قفل الفترة المحاسبية' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
