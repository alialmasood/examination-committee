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
  acquireFiscalYearsLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;

    const updated = await withTransaction(async (client) => {
      await acquireFiscalYearsLock(client);
      const existing = await txQuery(client, `SELECT * FROM accounts.fiscal_years WHERE id = $1`, [id]);
      if (existing.rows.length === 0) {
        throw new AccountsHttpError('السنة المالية غير موجودة', 404);
      }
      const year = existing.rows[0];
      if (year.status !== 'ACTIVE') {
        throw new AccountsHttpError('يمكن إغلاق السنة المالية فقط وهي نشطة', 409);
      }

      const stillOpen = await txQuery(
        client,
        `SELECT code FROM accounts.fiscal_periods WHERE fiscal_year_id = $1 AND status = 'OPEN' LIMIT 5`,
        [id]
      );
      if (stillOpen.rows.length > 0) {
        throw new AccountsHttpError(
          `لا يمكن إغلاق السنة قبل إغلاق جميع فتراتها (مثال: ${stillOpen.rows.map((r) => r.code).join(', ')})`,
          409
        );
      }

      const result = await txQuery(
        client,
        `UPDATE accounts.fiscal_years
         SET status = 'CLOSED', is_default = FALSE, closed_by = $2, closed_at = NOW(),
             updated_by = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, auth.user.id]
      );

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'fiscal_year.close',
        entityType: 'fiscal_year',
        entityId: id,
        oldValues: year,
        newValues: result.rows[0],
        description: `إغلاق السنة المالية ${year.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({ data: updated, message: 'تم إغلاق السنة المالية' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
