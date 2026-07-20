import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { auditCalculationBlocked, auditCalculationFailed } from '@/src/lib/accounts/payroll-calculation-audit';
import { calculatePayrollRunCore } from '@/src/lib/accounts/payroll-calculation-engine';
import { loadPayrollRun, serializePayrollRun } from '@/src/lib/accounts/payroll-runs';
import { requirePayrollUuid } from '@/src/lib/accounts/payroll-validation';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

function pickRunResponse(run: ReturnType<typeof serializePayrollRun>) {
  return {
    id: run.id,
    status: run.status,
    version: run.version,
    updated_at: run.updated_at,
    people_count: run.people_count,
    error_count: run.error_count,
    warning_count: run.warning_count,
    gross_total: String(run.gross_total),
    deduction_total: String(run.deduction_total),
    employer_contribution_total: String(run.employer_contribution_total),
    net_total: String(run.net_total),
    snapshot_hash: run.snapshot_hash,
    calculated_at: run.calculated_at,
  };
}

function blockedReasonCode(message: string): string {
  if (message.includes('فارغة')) return 'EMPTY_PERSON_LIST';
  if (message.includes('عملة') || message.includes('IQD')) return 'UNSUPPORTED_CURRENCY';
  return 'PRECONDITION_FAILED';
}

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  const { id: rawId } = await context.params;
  let runId: string;
  try {
    runId = requirePayrollUuid(rawId, 'معرّف التشغيل');
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }

  const body = await request.json().catch(() => ({}));
  const idempotencyKey = body.idempotency_key == null ? '' : String(body.idempotency_key).trim();

  if (body.confirmation !== true) {
    return jsonError('يجب تأكيد طلب الاحتساب (confirmation: true)', 400);
  }
  if (body.version == null || body.version === '') {
    return jsonError('رقم الإصدار (version) مطلوب', 400);
  }
  if (body.updated_at == null || String(body.updated_at).trim() === '') {
    return jsonError('تاريخ التحديث (updated_at) مطلوب', 400);
  }
  if (!idempotencyKey) {
    return jsonError('مفتاح التكرار (idempotency_key) مطلوب', 400);
  }
  if (idempotencyKey.length > 128) {
    return jsonError('مفتاح التكرار طويل جداً', 400);
  }

  try {
    const result = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.CALCULATE);
      return calculatePayrollRunCore(client, {
        run_id: runId,
        version: body.version,
        updated_at: body.updated_at,
        userId: auth.user.id,
        idempotency_key: idempotencyKey,
      });
    });

    return jsonSuccess({
      ok: true,
      idempotent_replay: result.idempotent_replay,
      run: pickRunResponse(result.run),
      summary: {
        calculated_people: result.summary.calculated_people,
        error_people: result.summary.error_people,
        excluded_people: result.summary.excluded_people,
        blocking_issues: result.issues.blocking,
        warnings: result.issues.warnings,
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      if (error.status === 422) {
        try {
          await withTransaction(async (client) => {
            const run = await loadPayrollRun(client, runId);
            await auditCalculationBlocked(client, {
              userId: auth.user.id,
              runId,
              reason_code: blockedReasonCode(error.message),
              message: error.message,
              periodId: run.payroll_period_id,
              idempotency_key: idempotencyKey,
              ip: auth.ipAddress,
              ua: auth.userAgent,
            });
          });
        } catch (auditErr) {
          console.error('فشل تدقيق احتساب محظور (best-effort):', auditErr);
        }
        return jsonError(error.message, error.status);
      }
      return jsonError(error.message, error.status);
    }

    console.error('خطأ تقني أثناء احتساب الرواتب:', error);
    try {
      await withTransaction(async (client) => {
        await auditCalculationFailed(client, {
          userId: auth.user.id,
          runId,
          idempotency_key: idempotencyKey,
          ip: auth.ipAddress,
          ua: auth.userAgent,
        });
      });
    } catch (auditErr) {
      console.error('فشل تدقيق احتساب فاشل (best-effort):', auditErr);
    }
    return jsonError(
      'حدث خطأ تقني أثناء احتساب الرواتب. لم يتم حفظ نتائج جزئية.',
      500
    );
  }
}
