import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { getPayrollRunPersonDetail } from '@/src/lib/accounts/payroll-calculation-results';
import { requirePayrollUuid } from '@/src/lib/accounts/payroll-validation';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string; runPersonId: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW_RUNS);
    const { id, runPersonId } = await context.params;
    requirePayrollUuid(id, 'معرّف التشغيل');
    requirePayrollUuid(runPersonId, 'معرّف شخص التشغيل');

    const data = await withTransaction((client) =>
      getPayrollRunPersonDetail(client, { runId: id, runPersonId })
    );

    return jsonSuccess({ data });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
