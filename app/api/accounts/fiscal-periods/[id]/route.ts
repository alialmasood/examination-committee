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
  assertNoPeriodOverlap,
  assertPeriodInsideYear,
  normalizeCode,
  toDateOnly,
} from '@/src/lib/accounts/fiscal';
import {
  acquireFiscalPeriodsLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const result = await withTransaction(async (client) => {
      const res = await txQuery(client, `SELECT * FROM accounts.fiscal_periods WHERE id = $1`, [id]);
      if (res.rows.length === 0) throw new AccountsHttpError('الفترة المحاسبية غير موجودة', 404);
      return res.rows[0];
    });
    return jsonSuccess({ data: result });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}

export async function PUT(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const updated = await withTransaction(async (client) => {
      const existing = await txQuery(client, `SELECT * FROM accounts.fiscal_periods WHERE id = $1`, [id]);
      if (existing.rows.length === 0) throw new AccountsHttpError('الفترة المحاسبية غير موجودة', 404);
      const period = existing.rows[0];

      if (period.status === 'LOCKED') {
        throw new AccountsHttpError('لا يمكن تعديل فترة مقفلة', 409);
      }

      await acquireFiscalPeriodsLock(client, period.fiscal_year_id);

      const year = await txQuery(
        client,
        `SELECT status, code FROM accounts.fiscal_years WHERE id = $1`,
        [period.fiscal_year_id]
      );
      if (year.rows[0]?.status === 'CLOSED') {
        throw new AccountsHttpError('لا يمكن تعديل فترة ضمن سنة مغلقة', 409);
      }

      const code = body.code != null ? normalizeCode(String(body.code)) : period.code;
      const nameAr = body.name_ar != null ? String(body.name_ar).trim() : period.name_ar;
      const nameEn = body.name_en != null ? (body.name_en ? String(body.name_en).trim() : null) : period.name_en;
      const startDate = body.start_date != null ? toDateOnly(String(body.start_date)) : toDateOnly(period.start_date);
      const endDate = body.end_date != null ? toDateOnly(String(body.end_date)) : toDateOnly(period.end_date);
      const periodNumber = body.period_number != null ? Number(body.period_number) : period.period_number;

      if (!code || !nameAr || !Number.isInteger(periodNumber) || periodNumber < 1) {
        throw new AccountsHttpError('بيانات الفترة غير مكتملة أو غير صالحة', 400);
      }
      if (startDate >= endDate) {
        throw new AccountsHttpError('تاريخ بداية الفترة يجب أن يكون قبل نهايتها', 400);
      }

      await assertPeriodInsideYear(client, period.fiscal_year_id, startDate, endDate);
      await assertNoPeriodOverlap(client, period.fiscal_year_id, startDate, endDate, id);

      const result = await txQuery(
        client,
        `UPDATE accounts.fiscal_periods
         SET period_number = $2, code = $3, name_ar = $4, name_en = $5,
             start_date = $6::date, end_date = $7::date, updated_by = $8, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, periodNumber, code, nameAr, nameEn, startDate, endDate, auth.user.id]
      );

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'fiscal_period.update',
        entityType: 'fiscal_period',
        entityId: id,
        oldValues: period,
        newValues: result.rows[0],
        description: `تعديل الفترة المحاسبية ${code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({ data: updated, message: 'تم تحديث الفترة المحاسبية' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}

export async function DELETE(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;

    await withTransaction(async (client) => {
      const existing = await txQuery(client, `SELECT * FROM accounts.fiscal_periods WHERE id = $1`, [id]);
      if (existing.rows.length === 0) throw new AccountsHttpError('الفترة المحاسبية غير موجودة', 404);
      const period = existing.rows[0];

      if (period.status === 'LOCKED') {
        throw new AccountsHttpError('لا يمكن حذف فترة مقفلة', 409);
      }

      await acquireFiscalPeriodsLock(client, period.fiscal_year_id);

      const year = await txQuery(
        client,
        `SELECT status FROM accounts.fiscal_years WHERE id = $1`,
        [period.fiscal_year_id]
      );
      if (year.rows[0]?.status !== 'DRAFT') {
        throw new AccountsHttpError('يمكن حذف الفترة فقط إذا كانت السنة المالية في حالة مسودة', 409);
      }

      await txQuery(client, `DELETE FROM accounts.fiscal_periods WHERE id = $1`, [id]);

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'fiscal_period.delete',
        entityType: 'fiscal_period',
        entityId: id,
        oldValues: period,
        description: `حذف الفترة المحاسبية ${period.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
    });

    return jsonSuccess({ message: 'تم حذف الفترة المحاسبية' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
