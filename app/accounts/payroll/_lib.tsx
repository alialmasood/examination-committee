/* eslint-disable @typescript-eslint/no-explicit-any */
/** أدوات مشتركة لواجهة الرواتب — 9.A.1 */
import type { ReactNode } from 'react';

export const API = {
  options: '/api/accounts/payroll/options',
  people: '/api/accounts/payroll/people',
  contracts: '/api/accounts/payroll/contracts',
  assignments: '/api/accounts/payroll/assignments',
  components: '/api/accounts/payroll/components',
  componentAssignments: '/api/accounts/payroll/component-assignments',
  calendars: '/api/accounts/payroll/calendars',
  accountMappings: '/api/accounts/payroll/account-mappings',
  periods: '/api/accounts/payroll/periods',
  runs: '/api/accounts/payroll/runs',
} as const;

/** مسارات ديناميكية لطبقة الفترات/التشغيلات — 9.A.2.1 */
export const periodUrl = (id: string) => `/api/accounts/payroll/periods/${id}`;
export const periodActionUrl = (id: string, action: 'close' | 'reopen' | 'cancel') =>
  `/api/accounts/payroll/periods/${id}/${action}`;
export const runUrl = (id: string) => `/api/accounts/payroll/runs/${id}`;
export const runCancelUrl = (id: string) => `/api/accounts/payroll/runs/${id}/cancel`;
export const runCalculateUrl = (id: string) => `/api/accounts/payroll/runs/${id}/calculate`;
export const runRecalculateUrl = (id: string) => `/api/accounts/payroll/runs/${id}/recalculate`;
export const runRecalculationsUrl = (id: string) => `/api/accounts/payroll/runs/${id}/recalculations`;
export const runSubmitReviewUrl = (id: string) => `/api/accounts/payroll/runs/${id}/submit-review`;
export const runApproveUrl = (id: string) => `/api/accounts/payroll/runs/${id}/approve`;
export const runRejectUrl = (id: string) => `/api/accounts/payroll/runs/${id}/reject`;
export const runPostUrl = (id: string) => `/api/accounts/payroll/runs/${id}/post`;
export const runApprovalHistoryUrl = (id: string) =>
  `/api/accounts/payroll/runs/${id}/approval-history`;
export const runPeopleUrl = (id: string) => `/api/accounts/payroll/runs/${id}/people`;

/** تسميات إجراءات سجل الاعتماد — 9.B.4 */
export const APPROVAL_HISTORY_ACTION_LABEL: Record<string, string> = {
  SUBMITTED_FOR_REVIEW: 'أُرسل للمراجعة',
  APPROVED: 'معتمد',
  REJECTED: 'مرفوض للتصحيح',
};

export const APPROVAL_HISTORY_ACTION_DETAIL_AR: Record<string, string> = {
  SUBMITTED_FOR_REVIEW: 'تم إرسال التشغيل للمراجعة',
  APPROVED: 'تم اعتماد التشغيل',
  REJECTED: 'تم رفض التشغيل وإعادته للتصحيح',
};

export function approvalHistoryActionBadge(action: string): string {
  return APPROVAL_HISTORY_ACTION_LABEL[action] ?? action;
}

/** اختصار بصمة الاعتماد للعرض — لا تعرض الهاش كاملاً */
export function shortApprovalHashDisplay(h: string | null | undefined): string {
  if (!h) return '—';
  const s = String(h).trim();
  if (s.includes('…')) return s;
  if (s.length <= 16) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}
export const runPersonDetailUrl = (id: string, runPersonId: string) =>
  `/api/accounts/payroll/runs/${id}/people/${runPersonId}`;
export const runScopeUrl = (id: string) => `/api/accounts/payroll/runs/${id}/scope-members`;
export const runScopeMemberUrl = (id: string, personId: string) =>
  `/api/accounts/payroll/runs/${id}/scope-members/${personId}`;

export async function fetchJson(url: string, init?: RequestInit) {
  try {
    const r = await fetch(url, { credentials: 'include', ...init });
    const body = await r.json().catch(() => ({}));
    return { ...body, __status: r.status, __ok: r.ok };
  } catch {
    return { success: false, message: 'تعذّر الاتصال بالخادم', __status: 0, __ok: false };
  }
}

