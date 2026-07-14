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
