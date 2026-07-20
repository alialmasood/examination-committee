/**
 * بصمات Idempotency لاعتماد الرواتب 9.B.1
 * Namespaces: payroll-submit-review: · payroll-approve: · payroll-reject:
 */
import { createHash } from 'crypto';
import { AccountsHttpError } from './auth';
import { maskIdempotencyKey } from './payroll-calculation-audit';

const KEY_MIN = 1;
const KEY_MAX = 128;
const COMMENT_MAX = 500;
const REASON_MIN = 10;
const REASON_MAX = 500;

export type PayrollApprovalOperation = 'SUBMIT_FOR_REVIEW' | 'APPROVE' | 'REJECT';

export function normalizeApprovalIdempotencyKey(key: unknown): string {
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

/** تعليق اختياري: trim · طي مسافات · حد 500 · فارغ → '' */
export function normalizeApprovalComment(comment: unknown): string {
  if (comment == null || comment === '') return '';
  if (typeof comment !== 'string') {
    throw new AccountsHttpError('التعليق يجب أن يكون نصاً', 400);
  }
  let s = comment.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/[ \t]+/g, ' ');
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) {
      throw new AccountsHttpError('التعليق يحتوي على محارف تحكم غير مسموحة', 400);
    }
  }
  if (s.length > COMMENT_MAX) {
    throw new AccountsHttpError(`التعليق طويل جداً (الحد الأقصى ${COMMENT_MAX})`, 400);
  }
  return s;
}

/** سبب رفض إلزامي 10..500 */
export function normalizeApprovalRejectReason(reason: unknown): string {
  if (typeof reason !== 'string') {
    throw new AccountsHttpError('سبب الرفض مطلوب ويجب أن يكون نصاً', 400);
  }
  let s = reason.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/[ \t]+/g, ' ');
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) {
      throw new AccountsHttpError('سبب الرفض يحتوي على محارف تحكم غير مسموحة', 400);
    }
  }
  if (!s || s.length < REASON_MIN) {
    throw new AccountsHttpError(
      `سبب الرفض قصير جداً (الحد الأدنى ${REASON_MIN} أحرف بعد التطبيع)`,
      400
    );
  }
  if (s.length > REASON_MAX) {
    throw new AccountsHttpError(
      `سبب الرفض طويل جداً (الحد الأقصى ${REASON_MAX} حرفاً)`,
      400
    );
  }
  return s;
}

function prefixFor(op: PayrollApprovalOperation): string {
  if (op === 'SUBMIT_FOR_REVIEW') return 'payroll-submit-review:';
  if (op === 'APPROVE') return 'payroll-approve:';
  return 'payroll-reject:';
}

export function buildApprovalRequestKeyHash(
  op: PayrollApprovalOperation,
  normalizedKey: string
): string {
  return createHash('sha256')
    .update(`${prefixFor(op)}${normalizedKey}`, 'utf8')
    .digest('hex');
}

export function buildApprovalRequestPayloadHash(
  op: PayrollApprovalOperation,
  p: Record<string, string | number>
): string {
  const keys = Object.keys(p).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(p[k])}`).join(',');
  const canonical = `{"operation":${JSON.stringify(op)},${body}}`;
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export { maskIdempotencyKey };
