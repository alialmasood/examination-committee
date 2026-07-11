'use client';

export type JournalStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'REVIEWED'
  | 'APPROVED'
  | 'POSTED'
  | 'REJECTED'
  | 'REVERSED'
  | 'CANCELLED';

export type JournalEntryListItem = {
  id: string;
  entry_number: string;
  entry_date: string;
  entry_type: string;
  description: string;
  reference_number?: string | null;
  total_debit: string;
  total_credit: string;
  status: JournalStatus;
  version: number;
  created_at: string;
  created_by_username?: string;
  fiscal_year_code?: string;
  fiscal_period_code?: string;
  is_reversal?: boolean;
};

export type JournalLineForm = {
  key: string;
  account_id: string;
  cost_center_id: string;
  description: string;
  debit_amount: string;
  credit_amount: string;
};

export async function accountsApi<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<{ success: boolean; message?: string; data?: T } & Record<string, unknown>> {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  const json = await res.json().catch(() => ({ success: false, message: 'تعذر قراءة الاستجابة' }));
  if (!res.ok) {
    return { ...json, success: false, message: json.message || `خطأ ${res.status}` };
  }
  return json;
}

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'مسودة',
  PENDING_REVIEW: 'بانتظار المراجعة',
  REVIEWED: 'تمت المراجعة',
  APPROVED: 'معتمد',
  POSTED: 'مرحّل',
  REJECTED: 'مرفوض',
  REVERSED: 'معكوس',
  CANCELLED: 'ملغى',
};

export const TYPE_LABEL: Record<string, string> = {
  MANUAL: 'يدوي',
  ADJUSTMENT: 'تسوية',
  REVERSAL: 'عكسي',
  OPENING: 'افتتاحي',
};

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-gray-100 text-gray-800';
    case 'PENDING_REVIEW':
      return 'bg-amber-100 text-amber-900';
    case 'REVIEWED':
      return 'bg-sky-100 text-sky-900';
    case 'APPROVED':
      return 'bg-indigo-100 text-indigo-900';
    case 'POSTED':
      return 'bg-green-100 text-green-900';
    case 'REJECTED':
      return 'bg-red-100 text-red-800';
    case 'REVERSED':
      return 'bg-purple-100 text-purple-900';
    case 'CANCELLED':
      return 'bg-slate-200 text-slate-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function moneyDiff(debit: string, credit: string): string {
  const d = Math.round(Number(debit || 0) * 1000);
  const c = Math.round(Number(credit || 0) * 1000);
  return (Math.abs(d - c) / 1000).toFixed(3);
}

export function sumLines(lines: JournalLineForm[], field: 'debit_amount' | 'credit_amount'): string {
  const total = lines.reduce((s, l) => s + Math.round(Number(l[field] || 0) * 1000), 0);
  return (total / 1000).toFixed(3);
}