export function errMsg(r: any): string {
  if (r?.__status === 401) return 'انتهت الجلسة أو تحتاج إلى تسجيل الدخول';
  if (r?.__status === 403) return r?.message || 'ليس لديك صلاحية لتنفيذ هذا الإجراء';
  if (r?.__status === 409) return r?.message || 'تعارض في الإصدار — أعد تحميل الصفحة وحاول مجدداً';
  return r?.message || r?.error || 'تعذّر تنفيذ العملية';
}

/** رسائل أخطاء اعتماد الرواتب — للاختبارات والواجهة 9.B.3 */
export function approveDecisionErrorMsg(r: any): string {
  const code = r?.error?.code;
  if (r?.__status === 400 || code === 'INVALID_APPROVAL_COMMENT') {
    return r?.error?.message || r?.message || 'تعذر قبول تعليق الاعتماد. يجب ألا يتجاوز 500 حرف.';
  }
  if (code === 'PAYROLL_SELF_APPROVAL_FORBIDDEN') {
    return 'لا يجوز للمستخدم الذي أرسل تشغيل الرواتب للمراجعة أن يعتمد التشغيل نفسه.';
  }
  if (r?.__status === 403 || code === 'FORBIDDEN') {
    return 'ليس لديك صلاحية اعتماد تشغيل الرواتب.';
  }
  if (r?.__status === 404 || code === 'PAYROLL_RUN_NOT_FOUND') {
    return 'تعذر العثور على تشغيل الرواتب أو لا تملك صلاحية الوصول إليه.';
  }
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return 'تم استخدام مفتاح العملية نفسه مع بيانات مختلفة.';
  }
  if (code === 'APPROVAL_INTEGRITY_CONFLICT') {
    return 'تعذر التحقق من عملية اعتماد سابقة. لم يتم تعديل تشغيل الرواتب.';
  }
  if (code === 'APPROVAL_ALREADY_DECIDED') {
    return 'تم اتخاذ قرار سابق بشأن دورة المراجعة الحالية.';
  }
  if (code === 'PAYROLL_REVIEW_SNAPSHOT_CHANGED') {
    return 'تغيرت نتائج تشغيل الرواتب بعد إرسالها للمراجعة، لذلك لم يتم اعتمادها.';
  }
  if (code === 'STALE_PAYROLL_RUN' || (r?.__status === 409 && !code)) {
    return 'تم تعديل تشغيل الرواتب بواسطة مستخدم آخر. يرجى تحديث الصفحة.';
  }
  if (r?.__status === 409) {
    return r?.error?.message || r?.message || 'لا يمكن اعتماد تشغيل الرواتب في حالته الحالية.';
  }
  if (code === 'PAYROLL_HAS_ERRORS') {
    return 'لا يمكن اعتماد التشغيل قبل معالجة أخطاء الرواتب.';
  }
  if (code === 'PAYROLL_HAS_BLOCKING_ISSUES') {
    return 'لا يمكن اعتماد التشغيل لوجود مشكلات حاجبة.';
  }
  if (code === 'UNSUPPORTED_PAYROLL_CURRENCY') {
    return 'الإصدار الحالي من الرواتب يدعم الدينار العراقي IQD فقط.';
  }
  if (r?.__status === 422) {
    return r?.error?.message || r?.message || 'تعذر اعتماد تشغيل الرواتب بسبب إعدادات التشغيل الحالية.';
  }
  if (r?.__status === 500 || code === 'TECHNICAL_FAILURE') {
    return 'حدث خطأ تقني أثناء اعتماد الرواتب. بقيت حالة التشغيل دون تغيير.';
  }
  return errMsg(r);
}

