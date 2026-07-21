/**
 * أدوات تحقّق مشتركة لوحدة الرواتب (9.A.1).
 *
 * مبدأ Zero Hardcoded Payroll Logic: لا يوجد هنا أي منطق يعتمد على
 * person_type أو component_code لتغيير السلوك المالي. الدوال هنا تحقّق قيم Enum
 * العامة والتنسيقات والتواريخ والحسابات فقط.
 */
import { AccountsHttpError } from './auth';
import { normalizeCurrencyCode } from './currency';
import {
  nextDocumentNumber,
  yearLabelFromDate,
} from './document-sequences';
import { normalizeMoneyInput } from './money';
import { assertPostingAccount } from './posting-account';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function toEpochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return new Date(String(value)).getTime();
}

/** يفرض UUID صالحًا قبل أي استعلام — خطأ 400 عربي عام. */
export function requirePayrollUuid(v: unknown, label = 'المعرّف'): string {
  const s = String(v ?? '').trim();
  if (!UUID_RE.test(s)) {
    throw new AccountsHttpError(`${label} غير صالح`, 400);
  }
  return s;
}

/** UUID اختياري: فارغ → null، غير صالح → 400. */
export function optionalPayrollUuid(v: unknown, label = 'المعرّف'): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return requirePayrollUuid(s, label);
}

export const iso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

/** تاريخ DATE قادم من PostgreSQL → YYYY-MM-DD دون إزاحة UTC */
export const dateStr = (v: Date | string | null | undefined): string | null => {
  if (v == null) return null;
  if (typeof v === 'string') {
    const raw = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
};

export function textOrNull(v: unknown, n: number): string | null {
  const s = String(v ?? '').trim().slice(0, n);
  return s || null;
}

export function requiredText(v: unknown, n: number, label: string): string {
  const s = String(v ?? '').trim().slice(0, n);
  if (!s) throw new AccountsHttpError(`${label} مطلوب`, 400);
  return s;
}

/** رمز مطبّع: أحرف كبيرة/أرقام/شرطة/شرطة سفلية، حتى 40 حرفاً */
export function payrollCode(v: unknown, label: string): string {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) throw new AccountsHttpError(`${label} مطلوب`, 400);
  if (s.length > 40 || !/^[A-Z0-9_-]+$/.test(s)) {
    throw new AccountsHttpError(`${label} غير صالح (أحرف/أرقام/شرطة فقط)`, 400);
  }
  return s;
}

export function currencyCode(v: unknown, fallback = 'IQD'): string {
  return normalizeCurrencyCode(v, fallback);
}

/** يتحقق من انتماء القيمة لمجموعة Enum المسموح بها */
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], label: string): T {
  const s = String(v ?? '').trim().toUpperCase();
  if (!allowed.includes(s as T)) {
    throw new AccountsHttpError(`${label} غير صالح`, 400);
  }
  return s as T;
}

export function optionalOneOf<T extends string>(
  v: unknown,
  allowed: readonly T[],
  label: string
): T | null {
  if (v == null || v === '') return null;
  return oneOf(v, allowed, label);
}

/** مبلغ غير سالب مطبّع (3 منازل) — يعيد نصاً */
export function nonNegativeMoney(v: unknown, label: string, fallback = '0'): string {
  if (v == null || v === '') return normalizeMoneyInput(fallback);
  try {
    return normalizeMoneyInput(v);
  } catch {
    throw new AccountsHttpError(`${label} يجب أن يكون رقماً غير سالب`, 400);
  }
}

export function optionalNonNegativeMoney(v: unknown, label: string): string | null {
  if (v == null || v === '') return null;
  return nonNegativeMoney(v, label);
}

export function optionalPercentage(v: unknown, label: string): string | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new AccountsHttpError(`${label} يجب أن يكون بين 0 و 100`, 400);
  }
  return String(n);
}

export function optionalPositiveInt(v: unknown, label: string, fallback: number): number {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new AccountsHttpError(`${label} يجب أن يكون عدداً صحيحاً غير سالب`, 400);
  }
  return n;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function requiredDate(v: unknown, label: string): string {
  const s = String(v ?? '').trim().slice(0, 10);
  if (!DATE_RE.test(s) || Number.isNaN(new Date(s).getTime())) {
    throw new AccountsHttpError(`${label} غير صالح (الصيغة YYYY-MM-DD)`, 400);
  }
  return s;
}

export function optionalDate(v: unknown, label: string): string | null {
  if (v == null || v === '') return null;
  return requiredDate(v, label);
}

