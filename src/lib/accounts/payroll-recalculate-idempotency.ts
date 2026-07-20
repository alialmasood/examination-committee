/**
 * بصمات Idempotency لإعادة احتساب الرواتب 9.A.2.4.1
 * Namespace: payroll-recalc: — منفصل عن payroll-calc:
 */
import { createHash } from 'crypto';
import { AccountsHttpError } from './auth';
import { maskIdempotencyKey } from './payroll-calculation-audit';

const KEY_MIN = 1;
const KEY_MAX = 128;
const REASON_MIN = 10;
const REASON_MAX = 500;

/** مفتاح التكرار: trim فقط + طول 1..128 */
export function normalizeRecalculateIdempotencyKey(key: unknown): string {
  if (typeof key !== 'string' && key != null && typeof key !== 'number') {
    throw new AccountsHttpError('مفتاح التكرار (idempotency_key) غير صالح', 400);
  }
  const raw = String(key ?? '').trim();
  if (!raw) {
    throw new AccountsHttpError('مفتاح التكرار (idempotency_key) مطلوب', 400);
  }
  if (raw.length < KEY_MIN || raw.length > KEY_MAX) {
    throw new AccountsHttpError(
      `مفتاح التكرار يجب أن يكون بين ${KEY_MIN} و ${KEY_MAX} حرفاً`,
      400
    );
  }
  return raw;
}

/**
 * تطبيع السبب: trim · توحيد نهايات الأسطر · طي المسافات الأفقية المتتالية ·
 * رفض NUL/محارف تحكم غير مسموحة · طول 10..500 بعد التطبيع.
 */
export function normalizeRecalculateReason(reason: unknown): string {
  if (typeof reason !== 'string') {
    throw new AccountsHttpError('سبب إعادة الاحتساب مطلوب ويجب أن يكون نصاً', 400);
  }
  let s = reason.trim();
  if (!s) {
    throw new AccountsHttpError('سبب إعادة الاحتساب مطلوب', 400);
  }
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/[ \t]+/g, ' ');
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x0a) continue; // \n مسموح بعد التوحيد
    if (code < 0x20 || code === 0x7f) {
      throw new AccountsHttpError(
        'سبب إعادة الاحتساب يحتوي على محارف تحكم غير مسموحة',
        400
      );
    }
  }
  if (s.length < REASON_MIN) {
    throw new AccountsHttpError(
      `سبب إعادة الاحتساب قصير جداً (الحد الأدنى ${REASON_MIN} أحرف بعد التطبيع)`,
      400
    );
  }
  if (s.length > REASON_MAX) {
    throw new AccountsHttpError(
      `سبب إعادة الاحتساب طويل جداً (الحد الأقصى ${REASON_MAX} حرفاً)`,
      400
    );
  }
  return s;
}

/** SHA-256 lowercase hex لـ payroll-recalc: + المفتاح المطبع */
export function buildRecalculateRequestKeyHash(normalizedKey: string): string {
  return createHash('sha256')
    .update(`payroll-recalc:${normalizedKey}`, 'utf8')
    .digest('hex');
}

/**
 * JSON كانوني بترتيب مفاتيح ثابت · UTF-8 · بلا مسافات زائدة.
 * SHA-256 lowercase hex.
 */
export function buildRecalculateRequestPayloadHash(p: {
  run_id: string;
  reason: string;
  expected_version: number;
  expected_updated_at: string;
}): string {
  const canonical = [
    '{"operation":"RECALCULATE"',
    `"run_id":${JSON.stringify(p.run_id)}`,
    `"reason":${JSON.stringify(p.reason)}`,
    `"expected_version":${p.expected_version}`,
    `"expected_updated_at":${JSON.stringify(p.expected_updated_at)}`,
    '}',
  ].join(',');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** UUID مستقر من أول 16 بايت من بصمة المفتاح (نفس تشكيل v4-shaped كـ calculate). */
export function requestKeyHashToRequestUuid(keyHash: string): string {
  const hex = String(keyHash ?? '')
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new AccountsHttpError('بصمة مفتاح إعادة الاحتساب غير صالحة', 500);
  }
  const bytes = Buffer.from(hex.slice(0, 32), 'hex');
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** للعرض فقط — لا يُستخدم للمطابقة. */
export function maskRecalculateRequestKey(normalizedKey: string): string {
  return maskIdempotencyKey(normalizedKey);
}