/** رسائل أخطاء رفض مراجعة الرواتب — للاختبارات والواجهة 9.B.3 */
export function rejectDecisionErrorMsg(r: any): string {
  const code = r?.error?.code;
  if (r?.__status === 400 || code === 'INVALID_REJECTION_REASON') {
    return r?.error?.message || r?.message || 'يجب إدخال سبب واضح للرفض يتراوح بين 10 و500 حرف.';
  }
  if (code === 'PAYROLL_SELF_REJECTION_FORBIDDEN') {
    return 'لا يجوز للمستخدم الذي أرسل تشغيل الرواتب للمراجعة أن يصدر قرار الرفض لنفس التشغيل.';
  }
  if (r?.__status === 403 || code === 'FORBIDDEN') {
    return 'ليس لديك صلاحية رفض مراجعة تشغيل الرواتب.';
  }
  if (r?.__status === 404 || code === 'PAYROLL_RUN_NOT_FOUND') {
    return 'تعذر العثور على تشغيل الرواتب أو لا تملك صلاحية الوصول إليه.';
  }
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return 'تم استخدام مفتاح العملية نفسه مع بيانات مختلفة.';
  }
  if (code === 'APPROVAL_INTEGRITY_CONFLICT') {
    return 'تعذر التحقق من عملية رفض سابقة. لم يتم تعديل تشغيل الرواتب.';
  }
  if (code === 'APPROVAL_ALREADY_DECIDED') {
    return 'تم اتخاذ قرار سابق بشأن دورة المراجعة الحالية.';
  }
  if (code === 'STALE_PAYROLL_RUN' || (r?.__status === 409 && !code)) {
    return 'تم تعديل تشغيل الرواتب بواسطة مستخدم آخر. يرجى تحديث الصفحة.';
  }
  if (r?.__status === 409) {
    return r?.error?.message || r?.message || 'لا يمكن رفض مراجعة تشغيل الرواتب في حالته الحالية.';
  }
  if (r?.__status === 422) {
    return r?.error?.message || r?.message || 'تعذر رفض مراجعة الرواتب بسبب إعدادات التشغيل الحالية.';
  }
  if (r?.__status === 500 || code === 'TECHNICAL_FAILURE') {
    return 'حدث خطأ تقني أثناء رفض مراجعة الرواتب. بقيت حالة التشغيل دون تغيير.';
  }
  return errMsg(r);
}

/**
 * رؤية زر الترحيل — مرآة لمنطق صفحة تفاصيل التشغيل (بلا React).
 * لا تدّعي تغطية RTL؛ للاختبارات النقية فقط.
 */
export function postingButtonVisibility(input: {
  canPostCap: boolean;
  isApproved: boolean;
  isPosted: boolean;
  can_post?: boolean | null;
  readiness?: boolean | null;
  postingBusy?: boolean;
  decisionBusy?: boolean;
}): { showEnabled: boolean; showDisabled: boolean; hidden: boolean } {
  const {
    canPostCap,
    isApproved,
    isPosted,
    can_post,
    readiness,
    postingBusy = false,
    decisionBusy = false,
  } = input;
  const showEnabled =
    canPostCap &&
    isApproved &&
    !isPosted &&
    can_post !== false &&
    readiness !== false &&
    !postingBusy &&
    !decisionBusy;
  const showDisabled =
    canPostCap &&
    isApproved &&
    !isPosted &&
    (can_post === false || readiness === false);
  return {
    showEnabled,
    showDisabled,
    hidden: !showEnabled && !showDisabled,
  };
}

