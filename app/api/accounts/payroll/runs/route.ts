import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { createPayrollRun, listPayrollRuns, serializePayrollRun } from '@/src/lib/accounts/payroll-runs';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW_RUNS);
    const sp = request.nextUrl.searchParams;
    const result = await withTransaction((client) => listPayrollRuns(client, {
      payroll_period_id: sp.get('payroll_period_id')?.trim() || '',
      status: sp.get('status')?.trim() || '',
      run_type: sp.get('run_type')?.trim() || '',
      scope_type: sp.get('scope_type')?.trim() || '',
      q: sp.get('q')?.trim() || '',
      page: Math.max(1, Number(sp.get('page') || 1)),
      page_size: Math.min(200, Math.max(1, Number(sp.get('page_size') || 50))),
    }));
    return jsonSuccess({
      data: result.rows.map(serializePayrollRun),
      pagination: { page: result.page, page_size: result.page_size, total: result.total, total_pages: Math.ceil(result.total / result.page_size) || 1 },
    });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    const body = await request.json();
    const row = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.CREATE_RUNS);
      const run = await createPayrollRun(client, { ...body, created_by: auth.user.id });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_run.created', entityType: 'payroll_run', entityId: run.id, newValues: serializePayrollRun(run), description: `إنشاء تشغيل رواتب ${run.run_number}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return run;
    });
    return jsonSuccess({ data: serializePayrollRun(row) }, 201);
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
