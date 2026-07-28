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
import { getSheetDetail, saveSheetLines } from '@/src/lib/accounts/payroll-disbursement';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW);
    const { id } = await context.params;
    const detail = await withTransaction((client) => getSheetDetail(client, id));
    return jsonSuccess({ data: detail });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params;
    const body = await request.json();
    const detail = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.MANAGE_PERIODS);
      const result = await saveSheetLines(client, {
        sheetId: id,
        userId: auth.user.id,
        version: body.version,
        lecturer_hour_rate: body.lecturer_hour_rate,
        lines: Array.isArray(body.lines) ? body.lines : [],
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'payroll_disbursement.sheet_saved',
        entityType: 'payroll_disbursement_sheet',
        entityId: id,
        newValues: result.summary,
        description: `حفظ كشف صرف ${result.sheet.category_label}`,
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
