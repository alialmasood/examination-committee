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
import { setSheetStatus } from '@/src/lib/accounts/payroll-disbursement';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const detail = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.MANAGE_PERIODS);
      const result = await setSheetStatus(client, {
        sheetId: id,
        userId: auth.user.id,
        version: body.version,
        action: 'disburse',
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'payroll_disbursement.sheet_disbursed',
        entityType: 'payroll_disbursement_sheet',
        entityId: id,
        newValues: result.summary,
        description: `تأكيد صرف كشف ${result.sheet.category_label}`,
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
