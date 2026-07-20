import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { listPayrollRunRecalculations } from '@/src/lib/accounts/payroll-recalculate-history';
import { loadPayrollRun } from '@/src/lib/accounts/payroll-runs';
import { requirePayrollUuid } from '@/src/lib/accounts/payroll-validation';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW_RUNS);
    const { id: rawId } = await context.params;
    const runId = requirePayrollUuid(rawId, 'معرّف التشغيل');
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('page_size') ?? '20');

    const data = await withTransaction(async (client) => {
      // VISIBILITY: تحميل التشغيل أولاً — غير موجود ⇒ 404 موحّد (لا كشف وجود)
      await loadPayrollRun(client, runId);
      return listPayrollRunRecalculations(client, runId, {
        page,
        page_size: pageSize,
      });
    });

    return jsonSuccess({ data });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      if (error.status === 404) {
        return jsonError(
          'تعذر العثور على تشغيل الرواتب أو لا تملك صلاحية الوصول إليه',
          404,
          {
            ok: false,
            error: {
              code: 'PAYROLL_RUN_NOT_FOUND',
              message:
                'تعذر العثور على تشغيل الرواتب أو لا تملك صلاحية الوصول إليه',
            },
          }
        );
      }
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
