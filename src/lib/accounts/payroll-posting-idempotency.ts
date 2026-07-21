/**
 * Idempotency لترحيل الرواتب 9.C.1 — namespace: payroll-post
 */
import { createHash } from 'crypto';
import { AccountsHttpError } from './auth';
import { maskIdempotencyKey } from './payroll-calculation-audit';
import { normalizeApprovalComment } from './payroll-approval-idempotency';

const KEY_MIN = 1;
const KEY_MAX = 128;

export const PAYROLL_POST_IDEMPOTENCY_PREFIX = 'payroll-post:';

/** عتبة تقريب الترحيل بالدينار — مركزية · لا تُقبل من العميل */
export const PAYROLL_POSTING_ROUNDING_THRESHOLD_IQD = '1.000';

export function normalizePostingIdempotencyKey(key: unknown): string {
  if (typeof key !== 'string' && key != null && typeof key !== 'number') {
    throw new AccountsHttpError('مفتاح التكرار (idempotency_key) غير صالح', 400);
  }
  const raw = String(key ?? '').trim();
  if (!raw) throw new AccountsHttpError('مفتاح التكرار (idempotency_key) مطلوب', 400);
  if (raw.length < KEY_MIN || raw.length > KEY_MAX) {
    throw new AccountsHttpError(
      `مفتاح التكرار يجب أن يكون بين ${KEY_MIN} و ${KEY_MAX} حرفاً`,
      400
    );
  }
  return raw;
}

export function buildPostingRequestKeyHash(key: string): string {
  return createHash('sha256')
    .update(`${PAYROLL_POST_IDEMPOTENCY_PREFIX}${key}`, 'utf8')
    .digest('hex');
}

export function buildPostingRequestPayloadHash(parts: {
  payroll_run_id: string;
  version: number;
  updated_at: string;
  posting_date: string;
  comment: string;
  confirmation: true;
}): string {
  const canonical = JSON.stringify({
    payroll_run_id: parts.payroll_run_id,
    version: parts.version,
    updated_at: parts.updated_at,
    posting_date: parts.posting_date,
    comment: parts.comment,
    confirmation: true,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function normalizePostingComment(comment: unknown): string {
  return normalizeApprovalComment(comment);
}

export { maskIdempotencyKey };