/** رسائل أخطاء ترحيل الرواتب 9.C.2 */
export function postingErrorMsg(r: any): string {
  const code = r?.error?.code || r?.code;
  if (r?.__status === 403 || code === 'FORBIDDEN') {
    return 'ليس لديك صلاحية ترحيل الرواتب محاسبيًا.';
  }
  if (r?.__status === 404 || code === 'PAYROLL_RUN_NOT_FOUND') {
    return 'تعذر العثور على تشغيل الرواتب أو لا تملك صلاحية الوصول إليه.';
  }
  if (code === 'STALE_PAYROLL_RUN' || (r?.__status === 409 && String(r?.message || '').includes('مستخدم آخر'))) {
    return 'تم تعديل تشغيل الرواتب بواسطة مستخدم آخر. يرجى تحديث الصفحة.';
  }
  if (code === 'PAYROLL_ALREADY_POSTED') {
    return 'تم ترحيل تشغيل الرواتب مسبقًا.';
  }
  if (
    code === 'PAYROLL_POSTING_CONFLICT' ||
    code === 'IDEMPOTENCY_CONFLICT' ||
    code === 'PAYROLL_POSTING_INTEGRITY_CONFLICT'
  ) {
    return 'تعذر تنفيذ الترحيل بسبب عملية متزامنة. يرجى تحديث الصفحة.';
  }
  if (code === 'PAYROLL_APPROVAL_INTEGRITY_FAILED') {
    return 'تعذر التحقق من اعتماد تشغيل الرواتب.';
  }
  if (code === 'PAYROLL_SNAPSHOT_INVALID') {
    return 'تغيرت أو تعذر التحقق من نتائج الرواتب المعتمدة.';
  }
  if (code === 'FISCAL_PERIOD_NOT_OPEN' || code === 'INVALID_POSTING_DATE' || code === 'GL_PERIOD_LOCKED') {
    return 'الفترة المالية المحددة غير مفتوحة للترحيل.';
  }
  if (code === 'PAYROLL_GL_MAPPING_MISSING') {
    return 'يجب إكمال ربط مكونات الرواتب بالحسابات المحاسبية قبل الترحيل.';
  }
  if (code === 'PAYROLL_GL_ACCOUNT_INVALID') {
    return 'أحد الحسابات المحاسبية المطلوبة غير صالح أو غير نشط.';
  }
  if (code === 'PAYROLL_JOURNAL_UNBALANCED') {
    return 'تعذر إنشاء قيد متوازن من نتائج الرواتب الحالية.';
  }
  if (code === 'PAYROLL_ROUNDING_EXCEEDED' || code === 'PAYROLL_ROUNDING_ACCOUNT_MISSING') {
    return 'فرق التقريب يتجاوز الحد المسموح أو حساب التقريب غير معرف.';
  }
  if (r?.__status === 500 || code === 'TECHNICAL_FAILURE') {
    return 'حدث خطأ تقني أثناء ترحيل الرواتب. لم يتم إنشاء أي قيد وبقي التشغيل معتمدًا.';
  }
  if (r?.__status === 409) {
    return r?.error?.message || r?.message || 'تعذر تنفيذ الترحيل بسبب عملية متزامنة. يرجى تحديث الصفحة.';
  }
  if (r?.__status === 422) {
    return r?.error?.message || r?.message || 'تعذر ترحيل الرواتب بسبب إعدادات التشغيل الحالية.';
  }
  return errMsg(r);
}

/** صلاحيات الرواتب (يجب أن تطابق PAYROLL_CAPABILITIES في الخادم). */
export const CAP = {
  VIEW: 'payroll_view',
  MANAGE_PEOPLE: 'payroll_manage_people',
  MANAGE_CONTRACTS: 'payroll_manage_contracts',
  MANAGE_ASSIGNMENTS: 'payroll_manage_assignments',
  MANAGE_COMPONENTS: 'payroll_manage_components',
  MANAGE_MAPPINGS: 'payroll_manage_mappings',
  VIEW_RUNS: 'payroll_view_runs',
  MANAGE_PERIODS: 'payroll_manage_periods',
  CREATE_RUNS: 'payroll_create_runs',
  CALCULATE: 'payroll_calculate',
  RECALCULATE: 'payroll_recalculate',
  SUBMIT_REVIEW: 'payroll_submit_review',
  APPROVE: 'payroll_approve',
  REJECT: 'payroll_reject',
  VIEW_APPROVAL_HISTORY: 'payroll_view_approval_history',
  POST: 'payroll_post',
  CANCEL_RUNS: 'payroll_cancel_runs',
  ADMIN: 'payroll_admin',
} as const;

export function can(caps: string[] | undefined | null, cap: string): boolean {
  return Array.isArray(caps) && caps.includes(cap);
}

