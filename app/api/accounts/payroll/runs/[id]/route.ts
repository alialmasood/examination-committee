import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { loadPayrollRun, serializePayrollRun, updatePayrollRun } from '@/src/lib/accounts/payroll-runs';
import { listScopeMembers, serializeScopeMember } from '@/src/lib/accounts/payroll-run-scope';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW_RUNS);
    const { id } = await context.params;
    const data = await withTransaction(async (client) => {
      const row = await loadPayrollRun(client, id);
      const members = row.scope_type === 'PERSON_LIST' ? await listScopeMembers(client, id) : [];
      return { run: serializePayrollRun(row), scope_members: members.map(serializeScopeMember) };
    });
    return jsonSuccess({ data });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params; const body = await request.json();
    const row = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.CREATE_RUNS);
      const before = await loadPayrollRun(client, id);
      const updated = await updatePayrollRun(client, { id, userId: auth.user.id, ...body });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_run.updated', entityType: 'payroll_run', entityId: id, oldValues: serializePayrollRun(before), newValues: serializePayrollRun(updated), description: `تعديل تشغيل رواتب ${updated.run_number}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return updated;
    });
    return jsonSuccess({ data: serializePayrollRun(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
