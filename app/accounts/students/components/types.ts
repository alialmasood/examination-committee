'use client';

export type StudentAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type StudentChargeStatus =
  | 'DRAFT'
  | 'POSTED'
  | 'PARTIALLY_SETTLED'
  | 'SETTLED'
  | 'VOID';

export type StudentAccountListItem = {
  id: string;
  student_id: string;
  account_number: string;
  status: StudentAccountStatus;
  currency_code: string;
  receivable_gl_account_id: string;
  academic_year: string | null;
  notes: string | null;
  version: number;
  updated_at: string;
  student_full_name_ar?: string | null;
  student_university_id?: string | null;
  student_number?: string | null;
  student_major?: string | null;
  student_admission_type?: string | null;
  receivable_gl_code?: string | null;
  receivable_gl_name_ar?: string | null;
  balance?: string;
};

export type StudentAccountDetail = StudentAccountListItem & {
  department_id: string | null;
  opening_reference: string | null;
  suspended_at: string | null;
  closed_at: string | null;
  student?: {
    id: string;
    university_id: string | null;
    student_number: string;
    full_name_ar: string;
    major: string | null;
    admission_type: string | null;
    status: string;
    academic_year: string | null;
  };
};

export type StudentChargeListItem = {
  id: string;
  charge_number: string;
  student_account_id: string;
  student_id: string;
  fee_type_id: string;
  charge_date: string;
  original_amount: string;
  outstanding_amount: string;
  currency_code: string;
  description: string;
  status: StudentChargeStatus;
  version: number;
  updated_at: string;
  journal_entry_id: string | null;
  fee_type_code?: string | null;
  fee_type_name_ar?: string | null;
  account_number?: string | null;
  student_full_name_ar?: string | null;
};

export type StudentFeeTypeItem = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  category: string;
  revenue_gl_account_id: string;
  default_amount: string | null;
  currency_code: string;
  is_tuition: boolean;
  is_refundable: boolean;
  is_active: boolean;
  version: number;
  updated_at: string;
  description: string | null;
};

export type StudentLedgerEntry = {
  id: string;
  entry_date: string;
  entry_type: string;
  source_type: string;
  description: string;
  debit_amount: string;
  credit_amount: string;
  journal_entry_id: string | null;
  charge_number?: string | null;
};

export type StudentAccountSummary = {
  account_id: string;
  balance: string;
  charges_total: string;
  counts: {
    draft: number;
    posted: number;
    void: number;
    partially_settled: number;
    settled: number;
  };
  amounts: {
    draft: string;
    posted: string;
    void: string;
  };
};

export type StudentOptions = {
  students: Array<{
    id: string;
    university_id: string | null;
    student_number: string | null;
    full_name_ar: string | null;
    status: string;
  }>;
  fee_types: Array<{
    id: string;
    code: string;
    name_ar: string;
    category: string;
    default_amount: string | null;
    revenue_gl_account_id: string;
  }>;
  receivable_gl_accounts: Array<{
    id: string;
    code: string;
    name_ar: string;
  }>;
  revenue_gl_accounts: Array<{
    id: string;
    code: string;
    name_ar: string;
  }>;
  fiscal_periods?: Array<{
    id: string;
    fiscal_year_id: string;
    code: string;
    status: string;
    start_date: string;
    end_date: string;
  }>;
};

