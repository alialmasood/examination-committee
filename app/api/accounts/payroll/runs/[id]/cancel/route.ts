import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { cancelPayrollRun, serializePayrollRun } from '@/src/lib/accounts/payroll-runs';
import { requiredReason } from '@/src/lib/accounts/payroll-validation';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params; const body = await request.json().catch(() => ({}));
    const reason = requiredReason(body.reason, 'سبب إلغاء التشغيل');
    const row = await withTransaction(async (client) => {
      // إلغاء التشغيل مقصور على مدير الحسابات فقط
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.CANCEL_RUNS);
      const updated = await cancelPayrollRun(client, { id, userId: auth.user.id, version: body.version, updated_at: body.updated_at, reason });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_run.cancelled', entityType: 'payroll_run', entityId: id, newValues: { ...serializePayrollRun(updated), cancellation_reason: reason }, description: `إلغاء تشغيل رواتب ${updated.run_number} — السبب: ${reason}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return updated;
    });
    return jsonSuccess({ data: serializePayrollRun(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
