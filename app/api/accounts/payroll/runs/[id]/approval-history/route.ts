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
import { listPayrollRunApprovalHistory } from '@/src/lib/accounts/payroll-approval-history';
import { loadPayrollRun, serializePayrollRun } from '@/src/lib/accounts/payroll-runs';
import { requirePayrollUuid } from '@/src/lib/accounts/payroll-validation';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertPayrollCapability(
      null,
      auth.user.id,
      PAYROLL_CAPABILITIES.VIEW_APPROVAL_HISTORY
    );
    const { id: rawId } = await context.params;
    const runId = requirePayrollUuid(rawId, 'معرّف التشغيل');
    const url = new URL(request.url);
    const page = url.searchParams.get('page') ?? '1';
    const pageSize = url.searchParams.get('page_size') ?? '20';

    const payload = await withTransaction(async (client) => {
      // VISIBILITY: تحميل التشغيل أولاً — غير موجود ⇒ 404 موحّد
      const run = await loadPayrollRun(client, runId);
      const history = await listPayrollRunApprovalHistory(client, runId, {
        page,
        page_size: pageSize,
      });
      const runSummary = {
        id: run.id,
        status: run.status,
        approval_cycle: Number(run.approval_cycle ?? 0),
        run_number: serializePayrollRun(run).run_number,
      };
      return {
        ok: true,
        run: runSummary,
        history,
        data: { run: runSummary, history },
      };
    });

    return jsonSuccess(payload);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      if (error.status === 404) {
        return jsonError(
          'تعذر العثور على تشغيل الرواتب أو لا تملك صلاحية الوصول إليه',
          404,
          {
            ok: false,
            success: false,
            error: {
              code: 'PAYROLL_RUN_NOT_FOUND',
              message:
                'تعذر العثور على تشغيل الرواتب أو لا تملك صلاحية الوصول إليه',
            },
          }
        );
      }
      if (error.status === 403) {
        return jsonError(error.message, 403, {
          ok: false,
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'ليس لديك صلاحية عرض سجل مراجعة واعتماد الرواتب',
          },
        });
      }
      if (error.status === 400) {
        return jsonError(error.message, 400, {
          ok: false,
          success: false,
          error: {
            code: 'INVALID_PAGINATION',
            message: error.message,
          },
        });
      }
      return jsonError(error.message, error.status, {
        ok: false,
        success: false,
        error: { code: 'ERROR', message: error.message },
      });
    }
    return mapPgError(error);
  }
}
