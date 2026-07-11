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
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const fiscalYearId = request.nextUrl.searchParams.get('fiscal_year_id');
    if (!fiscalYearId) {
      return jsonError('معرف السنة المالية مطلوب', 400);
    }

    const result = await query(
      `SELECT id, fiscal_year_id, period_number, code, name_ar, name_en,
              start_date::text AS start_date, end_date::text AS end_date,
              status, created_by, updated_by, closed_by, locked_by,
              created_at, updated_at, closed_at, locked_at
       FROM accounts.fiscal_periods
       WHERE fiscal_year_id = $1
       ORDER BY period_number ASC`,
      [fiscalYearId]
    );
    return jsonSuccess({ data: result.rows });
  } catch (error) {
    return mapPgError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const body = await request.json();
    const fiscalYearId = String(body.fiscal_year_id || '');
    const code = normalizeCode(String(body.code || ''));
    const nameAr = String(body.name_ar || '').trim();
    const nameEn = body.name_en ? String(body.name_en).trim() : null;
    const startDate = toDateOnly(String(body.start_date || ''));
    const endDate = toDateOnly(String(body.end_date || ''));
    const periodNumber = Number(body.period_number);

    if (!fiscalYearId || !code || !nameAr || !body.start_date || !body.end_date || !periodNumber) {
      return jsonError('جميع حقول الفترة الأساسية مطلوبة', 400);
    }
    if (!Number.isInteger(periodNumber) || periodNumber < 1) {
      return jsonError('رقم الفترة غير صالح', 400);
    }
    if (startDate >= endDate) {
      return jsonError('تاريخ بداية الفترة يجب أن يكون قبل نهايتها', 400);
    }

    const created = await withTransaction(async (client) => {
      await acquireFiscalPeriodsLock(client, fiscalYearId);
      const year = await assertPeriodInsideYear(client, fiscalYearId, startDate, endDate);

      if (year.status === 'CLOSED') {
        throw new AccountsHttpError('لا يمكن إضافة فترة لسنة مالية مغلقة', 409);
      }

      await assertNoPeriodOverlap(client, fiscalYearId, startDate, endDate);

      const result = await txQuery(
        client,
        `INSERT INTO accounts.fiscal_periods
          (fiscal_year_id, period_number, code, name_ar, name_en, start_date, end_date, status, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, 'OPEN', $8, $8)
         RETURNING *`,
        [fiscalYearId, periodNumber, code, nameAr, nameEn, startDate, endDate, auth.user.id]
      );

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'fiscal_period.create',
        entityType: 'fiscal_period',
        entityId: result.rows[0].id,
        newValues: result.rows[0],
        description: `إنشاء فترة محاسبية ${code} للسنة ${year.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({ data: created, message: 'تم إنشاء الفترة المحاسبية' }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
