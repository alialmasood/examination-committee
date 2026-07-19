import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { createPayrollPeriod, listPayrollPeriods, serializePayrollPeriod } from '@/src/lib/accounts/payroll-periods';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW_RUNS);
    const sp = request.nextUrl.searchParams;
    const result = await withTransaction((client) => listPayrollPeriods(client, {
      q: sp.get('q')?.trim() || '',
      payroll_calendar_id: sp.get('payroll_calendar_id')?.trim() || '',
      status: sp.get('status')?.trim() || '',
      fiscal_year_id: sp.get('fiscal_year_id')?.trim() || '',
      page: Math.max(1, Number(sp.get('page') || 1)),
      page_size: Math.min(200, Math.max(1, Number(sp.get('page_size') || 50))),
    }));
    return jsonSuccess({
      data: result.rows.map(serializePayrollPeriod),
      pagination: { page: result.page, page_size: result.page_size, total: result.total, total_pages: Math.ceil(result.total / result.page_size) || 1 },
    });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    const body = await request.json();
    const row = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.MANAGE_PERIODS);
      const period = await createPayrollPeriod(client, { ...body, created_by: auth.user.id });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_period.created', entityType: 'payroll_period', entityId: period.id, newValues: serializePayrollPeriod(period), description: `إنشاء فترة رواتب ${period.period_code}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return period;
    });
    return jsonSuccess({ data: serializePayrollPeriod(row) }, 201);
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
