/**
 * تدقيق اعتماد الرواتب — blocked/failed خارج Tx النجاح (9.B.1).
 */
import { writeFinancialAudit } from './audit';
import { maskIdempotencyKey } from './payroll-calculation-audit';
import type { TxClient } from './with-transaction';

export async function auditApprovalBlocked(
  client: TxClient,
  input: {
    userId: string;
    runId: string;
    operation: 'SUBMIT_FOR_REVIEW' | 'APPROVE' | 'REJECT';
    reason_code: string;
    message: string;
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
    action: 'payroll_run.approval_blocked',
    entityType: 'payroll_run',
    entityId: input.runId,
    newValues: {
      operation: input.operation,
      reason_code: String(input.reason_code).slice(0, 60),
      idempotency_key_masked: masked,
    },
    description: String(input.message).slice(0, 500),
    ipAddress: input.ip,
    userAgent: input.ua,
  });
}

export async function auditApprovalFailed(
  client: TxClient,
  input: {
    userId: string;
    runId: string;
    operation: 'SUBMIT_FOR_REVIEW' | 'APPROVE' | 'REJECT';
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
    action: 'payroll_run.approval_failed',
    entityType: 'payroll_run',
    entityId: input.runId,
    newValues: {
      operation: input.operation,
      error_code: 'APPROVAL_TECHNICAL_FAILURE',
      idempotency_key_masked: masked,
    },
    description:
      'حدث خطأ تقني أثناء اعتماد الرواتب. بقيت حالة التشغيل السابقة محفوظة دون تغيير.',
    ipAddress: input.ip,
    userAgent: input.ua,
  });
}
