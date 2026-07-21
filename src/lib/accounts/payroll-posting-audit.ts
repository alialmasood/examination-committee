/**
 * تدقيق ترحيل الرواتب — blocked/failed (best-effort خارج Tx النجاح)
 */
import { writeFinancialAudit } from './audit';
import { maskIdempotencyKey } from './payroll-calculation-audit';
import type { TxClient } from './with-transaction';

export async function auditPostingBlocked(
  client: TxClient,
  input: {
    userId: string;
    runId: string;
    reason_code: string;
    message: string;
    idempotency_key?: string;
    comment?: string | null;
    ip?: string;
    ua?: string;
  }
): Promise<void> {
  const masked =
    input.idempotency_key != null && String(input.idempotency_key).trim() !== ''
      ? maskIdempotencyKey(String(input.idempotency_key))
      : null;
  await writeFinancialAudit(client, {
    userId: input.userId,
    action: 'payroll_run.posting_blocked',
    entityType: 'payroll_run',
    entityId: input.runId,
    newValues: {
      reason_code: String(input.reason_code).slice(0, 80),
      idempotency_key_masked: masked,
      comment:
        input.comment != null && String(input.comment).trim() !== ''
          ? String(input.comment).slice(0, 500)
          : null,
    },
    description: String(input.message).slice(0, 500),
    ipAddress: input.ip,
    userAgent: input.ua,
  });
}

export async function auditPostingFailed(
  client: TxClient,
  input: {
    userId: string;
    runId: string;
    idempotency_key?: string;
    ip?: string;
    ua?: string;
  }
): Promise<void> {
  const masked =
    input.idempotency_key != null && String(input.idempotency_key).trim() !== ''
      ? maskIdempotencyKey(String(input.idempotency_key))
      : null;
  await writeFinancialAudit(client, {
    userId: input.userId,
    action: 'payroll_run.posting_failed',
    entityType: 'payroll_run',
    entityId: input.runId,
    newValues: {
      error_code: 'PAYROLL_POSTING_TECHNICAL_FAILURE',
      idempotency_key_masked: masked,
    },
    description:
      'حدث خطأ تقني أثناء ترحيل الرواتب. لم يتم إنشاء أي قيد وبقي التشغيل معتمدًا.',
    ipAddress: input.ip,
    userAgent: input.ua,
  });
}
