import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
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

    const updated = await withTransaction(async (client) => {
      const existing = await txQuery(client, `SELECT * FROM accounts.fiscal_periods WHERE id = $1`, [id]);
      if (existing.rows.length === 0) throw new AccountsHttpError('الفترة المحاسبية غير موجودة', 404);
      const period = existing.rows[0];

      await acquireFiscalPeriodsLock(client, period.fiscal_year_id);

      if (period.status === 'LOCKED') {
        throw new AccountsHttpError('لا يمكن فتح فترة مقفلة من المسار الاعتيادي', 409);
      }
      if (period.status === 'CLOSED') {
        throw new AccountsHttpError(
          'لإعادة فتح فترة مغلقة استخدم مسار إعادة الفتح مع ذكر السبب',
          409
        );
      }

      return period;
    });

    return jsonSuccess({ data: updated, message: 'الفترة مفتوحة بالفعل' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
