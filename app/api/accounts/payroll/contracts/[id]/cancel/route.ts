import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { serializePayrollContract, transitionPayrollContract } from '@/src/lib/accounts/payroll-contracts';
import { requiredReason } from '@/src/lib/accounts/payroll-validation';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params; const body = await request.json().catch(() => ({}));
    const reason = requiredReason(body.reason, 'سبب إلغاء العقد');
    const row = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.MANAGE_CONTRACTS);
      const updated = await transitionPayrollContract(client, { id, userId: auth.user.id, version: body.version, updated_at: body.updated_at, action: 'cancel', reason });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_contract.cancelled', entityType: 'payroll_contract', entityId: id, newValues: { ...serializePayrollContract(updated), transition_reason: reason }, description: `إلغاء عقد رواتب ${updated.contract_number} — السبب: ${reason}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return updated;
    });
    return jsonSuccess({ data: serializePayrollContract(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
