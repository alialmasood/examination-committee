import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { loadPayrollPeriod, serializePayrollPeriod, updatePayrollPeriod } from '@/src/lib/accounts/payroll-periods';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW_RUNS);
    const { id } = await context.params;
    const row = await withTransaction((client) => loadPayrollPeriod(client, id));
    return jsonSuccess({ data: serializePayrollPeriod(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params; const body = await request.json();
    const row = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.MANAGE_PERIODS);
      const before = await loadPayrollPeriod(client, id);
      const updated = await updatePayrollPeriod(client, { id, userId: auth.user.id, ...body });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_period.updated', entityType: 'payroll_period', entityId: id, oldValues: serializePayrollPeriod(before), newValues: serializePayrollPeriod(updated), description: `تعديل فترة رواتب ${updated.period_code}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return updated;
    });
    return jsonSuccess({ data: serializePayrollPeriod(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
