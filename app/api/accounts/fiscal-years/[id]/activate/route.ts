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
import { assertFullPeriodCoverage } from '@/src/lib/accounts/fiscal';
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
      if (year.status !== 'DRAFT') {
        throw new AccountsHttpError('يمكن تفعيل السنة المالية فقط من حالة المسودة', 409);
      }

      await assertFullPeriodCoverage(client, id);

      const result = await txQuery(
        client,
        `UPDATE accounts.fiscal_years
         SET status = 'ACTIVE', updated_by = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, auth.user.id]
      );

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'fiscal_year.activate',
        entityType: 'fiscal_year',
        entityId: id,
        oldValues: year,
        newValues: result.rows[0],
        description: `تفعيل السنة المالية ${year.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({ data: updated, message: 'تم تفعيل السنة المالية' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
