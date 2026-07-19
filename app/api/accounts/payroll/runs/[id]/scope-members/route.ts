import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { serializePayrollRun } from '@/src/lib/accounts/payroll-runs';
import { addScopeMember, listScopeMembers, replaceScopeMembers, serializeScopeMember } from '@/src/lib/accounts/payroll-run-scope';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW_RUNS);
    const { id } = await context.params;
    const members = await withTransaction((client) => listScopeMembers(client, id));
    return jsonSuccess({ data: members.map(serializeScopeMember) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params; const body = await request.json();
    const result = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.CREATE_RUNS);
      const r = await addScopeMember(client, { runId: id, personId: body.payroll_person_id, userId: auth.user.id, version: body.version, updated_at: body.updated_at });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_run.scope_member_added', entityType: 'payroll_run', entityId: id, newValues: { payroll_person_id: body.payroll_person_id, members_count: r.members.length }, description: `إضافة عضو نطاق إلى تشغيل ${r.run.run_number}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return r;
    });
    return jsonSuccess({ data: { run: serializePayrollRun(result.run), scope_members: result.members.map(serializeScopeMember) } }, 201);
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}

export async function PUT(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params; const body = await request.json();
    const result = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.CREATE_RUNS);
      const r = await replaceScopeMembers(client, { runId: id, personIds: body.payroll_person_ids, userId: auth.user.id, version: body.version, updated_at: body.updated_at });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_run.scope_members_replaced', entityType: 'payroll_run', entityId: id, newValues: { members_count: r.members.length }, description: `استبدال أعضاء نطاق تشغيل ${r.run.run_number}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return r;
    });
    return jsonSuccess({ data: { run: serializePayrollRun(result.run), scope_members: result.members.map(serializeScopeMember) } });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
