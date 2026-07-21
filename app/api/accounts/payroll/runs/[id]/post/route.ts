import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { auditPostingBlocked, auditPostingFailed } from '@/src/lib/accounts/payroll-posting-audit';
import { postPayrollRunCore } from '@/src/lib/accounts/payroll-posting-core';
import {
  buildPostingHttpSuccess,
  mapPayrollPostingAccountsError,
  publicPostingMessage,
} from '@/src/lib/accounts/payroll-posting-http';
import { normalizePostingComment } from '@/src/lib/accounts/payroll-posting-idempotency';
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
    return jsonErr('INVALID_UUID', publicPostingMessage('INVALID_UUID'), 400);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonErr('MALFORMED_JSON', publicPostingMessage('MALFORMED_JSON'), 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonErr('MALFORMED_JSON', publicPostingMessage('MALFORMED_JSON'), 400);
  }

  const idempotencyKey =
    body.idempotency_key == null ? '' : String(body.idempotency_key).trim();

  if (body.confirmation !== true) {
    return jsonErr(
      'MISSING_CONFIRMATION',
      publicPostingMessage('MISSING_CONFIRMATION'),
      400
    );
  }
  if (body.version == null || body.version === '') {
    return jsonErr('INVALID_VERSION', publicPostingMessage('INVALID_VERSION'), 400);
  }
  const versionNum = Number(body.version);
  if (!Number.isInteger(versionNum) || versionNum < 1) {
    return jsonErr('INVALID_VERSION', publicPostingMessage('INVALID_VERSION'), 400);
  }
  if (body.updated_at == null || String(body.updated_at).trim() === '') {
    return jsonErr(
      'INVALID_UPDATED_AT',
      publicPostingMessage('INVALID_UPDATED_AT'),
      400
    );
  }
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return jsonErr(
      'INVALID_IDEMPOTENCY_KEY',
      publicPostingMessage('INVALID_IDEMPOTENCY_KEY'),
      400
    );
  }
  if (body.posting_date == null || String(body.posting_date).trim() === '') {
    return jsonErr(
      'INVALID_POSTING_DATE',
      publicPostingMessage('INVALID_POSTING_DATE'),
      400
    );
  }
  const postingDateRaw = String(body.posting_date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(postingDateRaw)) {
    return jsonErr(
      'INVALID_POSTING_DATE',
      publicPostingMessage('INVALID_POSTING_DATE'),
      400
    );
  }

  let normalizedComment = '';
  try {
    normalizedComment = normalizePostingComment(body.comment);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const mapped = mapPayrollPostingAccountsError(error);
      return jsonErr(mapped.code, mapped.message, mapped.status);
    }
    return jsonErr(
      'INVALID_POSTING_COMMENT',
      publicPostingMessage('INVALID_POSTING_COMMENT'),
      400
    );
  }

  try {
    const result = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.POST);
      // load للتأكد من الوجود قبل Core (visibility موحّدة 404)
      await loadPayrollRun(client, runId);
      return postPayrollRunCore(client, {
        runId,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        idempotency_key: idempotencyKey,
        posting_date: postingDateRaw,
        comment: body.comment,
        confirmation: true,
      });
    });

    const posted_by = await loadUserRef(result.run.posted_by ?? auth.user.id);
    return jsonSuccess(
      buildPostingHttpSuccess(result, normalizedComment || null, posted_by)
    );
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const mapped = mapPayrollPostingAccountsError(error);
      if (
        mapped.status === 422 ||
        mapped.status === 403 ||
        (mapped.status === 409 &&
          (mapped.blockedReasonCode === 'PAYROLL_RUN_NOT_APPROVED' ||
            mapped.blockedReasonCode === 'PAYROLL_ALREADY_POSTED' ||
            mapped.blockedReasonCode === 'FISCAL_PERIOD_NOT_OPEN' ||
            mapped.blockedReasonCode === 'PAYROLL_POSTING_CONFLICT'))
      ) {
        try {
          await withTransaction(async (client) => {
            try {
              await loadPayrollRun(client, runId);
            } catch {
              return;
            }
            await auditPostingBlocked(client, {
              userId: auth.user.id,
              runId,
              reason_code: mapped.blockedReasonCode ?? mapped.code,
              message: mapped.message,
              idempotency_key: idempotencyKey,
              comment: normalizedComment || null,
              ip: auth.ipAddress,
              ua: auth.userAgent,
            });
          });
        } catch (auditErr) {
          console.error('فشل تدقيق ترحيل محظور (best-effort):', auditErr);
        }
      }
      return jsonErr(mapped.code, mapped.message, mapped.status);
    }

    console.error('خطأ تقني أثناء ترحيل الرواتب:', error);
    try {
      await withTransaction(async (client) => {
        await auditPostingFailed(client, {
          userId: auth.user.id,
          runId,
          idempotency_key: idempotencyKey,
          ip: auth.ipAddress,
          ua: auth.userAgent,
        });
      });
    } catch (auditErr) {
      console.error('فشل تدقيق ترحيل فاشل (best-effort):', auditErr);
    }
    return jsonErr(
      'TECHNICAL_FAILURE',
      publicPostingMessage('TECHNICAL_FAILURE'),
      500
    );
  }
}
