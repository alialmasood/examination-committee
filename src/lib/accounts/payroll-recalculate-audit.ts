/**
 * تدقيق إعادة احتساب الرواتب — أحداث محظورة/فاشلة خارج Tx النواة (9.A.2.4.2).
 * النجاح (recalculated) داخل recalculatePayrollRunCore فقط — لا تكرار من Route.
 */
import { writeFinancialAudit } from './audit';
import { maskIdempotencyKey } from './payroll-calculation-audit';
import type { TxClient } from './with-transaction';

export type RecalculationBlockedAudit = {
  userId: string;
  runId: string;
  reason_code: string;
  message: string;
  periodId?: string;
  idempotency_key?: string;
  normalized_reason?: string;
  ip?: string;
  ua?: string;
};

export type RecalculationFailedAudit = {
  userId: string;
  runId: string;
  message?: string;
  idempotency_key?: string;
  ip?: string;
  ua?: string;
};

/** 422 — إعادة احتساب مرفوضة قبل المسح (عملة، قائمة فارغة، …). */
export async function auditRecalculationBlocked(
  client: TxClient,
  input: RecalculationBlockedAudit
): Promise<void> {
  const maskedKey =
    input.idempotency_key != null && String(input.idempotency_key).trim() !== ''
      ? maskIdempotencyKey(String(input.idempotency_key))
      : undefined;
  await writeFinancialAudit(client, {
    userId: input.userId,
    action: 'payroll_run.recalculation_blocked',
    entityType: 'payroll_run',
    entityId: input.runId,
    newValues: {
      source_action: 'RECALCULATE',
      reason_code: String(input.reason_code).slice(0, 60),
      payroll_period_id: input.periodId ?? null,
      idempotency_key_masked: maskedKey ?? null,
      reason:
        input.normalized_reason != null
          ? String(input.normalized_reason).slice(0, 500)
          : null,
    },
    description: String(input.message).slice(0, 500),
    ipAddress: input.ip,
    userAgent: input.ua,
  });
}

/** 500 — فشل تقني؛ اللقطة السابقة محفوظة. */
export async function auditRecalculationFailed(
  client: TxClient,
  input: RecalculationFailedAudit
): Promise<void> {
  const maskedKey =
    input.idempotency_key != null && String(input.idempotency_key).trim() !== ''
      ? maskIdempotencyKey(String(input.idempotency_key))
      : undefined;
  const description =
    input.message?.trim() ||
    'حدث خطأ تقني أثناء إعادة احتساب الرواتب. بقيت النتائج السابقة محفوظة دون تغيير.';
  await writeFinancialAudit(client, {
    userId: input.userId,
    action: 'payroll_run.recalculation_failed',
    entityType: 'payroll_run',
    entityId: input.runId,
    newValues: {
      source_action: 'RECALCULATE',
      error_code: 'RECALC_TECHNICAL_FAILURE',
      idempotency_key_masked: maskedKey ?? null,
    },
    description: description.slice(0, 500),
    ipAddress: input.ip,
    userAgent: input.ua,
  });
}