/** effective_to لا يسبق effective_from */
export function assertEffectiveRange(from: string, to: string | null): void {
  if (to != null && to < from) {
    throw new AccountsHttpError('تاريخ نهاية السريان لا يمكن أن يسبق تاريخ البداية', 400);
  }
}

/**
 * تزامن متفائل موحّد للرواتب (version + updated_at).
 * رسائل عربية خاصة بالرواتب — لا تعتمد على صياغة «الجلسة» من Cash Session.
 * أكواد HTTP كما هي: 400 ناقص/غير صالح، 409 تعارض نسخة.
 */
export function assertPayrollConcurrency(
  row: { version: number; updated_at: Date | string },
  version: unknown,
  updatedAt: unknown,
  entityLabel = 'السجل'
): void {
  if (version == null) {
    throw new AccountsHttpError('رقم الإصدار (version) مطلوب', 400);
  }
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) {
    throw new AccountsHttpError('رقم الإصدار غير صالح', 400);
  }
  if (v !== row.version) {
    throw new AccountsHttpError(
      `تم تعديل ${entityLabel} بواسطة مستخدم آخر. حدّث الصفحة ثم أعد المحاولة.`,
      409
    );
  }
  if (updatedAt == null || updatedAt === '') {
    throw new AccountsHttpError('حقل updated_at مطلوب للتحقق من التزامن', 400);
  }
  const currentMs = toEpochMs(row.updated_at);
  const expectedMs = toEpochMs(updatedAt);
  if (!Number.isFinite(currentMs) || !Number.isFinite(expectedMs)) {
    throw new AccountsHttpError('قيمة updated_at غير صالحة', 400);
  }
  if (currentMs !== expectedMs) {
    throw new AccountsHttpError(
      `تم تعديل ${entityLabel} بواسطة مستخدم آخر (updated_at). حدّث الصفحة ثم أعد المحاولة.`,
      409
    );
  }
}

/**
 * سبب إلزامي مطبّع للأفعال الحساسة (إنهاء/إلغاء) — H2.
 * يقلّم المسافات، يوحّد المسافات الداخلية، يرفض النص الفارغ أو المسافات فقط،
 * ويحدّ الطول. لا يُخزَّن في عمود جديد — يُسجَّل في Audit فقط.
 */
export function requiredReason(v: unknown, label = 'سبب الإجراء', max = 500): string {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
  if (!s) throw new AccountsHttpError(`${label} مطلوب`, 400);
  return s;
}

/**
 * يمنع تكرار إسناد المكوّن بنفس دلالة الفهرس الفريد
 * uq_pca_person_component_source_period (COALESCE للمصادر NULL).
 * فحص خدمي مسبق يعيد 409 نظيفاً؛ القيد في القاعدة يبقى الحاسم ضد السباق.
 */
export async function assertComponentAssignmentUnique(
  client: TxClient,
  p: {
    personId: string;
    componentId: string;
    contractId: string | null;
    assignmentId: string | null;
    effectiveFrom: string;
  }
): Promise<void> {
  const ZERO = '00000000-0000-0000-0000-000000000000';
  const r = await txQuery<{ id: string }>(
    client,
    `SELECT id FROM accounts.payroll_component_assignments
     WHERE payroll_person_id = $1::uuid
       AND payroll_component_id = $2::uuid
       AND effective_from = $3::date
       AND COALESCE(payroll_contract_id, $4::uuid) = COALESCE($5::uuid, $4::uuid)
       AND COALESCE(payroll_assignment_id, $4::uuid) = COALESCE($6::uuid, $4::uuid)
     LIMIT 1`,
    [p.personId, p.componentId, p.effectiveFrom, ZERO, p.contractId, p.assignmentId]
  );
  if (r.rows[0]) {
    throw new AccountsHttpError('يوجد إسناد مكوّن مكرر لنفس الشخص والمكوّن والمصدر وتاريخ البداية', 409);
  }
}

/**
 * تحقّق أساس الاحتساب (calculation_base_type — D18، النهج B).
 *
 * القيم على مستوى القاعدة: NONE / CONTRACT_BASIC + ثلاث محجوزة.
 * في 9.A.2.1: المنفّذ فقط NONE و CONTRACT_BASIC؛ المحجوزة تُرفض خدمياً.
 *
 * قواعد الربط بطريقة الاحتساب (بلا Hardcoded Component Code):
 *  - PERCENTAGE_OF_BASIC يتطلب CONTRACT_BASIC.
 *  - بقية الطرق لا يجوز أن تعتمد على CONTRACT_BASIC (تُلزم بـ NONE) في هذه المرحلة.
 */
