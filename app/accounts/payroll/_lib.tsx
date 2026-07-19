/* eslint-disable @typescript-eslint/no-explicit-any */
/** أدوات مشتركة لواجهة الرواتب — 9.A.1 */

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

/** حالات تشغيل الرواتب — 9.A.2.1 */
export const RUN_STATUS: Record<string, string> = {
  DRAFT: 'مسودة',
  CALCULATING: 'قيد الاحتساب',
  CALCULATED: 'محتسَب',
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

/** حوار تأكيد بسيط للأفعال الحساسة. يدعم سبباً إلزامياً (H2). */
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
}) {
  if (!open) return null;
  const reasonEmpty = reasonRequired ? !(reason ?? '').trim() : false;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5">
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-4">{message}</p>
        {reasonRequired && (
          <div className="mb-4">
            <label className="block text-sm text-gray-700 mb-1">السبب (إلزامي)</label>
            <textarea
              className="w-full border rounded px-3 py-2 text-sm"
              rows={3}
              maxLength={500}
              value={reason ?? ''}
              disabled={busy}
              placeholder="اذكر سبب هذا الإجراء…"
              onChange={(e) => onReasonChange?.(e.target.value)}
            />
            {reasonEmpty && <p className="text-xs text-red-600 mt-1">يجب إدخال سبب واضح قبل التأكيد.</p>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="border rounded px-3 py-2 text-sm" disabled={busy} onClick={onCancel}>إلغاء</button>
          <button
            className="bg-red-800 text-white rounded px-3 py-2 text-sm disabled:opacity-50"
            disabled={busy || reasonEmpty}
            onClick={onConfirm}
          >
            {busy ? 'جارٍ التنفيذ…' : 'تأكيد'}
          </button>
        </div>
      </div>
    </div>
  );
}
