import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { cancelPayrollPeriod, serializePayrollPeriod } from '@/src/lib/accounts/payroll-periods';
import { requiredReason } from '@/src/lib/accounts/payroll-validation';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params; const body = await request.json().catch(() => ({}));
    const reason = requiredReason(body.reason, 'سبب إلغاء الفترة');
    const row = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.MANAGE_PERIODS);
      const updated = await cancelPayrollPeriod(client, { id, userId: auth.user.id, version: body.version, updated_at: body.updated_at, reason });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_period.cancelled', entityType: 'payroll_period', entityId: id, newValues: { ...serializePayrollPeriod(updated), transition_reason: reason }, description: `إلغاء فترة رواتب ${updated.period_code} — السبب: ${reason}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return updated;
    });
    return jsonSuccess({ data: serializePayrollPeriod(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
