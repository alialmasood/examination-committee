import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { approvePayrollRunCore } from '@/src/lib/accounts/payroll-approval-core';
import { auditApprovalBlocked, auditApprovalFailed } from '@/src/lib/accounts/payroll-approval-audit';
import { normalizeApprovalComment } from '@/src/lib/accounts/payroll-approval-idempotency';
import {
  buildApproveHttpSuccess,
  mapApprovalDecisionAccountsError,
  publicApprovalDecisionMessage,
} from '@/src/lib/accounts/payroll-approval-decision-http';
import { loadPayrollRun } from '@/src/lib/accounts/payroll-runs';
import { requirePayrollUuid } from '@/src/lib/accounts/payroll-validation';
import { withTransaction, txQuery } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

function jsonErr(code: string, message: string, status: number) {
  return jsonError(message, status, {
    ok: false,
    success: false,
    error: { code, message },
  });
}

async function loadUserRef(
  userId: string | null | undefined
): Promise<{ id: string; display_name: string } | null> {
  if (!userId) return null;
  const name = await withTransaction(async (client) => {
    const r = await txQuery<{ name: string | null }>(
      client,
      `SELECT COALESCE(full_name, username) AS name FROM student_affairs.users WHERE id=$1::uuid`,
      [userId]
    );
    return r.rows[0]?.name ? String(r.rows[0].name) : '';
  });
  return { id: String(userId), display_name: name };
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

  let normalizedComment = '';
  try {
    normalizedComment = normalizeApprovalComment(body.comment);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const mapped = mapApprovalDecisionAccountsError(error, 'APPROVE');
      return jsonErr(mapped.code, mapped.message, mapped.status);
    }
    return jsonErr(
      'INVALID_APPROVAL_COMMENT',
      publicApprovalDecisionMessage('INVALID_APPROVAL_COMMENT'),
      400
    );
  }

  try {
    const result = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.APPROVE);
      return approvePayrollRunCore(client, {
        run_id: runId,
        version: body.version,
        updated_at: body.updated_at,
        userId: auth.user.id,
        idempotency_key: idempotencyKey,
        comment: body.comment,
      });
    });

    const submitted_by = await loadUserRef(result.run.submitted_for_review_by);
    const approved_by = await loadUserRef(result.run.approved_by ?? auth.user.id);
    return jsonSuccess(
      buildApproveHttpSuccess(result, normalizedComment, { submitted_by, approved_by })
    );
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const mapped = mapApprovalDecisionAccountsError(error, 'APPROVE');
      if (mapped.status === 422 || mapped.status === 403) {
        try {
          await withTransaction(async (client) => {
            await loadPayrollRun(client, runId);
            await auditApprovalBlocked(client, {
              userId: auth.user.id,
              runId,
              operation: 'APPROVE',
              reason_code: mapped.blockedReasonCode ?? mapped.code,
              message: mapped.message,
              idempotency_key: idempotencyKey,
              ip: auth.ipAddress,
              ua: auth.userAgent,
            });
          });
        } catch (auditErr) {
          console.error('فشل تدقيق اعتماد محظور (best-effort):', auditErr);
        }
      }
      return jsonErr(mapped.code, mapped.message, mapped.status);
    }

    console.error('خطأ تقني أثناء اعتماد الرواتب:', error);
    try {
      await withTransaction(async (client) => {
        await auditApprovalFailed(client, {
          userId: auth.user.id,
          runId,
          operation: 'APPROVE',
          idempotency_key: idempotencyKey,
          ip: auth.ipAddress,
          ua: auth.userAgent,
        });
      });
    } catch (auditErr) {
      console.error('فشل تدقيق اعتماد فاشل (best-effort):', auditErr);
    }
    return jsonErr(
      'TECHNICAL_FAILURE',
      publicApprovalDecisionMessage('TECHNICAL_FAILURE'),
      500
    );
  }
}
