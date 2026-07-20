import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import {
  auditRecalculationBlocked,
  auditRecalculationFailed,
} from '@/src/lib/accounts/payroll-recalculate-audit';
import { recalculatePayrollRunCore } from '@/src/lib/accounts/payroll-recalculate-core';
import {
  buildRecalculateHttpSuccess,
  mapRecalcAccountsError,
  publicRecalcMessage,
} from '@/src/lib/accounts/payroll-recalculate-http';
import { normalizeRecalculateReason } from '@/src/lib/accounts/payroll-recalculate-idempotency';
import { loadPayrollRun } from '@/src/lib/accounts/payroll-runs';
import { requirePayrollUuid } from '@/src/lib/accounts/payroll-validation';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

function jsonRecalcError(
  code: string,
  message: string,
  status: number
) {
  return jsonError(message, status, {
    ok: false,
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
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonRecalcError(
        'INVALID_UUID',
        publicRecalcMessage('INVALID_UUID'),
        400
      );
    }
    return jsonRecalcError(
      'INVALID_UUID',
      publicRecalcMessage('INVALID_UUID'),
      400
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonRecalcError(
        'MALFORMED_JSON',
        publicRecalcMessage('MALFORMED_JSON'),
        400
      );
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonRecalcError(
      'MALFORMED_JSON',
      publicRecalcMessage('MALFORMED_JSON'),
      400
    );
  }

  const idempotencyKey =
    body.idempotency_key == null ? '' : String(body.idempotency_key).trim();

  if (body.confirmation !== true) {
    return jsonRecalcError(
      'MISSING_CONFIRMATION',
      publicRecalcMessage('MISSING_CONFIRMATION'),
      400
    );
  }
  if (body.version == null || body.version === '') {
    return jsonRecalcError(
      'INVALID_VERSION',
      publicRecalcMessage('INVALID_VERSION'),
      400
    );
  }
  const versionNum = Number(body.version);
  if (!Number.isInteger(versionNum) || versionNum < 1) {
    return jsonRecalcError(
      'INVALID_VERSION',
      publicRecalcMessage('INVALID_VERSION'),
      400
    );
  }
  if (body.updated_at == null || String(body.updated_at).trim() === '') {
    return jsonRecalcError(
      'INVALID_UPDATED_AT',
      publicRecalcMessage('INVALID_UPDATED_AT'),
      400
    );
  }
  if (!idempotencyKey) {
    return jsonRecalcError(
      'INVALID_IDEMPOTENCY_KEY',
      publicRecalcMessage('INVALID_IDEMPOTENCY_KEY'),
      400
    );
  }
  if (idempotencyKey.length > 128) {
    return jsonRecalcError(
      'INVALID_IDEMPOTENCY_KEY',
      publicRecalcMessage('INVALID_IDEMPOTENCY_KEY'),
      400
    );
  }

  let normalizedReasonPreview = '';
  try {
    normalizedReasonPreview = normalizeRecalculateReason(body.reason);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const mapped = mapRecalcAccountsError(error);
      return jsonRecalcError(mapped.code, mapped.message, mapped.status);
    }
    return jsonRecalcError(
      'INVALID_REASON',
      publicRecalcMessage('INVALID_REASON'),
      400
    );
  }

  try {
    const result = await withTransaction(async (client) => {
      await assertPayrollCapability(
        client,
        auth.user.id,
        PAYROLL_CAPABILITIES.RECALCULATE
      );
      return recalculatePayrollRunCore(client, {
        run_id: runId,
        version: body.version,
        updated_at: body.updated_at,
        userId: auth.user.id,
        idempotency_key: idempotencyKey,
        reason: body.reason,
      });
    });

    const payload = buildRecalculateHttpSuccess(result, normalizedReasonPreview);
    return jsonSuccess(payload);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const mapped = mapRecalcAccountsError(error);
      if (mapped.status === 422) {
        try {
          await withTransaction(async (client) => {
            const run = await loadPayrollRun(client, runId);
            await auditRecalculationBlocked(client, {
              userId: auth.user.id,
              runId,
              reason_code: mapped.blockedReasonCode ?? mapped.code,
              message: mapped.message,
              periodId: run.payroll_period_id,
              idempotency_key: idempotencyKey,
              normalized_reason: normalizedReasonPreview || undefined,
              ip: auth.ipAddress,
              ua: auth.userAgent,
            });
          });
        } catch (auditErr) {
          console.error('فشل تدقيق إعادة احتساب محظور (best-effort):', auditErr);
        }
      }
      return jsonRecalcError(mapped.code, mapped.message, mapped.status);
    }

    console.error('خطأ تقني أثناء إعادة احتساب الرواتب:', error);
    try {
      await withTransaction(async (client) => {
        await auditRecalculationFailed(client, {
          userId: auth.user.id,
          runId,
          idempotency_key: idempotencyKey,
          ip: auth.ipAddress,
          ua: auth.userAgent,
        });
      });
    } catch (auditErr) {
      console.error('فشل تدقيق إعادة احتساب فاشل (best-effort):', auditErr);
    }
    return jsonRecalcError(
      'TECHNICAL_FAILURE',
      publicRecalcMessage('TECHNICAL_FAILURE'),
      500
    );
  }
}
