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
import { createDefaultSequencesForYear } from '@/src/lib/accounts/document-sequences';
import {
  assertNoYearOverlap,
  buildTwelveMonthlyPeriods,
  normalizeCode,
  toDateOnly,
} from '@/src/lib/accounts/fiscal';
import {
  acquireFiscalPeriodsLock,
  acquireFiscalYearsLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const result = await query(
      `SELECT
         fy.id, fy.code, fy.name_ar, fy.name_en,
         fy.start_date::text AS start_date,
         fy.end_date::text AS end_date,
         fy.status, fy.is_default, fy.notes,
         fy.created_by, fy.updated_by, fy.closed_by,
         fy.created_at, fy.updated_at, fy.closed_at,
         (SELECT COUNT(*)::int FROM accounts.fiscal_periods fp WHERE fp.fiscal_year_id = fy.id) AS periods_count
       FROM accounts.fiscal_years fy
       ORDER BY fy.start_date DESC`
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
    const code = normalizeCode(String(body.code || ''));
    const nameAr = String(body.name_ar || '').trim();
    const nameEn = body.name_en ? String(body.name_en).trim() : null;
    const startDate = toDateOnly(String(body.start_date || ''));
    const endDate = toDateOnly(String(body.end_date || ''));
    const notes = body.notes ? String(body.notes).trim() : null;
    const createMonthlyPeriods = Boolean(body.create_monthly_periods);

    if (!code || !nameAr || !body.start_date || !body.end_date) {
      return jsonError('رمز السنة والاسم والتواريخ مطلوبة', 400);
    }
    if (startDate >= endDate) {
      return jsonError('تاريخ البداية يجب أن يكون قبل تاريخ النهاية', 400);
    }

    const monthlyPlans = createMonthlyPeriods
      ? buildTwelveMonthlyPeriods(startDate, endDate)
      : [];

    const created = await withTransaction(async (client) => {
      await acquireFiscalYearsLock(client);
      await assertNoYearOverlap(client, startDate, endDate);

      const yearRes = await txQuery(
        client,
        `INSERT INTO accounts.fiscal_years
          (code, name_ar, name_en, start_date, end_date, status, is_default, notes, created_by, updated_by)
         VALUES ($1, $2, $3, $4::date, $5::date, 'DRAFT', FALSE, $6, $7, $7)
         RETURNING *`,
        [code, nameAr, nameEn, startDate, endDate, notes, auth.user.id]
      );
      const year = yearRes.rows[0];

      await createDefaultSequencesForYear(client, year.id);

      if (monthlyPlans.length > 0) {
        await acquireFiscalPeriodsLock(client, year.id);
        for (const plan of monthlyPlans) {
          await txQuery(
            client,
            `INSERT INTO accounts.fiscal_periods
              (fiscal_year_id, period_number, code, name_ar, name_en, start_date, end_date, status, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, 'OPEN', $8, $8)`,
            [
              year.id,
              plan.period_number,
              plan.code,
              plan.name_ar,
              plan.name_en,
              plan.start_date,
              plan.end_date,
              auth.user.id,
            ]
          );
        }
      }

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'fiscal_year.create',
        entityType: 'fiscal_year',
        entityId: year.id,
        newValues: {
          ...year,
          create_monthly_periods: createMonthlyPeriods,
          periods_created: monthlyPlans.length,
        },
        description: `إنشاء سنة مالية ${code}${createMonthlyPeriods ? ' مع 12 فترة شهرية' : ''}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return year;
    });

    return jsonSuccess({ data: created, message: 'تم إنشاء السنة المالية بنجاح' }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
