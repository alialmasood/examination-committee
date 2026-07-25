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
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { openOrCreateSheet } from '@/src/lib/accounts/payroll-disbursement';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

/** POST /api/accounts/payroll/disbursement/sheets — فتح/إنشاء كشف فئة لشهر */
export async function POST(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    const body = await request.json();
    const detail = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.MANAGE_PERIODS);
      const result = await openOrCreateSheet(client, {
        fiscal_year_id: String(body.fiscal_year_id || ''),
        month_number: Number(body.month_number),
        person_category: String(body.person_category || ''),
        userId: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'payroll_disbursement.sheet_opened',
        entityType: 'payroll_disbursement_sheet',
        entityId: result.sheet.id,
        newValues: result.sheet,
        description: `فتح كشف صرف ${result.sheet.category_label} — ${result.sheet.month_label} ${result.sheet.year_label}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return result;
    });
    return jsonSuccess({ data: detail });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
