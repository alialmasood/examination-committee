import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { submitPayrollRunForReviewCore } from '@/src/lib/accounts/payroll-approval-core';
import {
  auditSubmitReviewBlocked,
  auditSubmitReviewFailed,
} from '@/src/lib/accounts/payroll-approval-audit';
import { normalizeApprovalComment } from '@/src/lib/accounts/payroll-approval-idempotency';
import {
  buildSubmitReviewHttpSuccess,
  mapSubmitReviewAccountsError,
  publicSubmitReviewMessage,
} from '@/src/lib/accounts/payroll-submit-review-http';
import { loadPayrollRun } from '@/src/lib/accounts/payroll-runs';
import { requirePayrollUuid } from '@/src/lib/accounts/payroll-validation';
import { withTransaction, txQuery } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

function jsonSubmitError(code: string, message: string, status: number) {
  return jsonError(message, status, {
    ok: false,
    success: false,
    error: { code, message },
  });
}

async function loadSubmitterDisplay(
  userId: string
): Promise<{ id: string; display_name: string }> {
  const name = await withTransaction(async (client) => {
    const r = await txQuery<{ name: string | null }>(
      client,
      `SELECT COALESCE(full_name, username) AS name
       FROM student_affairs.users WHERE id=$1::uuid`,
      [userId]
    );
    return r.rows[0]?.name ? String(r.rows[0].name) : '';
  });
  return { id: userId, display_name: name };
}

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  const { id: rawId } = await context.params;
  let runId: string;
  try {
    runId = requirePayrollUuid(rawId, 'معرّف التشغيل');
  } catch {
    return jsonSubmitError(
      'INVALID_UUID',
      publicSubmitReviewMessage('INVALID_UUID'),
      400
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonSubmitError(
        'MALFORMED_JSON',
        publicSubmitReviewMessage('MALFORMED_JSON'),
        400
      );
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonSubmitError(
      'MALFORMED_JSON',
      publicSubmitReviewMessage('MALFORMED_JSON'),
      400
    );
  }

  const idempotencyKey =
    body.idempotency_key == null ? '' : String(body.idempotency_key).trim();

  if (body.confirmation !== true) {
    return jsonSubmitError(
      'MISSING_CONFIRMATION',
      publicSubmitReviewMessage('MISSING_CONFIRMATION'),
      400
    );
  }
  if (body.version == null || body.version === '') {
    return jsonSubmitError(
      'INVALID_VERSION',
      publicSubmitReviewMessage('INVALID_VERSION'),
      400
    );
  }
  const versionNum = Number(body.version);
  if (!Number.isInteger(versionNum) || versionNum < 1) {
    return jsonSubmitError(
      'INVALID_VERSION',
      publicSubmitReviewMessage('INVALID_VERSION'),
      400
    );
  }
  if (body.updated_at == null || String(body.updated_at).trim() === '') {
    return jsonSubmitError(
      'INVALID_UPDATED_AT',
      publicSubmitReviewMessage('INVALID_UPDATED_AT'),
      400
    );
  }
  if (!idempotencyKey) {
    return jsonSubmitError(
      'INVALID_IDEMPOTENCY_KEY',
      publicSubmitReviewMessage('INVALID_IDEMPOTENCY_KEY'),
      400
    );
  }
  if (idempotencyKey.length > 128) {
    return jsonSubmitError(
      'INVALID_IDEMPOTENCY_KEY',
      publicSubmitReviewMessage('INVALID_IDEMPOTENCY_KEY'),
      400
    );
  }

  let normalizedComment = '';
  try {
    normalizedComment = normalizeApprovalComment(body.comment);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const mapped = mapSubmitReviewAccountsError(error);
      return jsonSubmitError(mapped.code, mapped.message, mapped.status);
    }
    return jsonSubmitError(
      'INVALID_COMMENT',
      publicSubmitReviewMessage('INVALID_COMMENT'),
      400
    );
  }

  try {
    const result = await withTransaction(async (client) => {
      await assertPayrollCapability(
        client,
        auth.user.id,
        PAYROLL_CAPABILITIES.SUBMIT_REVIEW
      );
      return submitPayrollRunForReviewCore(client, {
        run_id: runId,
        version: body.version,
        updated_at: body.updated_at,
        userId: auth.user.id,
        idempotency_key: idempotencyKey,
        comment: body.comment,
      });
    });

    const submitter = await loadSubmitterDisplay(auth.user.id);
    const payload = buildSubmitReviewHttpSuccess(
      result,
      normalizedComment,
      submitter
    );
    return jsonSuccess(payload);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const mapped = mapSubmitReviewAccountsError(error);
      if (mapped.status === 422) {
        try {
          await withTransaction(async (client) => {
            await loadPayrollRun(client, runId);
            await auditSubmitReviewBlocked(client, {
              userId: auth.user.id,
              runId,
              reason_code: mapped.blockedReasonCode ?? mapped.code,
              message: mapped.message,
              idempotency_key: idempotencyKey,
              normalized_comment: normalizedComment || null,
              ip: auth.ipAddress,
              ua: auth.userAgent,
            });
          });
        } catch (auditErr) {
          console.error('فشل تدقيق إرسال مراجعة محظور (best-effort):', auditErr);
        }
      }
      return jsonSubmitError(mapped.code, mapped.message, mapped.status);
    }

    console.error('خطأ تقني أثناء إرسال الرواتب للمراجعة:', error);
    try {
      await withTransaction(async (client) => {
        await auditSubmitReviewFailed(client, {
          userId: auth.user.id,
          runId,
          idempotency_key: idempotencyKey,
          ip: auth.ipAddress,
          ua: auth.userAgent,
        });
      });
    } catch (auditErr) {
      console.error('فشل تدقيق إرسال مراجعة فاشل (best-effort):', auditErr);
    }
    return jsonSubmitError(
      'TECHNICAL_FAILURE',
      publicSubmitReviewMessage('TECHNICAL_FAILURE'),
      500
    );
  }
}
