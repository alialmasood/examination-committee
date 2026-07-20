import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { rejectPayrollRunReviewCore } from '@/src/lib/accounts/payroll-approval-core';
import {
  auditRejectionBlocked,
  auditRejectionFailed,
} from '@/src/lib/accounts/payroll-approval-audit';
import { normalizeApprovalRejectReason } from '@/src/lib/accounts/payroll-approval-idempotency';
import {
  buildRejectHttpSuccess,
  mapApprovalDecisionAccountsError,
  publicApprovalDecisionMessage,
} from '@/src/lib/accounts/payroll-approval-decision-http';
import { loadPayrollRun } from '@/src/lib/accounts/payroll-runs';
import { requirePayrollUuid } from '@/src/lib/accounts/payroll-validation';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

function jsonErr(code: string, message: string, status: number) {
  return jsonError(message, status, {
    ok: false,
    success: false,
    error: { code, message },
  });
}

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  const { id: rawId } = await context.params;
  let runId: string;
  try {
    runId = requirePayrollUuid(rawId, 'معرّف التشغيل');
  } catch {
    return jsonErr('INVALID_UUID', publicApprovalDecisionMessage('INVALID_UUID'), 400);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonErr('MALFORMED_JSON', publicApprovalDecisionMessage('MALFORMED_JSON'), 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonErr('MALFORMED_JSON', publicApprovalDecisionMessage('MALFORMED_JSON'), 400);
  }

  const idempotencyKey =
    body.idempotency_key == null ? '' : String(body.idempotency_key).trim();

  if (body.confirmation !== true) {
    return jsonErr(
      'MISSING_CONFIRMATION',
      publicApprovalDecisionMessage('MISSING_CONFIRMATION'),
      400
    );
  }
  if (body.version == null || body.version === '') {
    return jsonErr('INVALID_VERSION', publicApprovalDecisionMessage('INVALID_VERSION'), 400);
  }
  const versionNum = Number(body.version);
  if (!Number.isInteger(versionNum) || versionNum < 1) {
    return jsonErr('INVALID_VERSION', publicApprovalDecisionMessage('INVALID_VERSION'), 400);
  }
  if (body.updated_at == null || String(body.updated_at).trim() === '') {
    return jsonErr(
      'INVALID_UPDATED_AT',
      publicApprovalDecisionMessage('INVALID_UPDATED_AT'),
      400
    );
  }
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return jsonErr(
      'INVALID_IDEMPOTENCY_KEY',
      publicApprovalDecisionMessage('INVALID_IDEMPOTENCY_KEY'),
      400
    );
  }

  let normalizedReason = '';
  try {
    normalizedReason = normalizeApprovalRejectReason(body.reason);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const mapped = mapApprovalDecisionAccountsError(error, 'REJECT');
      return jsonErr(mapped.code, mapped.message, mapped.status);
    }
    return jsonErr(
      'INVALID_REJECTION_REASON',
      publicApprovalDecisionMessage('INVALID_REJECTION_REASON'),
      400
    );
  }

  try {
    const result = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.REJECT);
      return rejectPayrollRunReviewCore(client, {
        run_id: runId,
        version: body.version,
        updated_at: body.updated_at,
        userId: auth.user.id,
        idempotency_key: idempotencyKey,
        reason: body.reason,
      });
    });

    return jsonSuccess(buildRejectHttpSuccess(result, normalizedReason));
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const mapped = mapApprovalDecisionAccountsError(error, 'REJECT');
      if (mapped.status === 422 || mapped.status === 403) {
        try {
          await withTransaction(async (client) => {
            await loadPayrollRun(client, runId);
            await auditRejectionBlocked(client, {
              userId: auth.user.id,
              runId,
              reason_code: mapped.blockedReasonCode ?? mapped.code,
              message: mapped.message,
              idempotency_key: idempotencyKey,
              ip: auth.ipAddress,
              ua: auth.userAgent,
            });
          });
        } catch (auditErr) {
          console.error('فشل تدقيق رفض محظور (best-effort):', auditErr);
        }
      }
      return jsonErr(mapped.code, mapped.message, mapped.status);
    }

    console.error('خطأ تقني أثناء رفض مراجعة الرواتب:', error);
    try {
      await withTransaction(async (client) => {
        await auditRejectionFailed(client, {
          userId: auth.user.id,
          runId,
          idempotency_key: idempotencyKey,
          ip: auth.ipAddress,
          ua: auth.userAgent,
        });
      });
    } catch (auditErr) {
      console.error('فشل تدقيق رفض فاشل (best-effort):', auditErr);
    }
    return jsonErr(
      'TECHNICAL_FAILURE',
      publicApprovalDecisionMessage('TECHNICAL_FAILURE'),
      500
    );
  }
}
