'use client';

export type BankAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type BankAccountType =
  | 'CURRENT'
  | 'SAVINGS'
  | 'DEPOSIT'
  | 'ESCROW'
  | 'OTHER';

export type BankListItem = {
  id: string;
  code: string;
  name_ar: string;
  name_en?: string | null;
  short_name?: string | null;
  swift_code?: string | null;
  country_code?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  notes?: string | null;
  is_active: boolean;
  version: number;
  updated_at: string;
  created_at?: string;
  branches_count?: number;
  accounts_count?: number;
};

export type BankBranchListItem = {
  id: string;
  bank_id: string;
  code: string;
  name_ar: string;
  name_en?: string | null;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  branch_swift_code?: string | null;
  notes?: string | null;
  is_active: boolean;
  version: number;
  updated_at: string;
  bank_code?: string | null;
  bank_name_ar?: string | null;
};

export type BankAccountListItem = {
  id: string;
  code: string;
  bank_id: string;
  bank_branch_id?: string | null;
  account_name_ar: string;
  account_name_en?: string | null;
  account_number: string;
  iban?: string | null;
  iban_display?: string | null;
  currency_code: string;
  gl_account_id: string;
  account_type: BankAccountType;
  status: BankAccountStatus;
  opening_balance_reference?: string | null;
  opening_balance_date?: string | null;
  is_primary: boolean;
  allows_receipts: boolean;
  allows_payments: boolean;
  allows_transfers: boolean;
  allows_cheques: boolean;
  cheque_book_enabled: boolean;
  notes?: string | null;
  version: number;
  updated_at: string;
  created_at?: string;
  bank_code?: string | null;
  bank_name_ar?: string | null;
  bank_short_name?: string | null;
  branch_code?: string | null;
  branch_name_ar?: string | null;
  branch_city?: string | null;
  gl_account_code?: string | null;
  gl_account_name_ar?: string | null;
};

export type BankAccountUser = {
  id: string;
  bank_account_id: string;
  user_id: string;
  can_view: boolean;
  can_prepare: boolean;
  can_post: boolean;
  can_approve: boolean;
  can_reconcile: boolean;
  created_at: string;
  username?: string | null;
  full_name?: string | null;
};

export type BankAccountDetail = BankAccountListItem & {
  users?: BankAccountUser[];
};

export type BankOptions = {
  banks: Array<{
    id: string;
    code: string;
    name_ar: string;
    short_name?: string | null;
    is_active: boolean;
  }>;
  branches: Array<{
    id: string;
    bank_id: string;
    code: string;
    name_ar: string;
    city?: string | null;
    is_active: boolean;
  }>;
  eligible_gl_accounts: Array<{
    id: string;
    code: string;
    name_ar: string;
    account_type_code: string;
  }>;
  users: Array<{ id: string; username: string; full_name?: string | null }>;
  account_types: Array<{ code: string; name_ar: string }>;
  statuses: Array<{ code: string; name_ar: string }>;
  currencies: string[];
};

export type BankStats = {
  total: number;
  active: number;
  inactive: number;
};

export type BankAccountStats = {
  total: number;
  active: number;
  suspended: number;
  closed: number;
  primary: number;
  iqd: number;
  other: number;
};

export async function bankApi<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<{ success: boolean; message?: string; data?: T } & Record<string, unknown>> {
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

export const STATUS_LABEL: Record<BankAccountStatus, string> = {
  ACTIVE: 'نشط',
  SUSPENDED: 'معلّق',
  CLOSED: 'مغلق',
};

export const ACCOUNT_TYPE_LABEL: Record<BankAccountType, string> = {
  CURRENT: 'جاري',
  SAVINGS: 'توفير',
  DEPOSIT: 'وديعة',
  ESCROW: 'أمانات',
  OTHER: 'أخرى',
};

export function statusBadgeClass(status: string): string {
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

export const OPENING_BALANCE_NOTE =
  'رصيد مرجعي لغرض العرض والإعداد ولا يمثل قيداً محاسبياً. القيود المحاسبية تُنشأ عبر العمليات المالية المعتمدة فقط.';
