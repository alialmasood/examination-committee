'use client';

export type AccountType = {
  id: string;
  code: string;
  name_ar: string;
  name_en?: string | null;
  normal_balance: 'DEBIT' | 'CREDIT';
};

export type ChartAccount = {
  id: string;
  code: string;
  name_ar: string;
  name_en?: string | null;
  account_type_id: string;
  account_type_code?: string;
  account_type_name_ar?: string;
  parent_id?: string | null;
  level: number;
  is_group: boolean;
  allow_posting: boolean;
  normal_balance: 'DEBIT' | 'CREDIT';
  requires_cost_center: boolean;
  is_active: boolean;
  description?: string | null;
  source?: 'SYSTEM' | 'USER';
  sort_order?: number;
  children_count?: number;
  children?: ChartAccount[];
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

export function balanceLabel(v: string): string {
  return v === 'DEBIT' ? 'مدين' : v === 'CREDIT' ? 'دائن' : v;
}
