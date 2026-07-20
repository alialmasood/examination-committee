/**
 * تدقيق احتساب الرواتب — أحداث محظورة/فاشلة خارج Tx النواة (9.A.2.3.2).
 *
 * STARTED و CALCULATED يُكتبان داخل calculatePayrollRunCore — لا تكرار من API عند النجاح.
 * لا stack / SQL / body / snapshot JSON في السجل.
 */
import { createHash } from 'crypto';
import { writeFinancialAudit } from './audit';
import type { TxClient } from './with-transaction';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** لا يُخزَّن مفتاح التكرار كاملاً — UUID → بادئة sha256 (12 hex)؛ غير ذلك → idem:***last4 */
export function maskIdempotencyKey(key: string): string {
  const raw = String(key ?? '').trim();
  if (!raw) return 'idem:***';
  if (UUID_RE.test(raw)) {
    return createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 12);
  }
  if (raw.length <= 4) return 'idem:***';
  return `idem:***${raw.slice(-4)}`;
}

export type CalculationBlockedAudit = {
  userId: string;
  runId: string;
  reason_code: string;
  message: string;
  periodId?: string;
  idempotency_key?: string;
  ip?: string;
  ua?: string;
};

export type CalculationFailedAudit = {
  userId: string;
  runId: string;
  message?: string;
  idempotency_key?: string;
  ip?: string;
  ua?: string;
};

/** 422 — احتساب مرفوض قبل بدء المعاملة (قائمة فارغة، عملة غير مدعومة، …). */
export async function auditCalculationBlocked(
  client: TxClient,
  input: CalculationBlockedAudit
): Promise<void> {
  const maskedKey =
    input.idempotency_key != null && String(input.idempotency_key).trim() !== ''
      ? maskIdempotencyKey(String(input.idempotency_key))
      : undefined;
  await writeFinancialAudit(client, {
    userId: input.userId,
    action: 'payroll_run.calculation_blocked',
    entityType: 'payroll_run',
    entityId: input.runId,
    newValues: {
      source_action: 'CALCULATE',
      reason_code: String(input.reason_code).slice(0, 60),
      payroll_period_id: input.periodId ?? null,
      idempotency_key_masked: maskedKey ?? null,
    },
    description: String(input.message).slice(0, 500),
    ipAddress: input.ip,
    userAgent: input.ua,
  });
}

/** 500 — فشل تقني بعد بدء الاحتساب أو خطأ غير متوقع. */
export async function auditCalculationFailed(
  client: TxClient,
  input: CalculationFailedAudit
): Promise<void> {
  const maskedKey =
    input.idempotency_key != null && String(input.idempotency_key).trim() !== ''
      ? maskIdempotencyKey(String(input.idempotency_key))
      : undefined;
  const description =
    input.message?.trim() ||
    'حدث خطأ تقني أثناء احتساب الرواتب. لم يتم حفظ نتائج جزئية.';
  await writeFinancialAudit(client, {
    userId: input.userId,
    action: 'payroll_run.calculation_failed',
    entityType: 'payroll_run',
    entityId: input.runId,
    newValues: {
      source_action: 'CALCULATE',
      error_code: 'CALC_TECHNICAL_FAILURE',
      idempotency_key_masked: maskedKey ?? null,
    },
    description: description.slice(0, 500),
    ipAddress: input.ip,
    userAgent: input.ua,
  });
}
