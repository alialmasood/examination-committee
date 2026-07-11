'use client';

export type CashBoxStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export type CashBoxListItem = {
  id: string;
  code: string;
  name_ar: string;
  name_en?: string | null;
  box_type_code: string;
  box_type_name_ar?: string | null;
  account_id: string | null;
  account_code?: string | null;
  account_name_ar?: string | null;
  status: CashBoxStatus;
  ceiling_amount: string | null;
  book_balance?: string;
  primary_custodian_user_id?: string | null;
  primary_custodian_username?: string | null;
  updated_at: string;
  version: number;
};

export type CashBoxDetail = CashBoxListItem & {
  currency_code: string;
  location_note?: string | null;
  description?: string | null;
  created_at: string;
  opened_at?: string | null;
  closed_at?: string | null;
  custodians?: CashBoxCustodian[];
  primary_custodian?: CashBoxCustodian | null;
};

export type CashBoxCustodian = {
  id: string;
  cash_box_id: string;
  user_id: string;
  role: 'CUSTODIAN' | 'SUPERVISOR';
  is_primary: boolean;
  valid_from: string;
  valid_to: string | null;
  username?: string;
  full_name?: string | null;
  notes?: string | null;
};

export type CashBoxOptions = {
  box_types: Array<{ code: string; name_ar: string; name_en?: string | null }>;
  eligible_accounts: Array<{
    id: string;
    code: string;
    name_ar: string;
    account_type_code: string;
  }>;
  posting_accounts: Array<{
    id: string;
    code: string;
    name_ar: string;
    account_type_code: string;
  }>;
  users: Array<{ id: string; username: string; full_name?: string | null }>;
  statuses: Array<{ code: string; name_ar: string }>;
  custodian_roles: Array<{ code: string; name_ar: string }>;
};

export type CashBoxStats = {
  total: number;
  active: number;
  draft: number;
  suspended: number;
  closed: number;
};

export async function cashApi<T = unknown>(
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

export const STATUS_LABEL: Record<CashBoxStatus, string> = {
  DRAFT: 'مسودة',
  ACTIVE: 'نشط',
  SUSPENDED: 'معلّق',
  CLOSED: 'مغلق',
};

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-green-100 text-green-800';
    case 'DRAFT':
      return 'bg-amber-100 text-amber-900';
    case 'SUSPENDED':
      return 'bg-orange-100 text-orange-900';
    case 'CLOSED':
      return 'bg-gray-200 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

/** تنسيق مبلغ دينار عراقي للعرض */
export function formatIqd(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `${n.toLocaleString('ar-IQ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })} د.ع`;
}

export function canActivateChecklist(box: {
  status: string;
  account_id: string | null;
  box_type_code: string;
  ceiling_amount: string | null;
  primary_custodian_user_id?: string | null;
  primary_custodian?: { id?: string } | null;
}): { ok: boolean; items: Array<{ label: string; pass: boolean }> } {
  const hasPrimary = Boolean(
    box.primary_custodian_user_id || box.primary_custodian?.id
  );
  const ceilingOk =
    box.box_type_code !== 'PETTY' ||
    (box.ceiling_amount != null && Number(box.ceiling_amount) > 0);
  const items = [
    { label: 'الحساب المرتبط صالح', pass: Boolean(box.account_id) },
    { label: 'يوجد أمين أساسي ساري', pass: hasPrimary },
    { label: 'السقف صالح لصندوق النثريات', pass: ceilingOk },
  ];
  return {
    ok: box.status === 'DRAFT' && items.every((i) => i.pass),
    items,
  };
}
