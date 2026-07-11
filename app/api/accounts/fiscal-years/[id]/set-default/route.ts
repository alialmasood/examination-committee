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
        throw new AccountsHttpError('السنة الافتراضية يجب أن تكون نشطة (ACTIVE) فقط', 409);
      }

      await txQuery(
        client,
        `UPDATE accounts.fiscal_years
         SET is_default = FALSE, updated_by = $1, updated_at = NOW()
         WHERE is_default = TRUE AND id <> $2`,
        [auth.user.id, id]
      );

      const result = await txQuery(
        client,
        `UPDATE accounts.fiscal_years
         SET is_default = TRUE, updated_by = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, auth.user.id]
      );

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'fiscal_year.set_default',
        entityType: 'fiscal_year',
        entityId: id,
        oldValues: year,
        newValues: result.rows[0],
        description: `تعيين السنة المالية ${year.code} كافتراضية`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({ data: updated, message: 'تم تعيين السنة الافتراضية' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
