import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { serializePayrollPerson, setPayrollPersonStatus } from '@/src/lib/accounts/payroll-people';
import { requiredReason } from '@/src/lib/accounts/payroll-validation';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params; const body = await request.json().catch(() => ({}));
    const reason = requiredReason(body.reason, 'سبب إنهاء الخدمة');
    const row = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.MANAGE_PEOPLE);
      const updated = await setPayrollPersonStatus(client, { id, userId: auth.user.id, version: body.version, updated_at: body.updated_at, target: 'TERMINATED', reason });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_person.terminated', entityType: 'payroll_person', entityId: id, newValues: { ...serializePayrollPerson(updated), transition_reason: reason }, description: `إنهاء خدمة شخص رواتب ${updated.person_code} — السبب: ${reason}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return updated;
    });
    return jsonSuccess({ data: serializePayrollPerson(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