export function payrollCalculationBaseType(v: unknown, method: string): string {
  const s = String(v ?? 'NONE').trim().toUpperCase();
  const all = PAYROLL_ENUMS.CALCULATION_BASE_TYPE as readonly string[];
  if (!all.includes(s)) {
    throw new AccountsHttpError('أساس الاحتساب غير صالح', 400);
  }
  const implemented = PAYROLL_ENUMS.CALCULATION_BASE_TYPE_IMPLEMENTED as readonly string[];
  if (!implemented.includes(s)) {
    throw new AccountsHttpError(
      'أساس الاحتساب المطلوب محجوز ولم يُفعّل بعد في هذه المرحلة',
      400
    );
  }
  if (method === 'PERCENTAGE_OF_BASIC' && s !== 'CONTRACT_BASIC') {
    throw new AccountsHttpError(
      'طريقة «نسبة من الأساسي» تتطلب أساس احتساب = الأساسي التعاقدي (CONTRACT_BASIC)',
      400
    );
  }
  if (method !== 'PERCENTAGE_OF_BASIC' && s === 'CONTRACT_BASIC') {
    throw new AccountsHttpError(
      'لا يجوز اعتماد الأساسي التعاقدي (CONTRACT_BASIC) إلا مع طريقة «نسبة من الأساسي» في هذه المرحلة',
      400
    );
  }
  return s;
}

/** يمنع استخدام CUSTOM_FORMULA فعلياً في 9.A (D14 — محجوز فقط) */
export function rejectCustomFormula(method: string | null | undefined): void {
  if (method === 'CUSTOM_FORMULA') {
    throw new AccountsHttpError(
      'طريقة CUSTOM_FORMULA محجوزة ولم تُفعّل بعد — غير مسموح باستخدامها في هذه المرحلة',
      400
    );
  }
}

/** يتحقق من حساب GL ترحيلي فعّال إن مُرّر (اختياري) */
export async function assertOptionalPostingAccount(
  client: TxClient,
  accountId: string | null,
  label: string
): Promise<string | null> {
  if (!accountId) return null;
  const acc = await assertPostingAccount(client, accountId, label, { invalidStatusCode: 400 });
  return acc.id;
}

/**
 * يتحقق من عدم تكرار رمز/رقم داخل جدول رواتب قبل الإدراج.
 * يعيد خطأ 409 برسالة عربية واضحة بدل ترك قيد قاعدة البيانات يرفع خطأً خاماً.
 * (القيد الفريد في القاعدة يبقى خط الدفاع الأخير ضد التزامن.)
 */
export async function assertPayrollCodeAvailable(
  client: TxClient,
  table:
    | 'payroll_calendars'
    | 'payroll_people'
    | 'payroll_contracts'
    | 'payroll_assignments'
    | 'payroll_components'
    | 'payroll_account_mappings',
  column:
    | 'code'
    | 'person_code'
    | 'contract_number'
    | 'assignment_code'
    | 'component_code'
    | 'mapping_code',
  value: string,
  label: string
): Promise<void> {
  const r = await txQuery<{ id: string }>(
    client,
    `SELECT id FROM accounts.${table} WHERE ${column} = $1 LIMIT 1`,
    [value]
  );
  if (r.rows[0]) throw new AccountsHttpError(`${label} مستخدم مسبقاً`, 409);
}

/** يتحقق من وجود مركز كلفة فعّال إن مُرّر (اختياري) */
export async function assertOptionalCostCenter(
  client: TxClient,
  costCenterId: string | null,
  label = 'مركز الكلفة'
): Promise<string | null> {
  if (!costCenterId) return null;
  const r = await txQuery<{ id: string; is_active: boolean }>(
    client,
    `SELECT id, is_active FROM accounts.cost_centers WHERE id = $1::uuid`,
    [costCenterId]
  );
  if (!r.rows[0]) throw new AccountsHttpError(`${label} غير موجود`, 404);
  if (!r.rows[0].is_active) throw new AccountsHttpError(`${label} غير فعّال`, 400);
  return r.rows[0].id;
}

async function getDefaultActiveFiscalYear(
  client: TxClient
): Promise<{ id: string; start_date: string }> {
  const r = await txQuery<{ id: string; start_date: string }>(
    client,
    `SELECT id, start_date::text AS start_date
     FROM accounts.fiscal_years
     WHERE status = 'ACTIVE'
     ORDER BY is_default DESC, start_date DESC
     LIMIT 1`
  );
  if (!r.rows[0]) throw new AccountsHttpError('لا توجد سنة مالية نشطة', 409);
  return r.rows[0];
}

/**
 * يخصّص رقماً تسلسلياً لكيان رواتب داخل المعاملة (FOR UPDATE عبر nextDocumentNumber).
 * لا يستخدم COUNT+1. يضمن وجود تسلسل السنة الحالية دفاعياً.
 */
