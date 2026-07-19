import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { serializePayrollRun } from '@/src/lib/accounts/payroll-runs';
import { removeScopeMember, serializeScopeMember } from '@/src/lib/accounts/payroll-run-scope';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string; personId: string }> };

export async function DELETE(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id, personId } = await context.params;
    const sp = request.nextUrl.searchParams;
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const version = sp.get('version') ?? (body as Record<string, unknown>).version;
    const updated_at = sp.get('updated_at') ?? (body as Record<string, unknown>).updated_at;
    const result = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.CREATE_RUNS);
      const r = await removeScopeMember(client, { runId: id, personId, userId: auth.user.id, version, updated_at });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_run.scope_member_removed', entityType: 'payroll_run', entityId: id, newValues: { payroll_person_id: personId, members_count: r.members.length }, description: `إزالة عضو نطاق من تشغيل ${r.run.run_number}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return r;
    });
    return jsonSuccess({ data: { run: serializePayrollRun(result.run), scope_members: result.members.map(serializeScopeMember) } });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
