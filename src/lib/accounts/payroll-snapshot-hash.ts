/**
 * Canonicalization + SHA-256 hashing للقطات الرواتب (9.A.2.2).
 * لا يرتبط بمحرك احتساب — للاختبارات وVerify وFixtures فقط.
 *
 * سياسة D24:
 * - ترتيب مفاتيح Objects أبجديًا.
 * - ترتيب Arrays يحدده المستدعي (لا يُعاد فرزه تلقائيًا).
 * - Decimal → سلسلة ثابتة بثلاث منازل (مثل normalizeMoneyInput).
 * - Dates → YYYY-MM-DD إن كانت تاريخًا، أو ISO لـ timestamptz ذات معنى مالي.
 * - استبعاد timestamps التشغيلية (created_at/updated_at) من المعنى المالي.
 */
import { createHash } from 'crypto';
import { normalizeMoneyInput } from './money';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}/;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

/** يطبّع قيمة عشرية إلى سلسلة ثابتة بثلاث منازل؛ الأرقام المالية كسلاسل فقط في الناتج. */
export function canonicalizeDecimal(value: unknown): string {
  try {
    return normalizeMoneyInput(value);
  } catch {
    // قيم موقّعة (صافي سالب) — طبّع يدويًا
    const raw = String(value ?? '0').trim().replace(/,/g, '');
    const m = raw.match(/^(-)?(?:0|[1-9]\d*)(?:\.(\d{1,3}))?$/);
    if (!m) throw new Error('INVALID_DECIMAL_FOR_SNAPSHOT');
    const sign = m[1] ?? '';
    const [intPart, frac = ''] = raw.replace(/^-/, '').split('.');
    return `${sign}${intPart}.${frac.padEnd(3, '0')}`;
  }
}

export function canonicalizeDate(value: unknown): string {
  if (value == null) throw new Error('INVALID_DATE_FOR_SNAPSHOT');
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  if (DATE_ONLY_RE.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error('INVALID_DATE_FOR_SNAPSHOT');
  return canonicalizeDate(d);
}

const SKIP_KEYS = new Set([
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'version',
]);

/**
 * يُنتج تمثيلًا حتميًا:
 * - objects: مفاتيح مرتبة localeCompare('en') مع استبعاد مفاتيح تشغيلية.
 * - arrays: تبقى بالترتيب المُمرَّر.
 * - numbers التي تبدو عشرية مالية تُحوَّل لسلاسل ثلاثية المنازل عند markDecimals=true على المسار.
 */
export function canonicalizePayrollSnapshot(
  input: unknown,
  options: { treatNumbersAsDecimals?: boolean } = {}
): JsonValue {
  return canonicalizeValue(input, options.treatNumbersAsDecimals === true);
}

function canonicalizeValue(value: unknown, asDecimal: boolean): JsonValue {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (asDecimal && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim().replace(/,/g, ''))) {
      return canonicalizeDecimal(value);
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('INVALID_NUMBER_FOR_SNAPSHOT');
    if (asDecimal) return canonicalizeDecimal(value);
    return value;
  }
  if (value instanceof Date) return canonicalizeDate(value);
  if (Array.isArray(value)) {
    return value.map((v) => canonicalizeValue(v, asDecimal));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => !SKIP_KEYS.has(k) && obj[k] !== undefined)
      .sort((a, b) => a.localeCompare(b, 'en'));
    const out: JsonObject = {};
    for (const k of keys) {
      // حقول المبالغ الشائعة تُعامل كعشريات
      const decimalField =
        asDecimal ||
        /(_amount|_total|amount|rate|percentage|quantity|basic|gross|net|deduction)/i.test(k);
      out[k] = canonicalizeValue(obj[k], decimalField);
    }
    return out;
  }
  throw new Error('UNSUPPORTED_SNAPSHOT_VALUE');
}

/** JSON حتمي (مفاتيح مرتبة بالفعل من canonicalize). */
export function stableStringify(value: JsonValue): string {
  return JSON.stringify(value);
}

/** SHA-256 hex بطول 64 لحرف صغير. */
export function hashPayrollSnapshot(input: unknown): string {
  const canonical = canonicalizePayrollSnapshot(input);
  const payload = stableStringify(canonical);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** يتحقق أن القيمة SHA-256 hex بطول 64. */
export function isPayrollSnapshotHash(v: unknown): boolean {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}