export function money(v: unknown): string {
  if (v == null || v === '') return '0.000';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function iqd(v: unknown): string {
  return `${money(v)} د.ع`;
}

/**
 * تنسيق IQD للعرض بعد الاحتساب — بدون كسور عشرية، عبر تقسيم السلسلة (لا Number للمبالغ الكبيرة).
 */
export function iqdWhole(v: unknown): string {
  const raw = String(v ?? '0').trim().replace(/,/g, '');
  if (!raw || raw === '.') return '0 د.ع';
  const neg = raw.startsWith('-');
  const abs = neg ? raw.slice(1) : raw;
  if (!/^\d+(\.\d+)?$/.test(abs)) return `${raw} د.ع`;
  const intPart = abs.split('.')[0] || '0';
  const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${withSep} د.ع`;
}

export const PERSON_TYPE: Record<string, string> = {
  TEACHING_STAFF: 'كادر تدريسي',
  EXTERNAL_LECTURER: 'محاضر خارجي',
  EMPLOYEE: 'موظف',
  DAILY_WORKER: 'عامل يومي',
  SERVICE_WORKER: 'عامل خدمة',
};

export const PERSON_STATUS: Record<string, string> = {
  ACTIVE: 'نشط',
  SUSPENDED: 'موقوف',
  TERMINATED: 'منتهٍ',
  INACTIVE: 'غير نشط',
};

export const COMPENSATION_BASIS: Record<string, string> = {
  MONTHLY_FIXED: 'شهري ثابت',
  HOURLY: 'بالساعة',
  PER_LECTURE: 'بالمحاضرة',
  DAILY: 'يومي',
  FIXED_SERVICE: 'خدمة مقطوعة',
};

export const CONTRACT_STATUS: Record<string, string> = {
  DRAFT: 'مسودة',
  ACTIVE: 'نشط',
  SUSPENDED: 'موقوف',
  TERMINATED: 'منتهٍ',
  EXPIRED: 'منقضٍ',
  CANCELLED: 'ملغى',
};

export const ASSIGNMENT_TYPE: Record<string, string> = {
  TEMPORARY_DUTY: 'تكليف مؤقت',
  ADDITIONAL_RESPONSIBILITY: 'مسؤولية إضافية',
  ALLOWANCE_SOURCE: 'مصدر مخصصات',
  LECTURER_ASSIGNMENT: 'تكليف محاضرة',
  COMMITTEE_ASSIGNMENT: 'تكليف لجنة',
  GENERAL_ASSIGNMENT: 'تكليف عام',
};

export const ASSIGNMENT_STATUS: Record<string, string> = {
  DRAFT: 'مسودة',
  ACTIVE: 'نشط',
  SUSPENDED: 'موقوف',
  ENDED: 'منتهٍ',
};

export const COMPONENT_TYPE: Record<string, string> = {
  EARNING: 'استحقاق',
  DEDUCTION: 'استقطاع',
  EMPLOYER_CONTRIBUTION: 'مساهمة جهة العمل',
};

export const CALCULATION_METHOD: Record<string, string> = {
  FIXED_AMOUNT: 'مبلغ ثابت',
  PERCENTAGE_OF_BASIC: 'نسبة من الأساسي',
  QUANTITY_X_RATE: 'كمية × معدّل',
  DAYS_X_DAILY_RATE: 'أيام × أجر يومي',
  HOURS_X_HOURLY_RATE: 'ساعات × أجر ساعة',
  LECTURES_X_RATE: 'محاضرات × معدّل',
  MANUAL_AMOUNT: 'مبلغ يدوي',
  CUSTOM_FORMULA: 'صيغة مخصصة (محجوز)',
};

export const MAPPING_SCOPE: Record<string, string> = {
  DEFAULT: 'افتراضي',
  PERSON_TYPE: 'حسب نوع الشخص',
  COMPONENT: 'حسب المكوّن',
  CALENDAR: 'حسب التقويم',
  ROUNDING: 'فروقات التقريب',
};

export const CALENDAR_TYPE: Record<string, string> = {
  MONTHLY: 'شهري',
  LECTURER: 'محاضرين',
  DAILY: 'يومي',
  SUMMER: 'صيفي',
  ACADEMIC: 'أكاديمي',
};

export const PAYMENT_METHOD: Record<string, string> = {
  CASH: 'نقدي',
  BANK: 'حوالة مصرفية',
  CHEQUE: 'صك',
  RESERVED: 'محجوز',
};

/** أنواع أساس الاحتساب — 9.A.2.1 (المنفَّذ فقط NONE/CONTRACT_BASIC؛ البقية محجوزة). */
export const CALCULATION_BASE_TYPE: Record<string, string> = {
  NONE: 'بدون أساس',
  CONTRACT_BASIC: 'الأساسي من العقد',
  GROSS_EARNINGS: 'إجمالي الاستحقاقات (محجوز)',
  SELECTED_COMPONENTS: 'مكوّنات مختارة (محجوز)',
  COMPONENT_REFERENCE: 'إشارة لمكوّن (محجوز)',
};

/** حالات فترة الرواتب — 9.A.2.1 */
export const PERIOD_STATUS: Record<string, string> = {
  OPEN: 'مفتوحة',
  PROCESSING: 'قيد المعالجة',
  CLOSED: 'مغلقة',
  CANCELLED: 'ملغاة',
};

/** أنواع تشغيل الرواتب — 9.A.2.1 */
export const RUN_TYPE: Record<string, string> = {
  REGULAR: 'اعتيادي',
  CORRECTION: 'تصحيحي',
  SUPPLEMENTAL: 'تكميلي',
  TERMINATION: 'إنهاء خدمة',
  MANUAL: 'يدوي',
};

/** حالات تشغيل الرواتب — 9.A.2.1 + 9.B */
export const RUN_STATUS: Record<string, string> = {
  DRAFT: 'مسودة',
  CALCULATING: 'قيد الاحتساب',
  CALCULATED: 'محتسَب',
  UNDER_REVIEW: 'قيد المراجعة',
  APPROVED: 'معتمد',
  POSTED: 'مرحّل',
  CANCELLED: 'ملغى',
};

/** أنواع نطاق التشغيل — 9.A.2.1 */
export const SCOPE_TYPE: Record<string, string> = {
  ALL: 'الكل',
  COLLEGE: 'كلية',
  DEPARTMENT: 'قسم',
  COST_CENTER: 'مركز كلفة',
  PERSON_LIST: 'قائمة أشخاص',
};

export function label(map: Record<string, string>, s: string | null | undefined): string {
  if (!s) return '—';
  return map[s] ?? s;
}

export function approvalStatusTransitionLabel(from: string, to: string): string {
  return `${label(RUN_STATUS, from)} → ${label(RUN_STATUS, to)}`;
}

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  ACTIVE: 'bg-green-100 text-green-800',
  SUSPENDED: 'bg-amber-100 text-amber-800',
  TERMINATED: 'bg-red-100 text-red-800',
  ENDED: 'bg-gray-200 text-gray-700',
  EXPIRED: 'bg-gray-200 text-gray-700',
  CANCELLED: 'bg-red-100 text-red-800',
  INACTIVE: 'bg-gray-100 text-gray-500',
  OPEN: 'bg-green-100 text-green-800',
  PROCESSING: 'bg-blue-100 text-blue-800',
  CLOSED: 'bg-gray-200 text-gray-700',
  CALCULATING: 'bg-blue-100 text-blue-800',
  CALCULATED: 'bg-green-100 text-green-800',
  UNDER_REVIEW: 'bg-amber-100 text-amber-900',
  APPROVED: 'bg-emerald-100 text-emerald-900',
  POSTED: 'bg-indigo-100 text-indigo-900',
};

export function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
  const tone = STATUS_TONE[status] ?? 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${tone}`}>
      {label(map, status)}
    </span>
  );
}

