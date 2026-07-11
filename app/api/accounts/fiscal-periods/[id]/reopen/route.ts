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
    // مكان لاحق لفحص صلاحية تفصيلية: fiscal_periods.reopen
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const reason = String(body.reason || '').trim();

    if (!reason) {
      return jsonError('سبب إعادة فتح الفترة إلزامي', 400);
    }

    const updated = await withTransaction(async (client) => {
      const existing = await txQuery(client, `SELECT * FROM accounts.fiscal_periods WHERE id = $1`, [id]);
      if (existing.rows.length === 0) throw new AccountsHttpError('الفترة المحاسبية غير موجودة', 404);
      const period = existing.rows[0];

      await acquireFiscalPeriodsLock(client, period.fiscal_year_id);

      if (period.status === 'LOCKED') {
        throw new AccountsHttpError('لا يمكن إعادة فتح فترة مقفلة', 409);
      }
      if (period.status !== 'CLOSED') {
        throw new AccountsHttpError('يمكن إعادة الفتح فقط للفترة المغلقة', 409);
      }

      const year = await txQuery(
        client,
        `SELECT status FROM accounts.fiscal_years WHERE id = $1`,
        [period.fiscal_year_id]
      );
      if (year.rows[0]?.status === 'CLOSED') {
        throw new AccountsHttpError('لا يمكن إعادة فتح فترة ضمن سنة مالية مغلقة', 409);
      }

      const result = await txQuery(
        client,
        `UPDATE accounts.fiscal_periods
         SET status = 'OPEN', closed_by = NULL, closed_at = NULL, updated_by = $2, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, auth.user.id]
      );

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'fiscal_period.reopen',
        entityType: 'fiscal_period',
        entityId: id,
        oldValues: period,
        newValues: { ...result.rows[0], reopen_reason: reason },
        description: `إعادة فتح الفترة ${period.code}: ${reason}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({ data: updated, message: 'تمت إعادة فتح الفترة المحاسبية' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