export async function nextPayrollNumber(
  client: TxClient,
  documentType:
    | 'PAYROLL_PERSON'
    | 'PAYROLL_CONTRACT'
    | 'PAYROLL_ASSIGNMENT'
    | 'PAYROLL_PERIOD'
    | 'PAYROLL_RUN',
  prefix: 'PYP' | 'PYC' | 'PYA' | 'PYPR' | 'PYR'
): Promise<string> {
  const year = await getDefaultActiveFiscalYear(client);
  await txQuery(
    client,
    `INSERT INTO accounts.document_sequences
      (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
     SELECT $2::text, $1::uuid, $3::text, 0, 6, TRUE, TRUE
     WHERE NOT EXISTS (
       SELECT 1 FROM accounts.document_sequences
       WHERE document_type = $2::text AND fiscal_year_id = $1::uuid
     )`,
    [year.id, documentType, prefix]
  );
  try {
    const seq = await nextDocumentNumber(client, {
      documentType,
      fiscalYearId: year.id,
      yearLabel: yearLabelFromDate(year.start_date),
    });
    return seq.formatted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'تعذر تخصيص الرقم التسلسلي';
    throw new AccountsHttpError(msg, 409);
  }
}

/** مجموعات Enum المشتركة (لأغراض التحقق والـ options فقط — لا سلوك) */
export const PAYROLL_ENUMS = {
  PERSON_TYPE: ['TEACHING_STAFF', 'EXTERNAL_LECTURER', 'EMPLOYEE', 'DAILY_WORKER', 'SERVICE_WORKER'] as const,
  PERSON_STATUS: ['ACTIVE', 'SUSPENDED', 'TERMINATED', 'INACTIVE'] as const,
  COMPENSATION_BASIS: ['MONTHLY_FIXED', 'HOURLY', 'PER_LECTURE', 'DAILY', 'FIXED_SERVICE'] as const,
  CONTRACT_STATUS: ['DRAFT', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'EXPIRED', 'CANCELLED'] as const,
  ASSIGNMENT_TYPE: [
    'TEMPORARY_DUTY', 'ADDITIONAL_RESPONSIBILITY', 'ALLOWANCE_SOURCE',
    'LECTURER_ASSIGNMENT', 'COMMITTEE_ASSIGNMENT', 'GENERAL_ASSIGNMENT',
  ] as const,
  ASSIGNMENT_STATUS: ['DRAFT', 'ACTIVE', 'SUSPENDED', 'ENDED'] as const,
  COMPONENT_TYPE: ['EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION'] as const,
  CALCULATION_METHOD: [
    'FIXED_AMOUNT', 'PERCENTAGE_OF_BASIC', 'QUANTITY_X_RATE', 'DAYS_X_DAILY_RATE',
    'HOURS_X_HOURLY_RATE', 'LECTURES_X_RATE', 'MANUAL_AMOUNT', 'CUSTOM_FORMULA',
  ] as const,
  MAPPING_SCOPE: ['DEFAULT', 'PERSON_TYPE', 'COMPONENT', 'CALENDAR', 'ROUNDING'] as const,
  CALENDAR_TYPE: ['MONTHLY', 'LECTURER', 'DAILY', 'SUMMER', 'ACADEMIC'] as const,
  PAYMENT_METHOD: ['CASH', 'BANK', 'CHEQUE', 'RESERVED'] as const,
  // 9.A.2.1 — الأساس المستخدم في الاحتساب (D18)
  CALCULATION_BASE_TYPE: [
    'NONE', 'CONTRACT_BASIC', 'GROSS_EARNINGS', 'SELECTED_COMPONENTS', 'COMPONENT_REFERENCE',
  ] as const,
  CALCULATION_BASE_TYPE_IMPLEMENTED: ['NONE', 'CONTRACT_BASIC'] as const,
  // 9.A.2.1 — الفترات والتشغيلات والنطاق
  PERIOD_STATUS: ['OPEN', 'PROCESSING', 'CLOSED', 'CANCELLED'] as const,
  RUN_TYPE: ['REGULAR', 'CORRECTION', 'SUPPLEMENTAL', 'TERMINATION', 'MANUAL'] as const,
  RUN_STATUS: [
    'DRAFT',
    'CALCULATING',
    'CALCULATED',
    'UNDER_REVIEW',
    'APPROVED',
    'POSTED',
    'CANCELLED',
  ] as const,
  SCOPE_TYPE: ['ALL', 'COLLEGE', 'DEPARTMENT', 'COST_CENTER', 'PERSON_LIST'] as const,
} as const;