export type Pagination = {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

export async function studentApi<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<
  { success: boolean; message?: string; data?: T; pagination?: Pagination } & Record<
    string,
    unknown
  >
> {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  const json = await res.json().catch(() => ({
    success: false,
    message: 'تعذر قراءة الاستجابة',
  }));
  if (!res.ok) {
    return { ...json, success: false, message: json.message || `خطأ ${res.status}` };
  }
  return json;
}

export const ACCOUNT_STATUS_LABEL: Record<StudentAccountStatus, string> = {
  ACTIVE: 'نشط',
  SUSPENDED: 'معلّق',
  CLOSED: 'مغلق',
};

export const CHARGE_STATUS_LABEL: Record<StudentChargeStatus, string> = {
  DRAFT: 'مسودة',
  POSTED: 'مرحّل',
  PARTIALLY_SETTLED: 'مسدد جزئياً',
  SETTLED: 'مسدد',
  VOID: 'ملغى',
};

export const FEE_CATEGORY_LABEL: Record<string, string> = {
  TUITION: 'قسط دراسي',
  REGISTRATION: 'تسجيل',
  LAB: 'مختبر',
  EXAM: 'امتحان',
  SERVICE: 'خدمة',
  TRANSPORT: 'نقل',
  ACCOMMODATION: 'سكن',
  OTHER: 'أخرى',
};

export function accountStatusBadge(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-green-100 text-green-800';
    case 'SUSPENDED':
      return 'bg-orange-100 text-orange-900';
    case 'CLOSED':
      return 'bg-gray-200 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function chargeStatusBadge(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-yellow-100 text-yellow-900';
    case 'POSTED':
      return 'bg-green-100 text-green-800';
    case 'VOID':
      return 'bg-gray-200 text-gray-700';
    case 'PARTIALLY_SETTLED':
      return 'bg-blue-100 text-blue-800';
    case 'SETTLED':
      return 'bg-emerald-100 text-emerald-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function formatMoney(
  value: string | number | null | undefined,
  currency = 'IQD'
): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const formatted = n.toLocaleString('ar-IQ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
  return currency === 'IQD' ? `${formatted} د.ع` : `${formatted} ${currency}`;
}

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

// ——— المرحلة 5.B: خطط الرسوم والأقساط والتحصيل ———

export type StudentBillingPlanStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED';

export type StudentInstallmentStatus =
  | 'PENDING'
  | 'DUE'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED';

export type StudentCollectionStatus = 'DRAFT' | 'POSTED' | 'VOID';
export type StudentCollectionPaymentMethod = 'CASH' | 'BANK';

export type StudentBillingPlanListItem = {
  id: string;
  plan_number: string;
  student_account_id: string;
  student_id: string;
  fee_type_id: string;
  academic_year_id: string | null;
  academic_year: string | null;
  fiscal_year_id: string;
  currency_code: string;
  total_amount: string;
  installment_count: number;
  status: StudentBillingPlanStatus;
  description: string;
  external_reference: string | null;
  activated_at: string | null;
  activated_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  fee_type_code?: string | null;
  fee_type_name_ar?: string | null;
  account_number?: string | null;
  student_full_name_ar?: string | null;
};

export type StudentInstallmentItem = {
  id: string;
  billing_plan_id: string;
  student_account_id: string;
  installment_number: number;
  due_date: string;
  amount: string;
  paid_amount: string;
  relief_amount?: string;
  outstanding_amount: string;
  status: StudentInstallmentStatus;
  student_charge_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  plan_number?: string | null;
  charge_number?: string | null;
  account_number?: string | null;
  student_full_name_ar?: string | null;
};

export type StudentBillingPlanDetail = StudentBillingPlanListItem & {
  student_university_id?: string | null;
  installments: StudentInstallmentItem[];
};

export type StudentCollectionListItem = {
  id: string;
  collection_number: string;
  student_account_id: string;
  student_id: string;
  collection_date: string;
  amount: string;
  currency_code: string;
  payment_method: StudentCollectionPaymentMethod;
  cash_box_id: string | null;
  cash_box_session_id: string | null;
  bank_account_id: string | null;
  cash_voucher_id: string | null;
  bank_voucher_id: string | null;
  external_reference: string | null;
  payer_name: string | null;
  description: string;
  status: StudentCollectionStatus;
  fiscal_year_id: string | null;
  fiscal_period_id: string | null;
  posted_at: string | null;
  posted_by: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  account_number?: string | null;
  student_full_name_ar?: string | null;
};

export type StudentCollectionAllocation = {
  id: string;
  collection_id: string;
  student_installment_id: string | null;
  student_charge_id: string;
  allocated_amount: string;
  created_by: string;
  created_at: string;
  charge_number?: string | null;
  installment_number?: number | null;
  installment_due_date?: string | null;
};

export type StudentCollectionDetail = StudentCollectionListItem & {
  student_university_id?: string | null;
  cash_voucher_number?: string | null;
  bank_voucher_number?: string | null;
  allocations: StudentCollectionAllocation[];
};

export type AllocationPreviewRow = {
  student_charge_id: string;
  student_installment_id: string | null;
  charge_number: string | null;
  installment_number: number | null;
  due_date: string | null;
  charge_outstanding: string;
  allocated_amount: string;
};

export type CollectionOptions = {
  cash_boxes: Array<{
    id: string;
    code: string;
    name_ar: string;
    status: string;
    currency_code: string;
  }>;
  open_sessions: Array<{
    id: string;
    cash_box_id: string;
    session_date: string;
    status: string;
    fiscal_year_id: string;
    fiscal_period_id: string;
    cash_box_code: string;
    cash_box_name_ar: string;
  }>;
  bank_accounts: Array<{
    id: string;
    code: string;
    account_name_ar: string;
    bank_id: string;
    bank_code: string;
    bank_name_ar: string;
    currency_code: string;
    allows_receipts: boolean;
    status: string;
  }>;
  payment_methods: Array<{ code: string; name_ar: string }>;
  collection_statuses: Array<{ code: string; name_ar: string }>;
};

export const BILLING_PLAN_API = '/api/accounts/student-billing-plans';
export const INSTALLMENTS_API = '/api/accounts/student-installments';
export const COLLECTIONS_API = '/api/accounts/student-collections';
export const COLLECTION_OPTIONS_API = '/api/accounts/student-collections/options';

export const BILLING_PLAN_STATUS_LABEL: Record<StudentBillingPlanStatus, string> = {
  DRAFT: 'مسودة',
  ACTIVE: 'فعّالة',
  COMPLETED: 'مكتملة',
  CANCELLED: 'ملغاة',
};

export const INSTALLMENT_STATUS_LABEL: Record<StudentInstallmentStatus, string> = {
  PENDING: 'قادم',
  DUE: 'مستحق',
  PARTIALLY_PAID: 'مسدد جزئياً',
  PAID: 'مسدد',
  CANCELLED: 'ملغى',
};

/** تسمية عرض: لا تخلط الإعفاء مع الدفع النقدي */
export function installmentSettlementLabel(inst: {
  status: StudentInstallmentStatus | string;
  paid_amount?: string | null;
  relief_amount?: string | null;
  outstanding_amount?: string | null;
}): string {
  const base =
    INSTALLMENT_STATUS_LABEL[inst.status as StudentInstallmentStatus] ||
    inst.status;
  if (inst.status !== 'PAID') return base;
  const paid = String(inst.paid_amount ?? '0');
  const relief = String(inst.relief_amount ?? '0');
  const paidPos = Number(paid) > 0;
  const reliefPos = Number(relief) > 0;
  if (reliefPos && paidPos) return 'مغلق/مسوّى (دفع + إعفاء)';
  if (reliefPos) return 'مغلق/مسوّى (إعفاء)';
  return 'مسدد';
}

export const COLLECTION_STATUS_LABEL: Record<StudentCollectionStatus, string> = {
  DRAFT: 'مسودة',
  POSTED: 'مرحّل',
  VOID: 'ملغى',
};

export const PAYMENT_METHOD_LABEL: Record<StudentCollectionPaymentMethod, string> = {
  CASH: 'نقدي',
  BANK: 'مصرفي',
};

export function billingPlanStatusBadge(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-yellow-100 text-yellow-900';
    case 'ACTIVE':
      return 'bg-green-100 text-green-800';
    case 'COMPLETED':
      return 'bg-emerald-100 text-emerald-800';
    case 'CANCELLED':
      return 'bg-gray-200 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function installmentStatusBadge(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'bg-blue-100 text-blue-800';
    case 'DUE':
      return 'bg-orange-100 text-orange-900';
    case 'PARTIALLY_PAID':
      return 'bg-amber-100 text-amber-900';
    case 'PAID':
      return 'bg-emerald-100 text-emerald-800';
    case 'CANCELLED':
      return 'bg-gray-200 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function collectionStatusBadge(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-yellow-100 text-yellow-900';
    case 'POSTED':
      return 'bg-green-100 text-green-800';
    case 'VOID':
      return 'bg-gray-200 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function sumMoneyValues(values: Array<string | number | null | undefined>): number {
  let total = 0;
  for (const v of values) {
    const n = Number(v ?? 0);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

// ——— المرحلة 5.C.1: التخفيضات والمنح ———

export type StudentReliefStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'POSTED'
  | 'REJECTED'
  | 'VOID';

export type ReliefKind = 'DISCOUNT' | 'SCHOLARSHIP' | 'WAIVER';
export type ReliefCalculationType = 'FIXED_AMOUNT' | 'PERCENTAGE';

export type StudentReliefTypeItem = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  relief_kind: ReliefKind;
  calculation_type: ReliefCalculationType;
  default_value: string | null;
  max_value: string | null;
  gl_account_id: string;
  requires_approval: boolean;
  is_refundable: boolean;
  is_active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
  gl_code?: string | null;
  gl_name_ar?: string | null;
};

export type StudentReliefListItem = {
  id: string;
  relief_number: string;
  student_account_id: string;
  student_id: string;
  relief_type_id: string;
  student_charge_id: string;
  relief_date: string;
  calculation_type: ReliefCalculationType;
  percentage_value: string | null;
  requested_amount: string;
  approved_amount: string | null;
  currency_code: string;
  reason: string;
  status: StudentReliefStatus;
  version: number;
  updated_at: string;
  journal_entry_id: string | null;
  relief_type_code?: string | null;
  relief_type_name_ar?: string | null;
  account_number?: string | null;
  student_full_name_ar?: string | null;
  charge_number?: string | null;
};

export type StudentReliefDetail = StudentReliefListItem & {
  relief_kind?: string | null;
  billing_plan_id: string | null;
  student_installment_id: string | null;
  external_reference: string | null;
  rejection_reason: string | null;
  void_reason: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  posted_at: string | null;
  voided_at: string | null;
  reversal_journal_entry_id?: string | null;
  charge_outstanding?: string | null;
};

export type ReliefOptions = {
  relief_types: Array<{
    id: string;
    code: string;
    name_ar: string;
    relief_kind: string;
    calculation_type: string;
    default_value: string | null;
    max_value: string | null;
    requires_approval: boolean;
  }>;
  relief_kinds: Array<{ code: string; name_ar: string }>;
  calculation_types: Array<{ code: string; name_ar: string }>;
  statuses: Array<{ code: string; name_ar: string }>;
  expense_gl_accounts: Array<{
    id: string;
    code: string;
    name_ar: string;
    account_type_code: string;
  }>;
};

export const RELIEF_TYPES_API = '/api/accounts/student-relief-types';
export const RELIEFS_API = '/api/accounts/student-reliefs';
export const RELIEF_OPTIONS_API = '/api/accounts/student-reliefs/options';

export const RELIEF_KIND_LABEL: Record<ReliefKind, string> = {
  DISCOUNT: 'خصم',
  SCHOLARSHIP: 'منحة',
  WAIVER: 'إعفاء',
};

export const RELIEF_STATUS_LABEL: Record<StudentReliefStatus, string> = {
  DRAFT: 'مسودة',
  PENDING_APPROVAL: 'بانتظار الاعتماد',
  APPROVED: 'معتمد',
  POSTED: 'مرحّل',
  REJECTED: 'مرفوض',
  VOID: 'ملغى',
};

export function reliefStatusBadge(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-yellow-100 text-yellow-900';
    case 'PENDING_APPROVAL':
      return 'bg-orange-100 text-orange-900';
    case 'APPROVED':
      return 'bg-blue-100 text-blue-800';
    case 'POSTED':
      return 'bg-green-100 text-green-800';
    case 'REJECTED':
      return 'bg-red-100 text-red-900';
    case 'VOID':
      return 'bg-gray-200 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}
