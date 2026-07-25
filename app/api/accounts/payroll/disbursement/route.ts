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
import {
  getYearDisbursementSummary,
  listDisbursementMonths,
  listFiscalYearsForDisbursement,
  listYearDisbursementReport,
} from '@/src/lib/accounts/payroll-disbursement';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW);
    const fiscalYearId = request.nextUrl.searchParams.get('fiscal_year_id')?.trim() || '';
    const report = request.nextUrl.searchParams.get('report') === '1';
    const data = await withTransaction(async (client) => {
      const years = await listFiscalYearsForDisbursement(client);
      const selected =
        years.find((y) => y.id === fiscalYearId) ||
        years.find((y) => y.is_default) ||
        years.find((y) => y.status === 'ACTIVE') ||
        years[0] ||
        null;
      if (!selected) {
        return {
          years,
          selected_year: null,
          months: [],
          year_summary: { sheets_count: 0, disbursed_sheets_count: 0, disbursed_amount: '0' },
          report_rows: [],
        };
      }
      const months = report ? [] : await listDisbursementMonths(client, selected.id);
      const year_summary = await getYearDisbursementSummary(client, selected.id);
      const report_rows = report ? await listYearDisbursementReport(client, selected.id) : [];
      return { years, selected_year: selected, months, year_summary, report_rows };
    });
    return jsonSuccess({ data });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
