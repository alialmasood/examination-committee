import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { listPayrollRunPeople } from '@/src/lib/accounts/payroll-calculation-results';
import { requirePayrollUuid } from '@/src/lib/accounts/payroll-validation';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW_RUNS);
    const { id } = await context.params;
    requirePayrollUuid(id, 'معرّف التشغيل');

    const sp = request.nextUrl.searchParams;
    const result = await withTransaction((client) =>
      listPayrollRunPeople(client, {
        runId: id,
        page: Math.max(1, Number(sp.get('page') || 1)),
        pageSize: Math.min(100, Math.max(1, Number(sp.get('page_size') || 20))),
        status: sp.get('status')?.trim() || undefined,
        search: sp.get('search')?.trim() || undefined,
      })
    );

    return jsonSuccess({ data: result });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