export function StatCard({
  label: lbl,
  value,
  href,
  tone,
}: {
  label: string;
  value: string | number;
  href?: string;
  tone?: string;
}) {
  const inner = (
    <>
      <p className="text-sm text-gray-500">{lbl}</p>
      <p className={`text-2xl font-bold mt-1 ${tone ?? 'text-gray-900'}`}>{value}</p>
    </>
  );
  const cls = 'bg-white rounded-xl shadow p-4 block';
  return href ? (
    <a href={href} className={`${cls} hover:ring-2 hover:ring-red-200`}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** حوار تأكيد بسيط للأفعال الحساسة. يدعم سبباً إلزامياً أو تعليقاً اختيارياً. */
export function ConfirmDialog({
  open,
  title,
  message,
  busy,
  onCancel,
  onConfirm,
  reasonRequired,
  reason,
  onReasonChange,
  confirmLabel,
  cancelLabel,
  warning,
  busyLabel,
  reasonLabel,
  reasonPlaceholder,
  reasonHelper,
  reasonMinLength = 1,
  extraWarning,
  commentOptional,
  summaryLines,
  children,
  maxWidthClass = 'max-w-md',
  confirmDisabled,
  confirmTone = 'danger',
}: {
  open: boolean;
  title: string;
  message: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  reasonRequired?: boolean;
  reason?: string;
  onReasonChange?: (v: string) => void;
  confirmLabel?: string;
  cancelLabel?: string;
  warning?: string;
  busyLabel?: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonHelper?: string;
  reasonMinLength?: number;
  extraWarning?: string;
  /** إظهار حقل تعليق اختياري (0–500) */
  commentOptional?: boolean;
  summaryLines?: Array<{ label: string; value: string }>;
  children?: ReactNode;
  maxWidthClass?: string;
  confirmDisabled?: boolean;
  confirmTone?: 'danger' | 'primary';
}) {
  if (!open) return null;
  const trimmed = (reason ?? '').trim();
  const showReasonField = Boolean(reasonRequired || commentOptional);
  const reasonInvalid = reasonRequired
    ? trimmed.length < reasonMinLength || trimmed.length > 500
    : commentOptional
      ? trimmed.length > 500
      : false;
  const confirmBtnClass =
    confirmTone === 'primary'
      ? 'bg-indigo-800 text-white rounded px-3 py-2 text-sm disabled:opacity-50'
      : 'bg-red-800 text-white rounded px-3 py-2 text-sm disabled:opacity-50';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className={`bg-white rounded-lg shadow-lg w-full ${maxWidthClass} p-5 max-h-[90vh] overflow-y-auto`}>
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-3 whitespace-pre-line">{message}</p>
        {warning && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
            {warning}
          </p>
        )}
        {extraWarning && (
          <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded px-3 py-2 mb-4">
            {extraWarning}
          </p>
        )}
        {summaryLines && summaryLines.length > 0 && (
          <dl className="mb-4 grid grid-cols-2 gap-2 text-sm border rounded px-3 py-2 bg-gray-50">
            {summaryLines.map((line) => (
              <div key={line.label} className="contents">
                <dt className="text-gray-500">{line.label}</dt>
                <dd className="font-medium text-gray-900 text-left" dir="ltr">
                  {line.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {children}
        {showReasonField && (
          <div className="mb-4">
            <label className="block text-sm text-gray-700 mb-1">
              {reasonLabel ?? (reasonRequired ? 'السبب (إلزامي)' : 'تعليق (اختياري)')}
            </label>
            <textarea
              className="w-full border rounded px-3 py-2 text-sm"
              rows={3}
              maxLength={500}
              value={reason ?? ''}
              disabled={busy}
              placeholder={reasonPlaceholder ?? 'اذكر سبب هذا الإجراء…'}
              onChange={(e) => onReasonChange?.(e.target.value)}
            />
            {reasonHelper && (
              <p className="text-xs text-gray-500 mt-1">{reasonHelper}</p>
            )}
            {reasonInvalid && (
              <p className="text-xs text-red-600 mt-1">
                {reasonRequired
                  ? `اكتب سبباً واضحاً بين ${reasonMinLength} و 500 حرفاً.`
                  : 'التعليق يجب ألا يتجاوز 500 حرفاً.'}
              </p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="border rounded px-3 py-2 text-sm" disabled={busy} onClick={onCancel}>
            {cancelLabel ?? 'إلغاء'}
          </button>
          <button
            className={confirmBtnClass}
            disabled={busy || reasonInvalid || confirmDisabled}
            onClick={onConfirm}
          >
            {busy ? (busyLabel ?? 'جارٍ التنفيذ…') : (confirmLabel ?? 'تأكيد')}
          </button>
        </div>
      </div>
    </div>
  );
}

export const PERSON_CALC_STATUS: Record<string, string> = {
  CALCULATED: 'تم الاحتساب',
  ERROR: 'خطأ',
  EXCLUDED: 'مستبعد',
  PENDING: 'قيد الانتظار',
};
