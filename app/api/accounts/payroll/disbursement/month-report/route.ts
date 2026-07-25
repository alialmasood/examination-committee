import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { getMonthDisbursementDetail } from '@/src/lib/accounts/payroll-disbursement';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW);
    const fiscalYearId = request.nextUrl.searchParams.get('fiscal_year_id')?.trim() || '';
    const monthNumber = Number(request.nextUrl.searchParams.get('month_number'));
    if (!fiscalYearId) throw new AccountsHttpError('السنة المالية مطلوبة', 400);
    if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
      throw new AccountsHttpError('رقم الشهر غير صحيح', 400);
    }
    const data = await withTransaction((client) =>
      getMonthDisbursementDetail(client, fiscalYearId, monthNumber)
    );
    return jsonSuccess({ data });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
