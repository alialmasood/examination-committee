'use client';

export type FiscalYear = {
  id: string;
  code: string;
  name_ar: string;
  name_en?: string | null;
  start_date: string;
  end_date: string;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  is_default: boolean;
  notes?: string | null;
  periods_count?: number;
};

export type FiscalPeriod = {
  id: string;
  fiscal_year_id: string;
  period_number: number;
  code: string;
  name_ar: string;
  name_en?: string | null;
  start_date: string;
  end_date: string;
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
};

export type CostCenter = {
  id: string;
  code: string;
  name_ar: string;
  name_en?: string | null;
  parent_id?: string | null;
  level: number;
  is_group: boolean;
  is_active: boolean;
  department_id?: string | null;
  department_name_ar?: string | null;
  description?: string | null;
};

export type DocumentSequence = {
  id: string;
  document_type: string;
  fiscal_year_id: string;
  fiscal_year_code?: string;
  prefix: string;
  current_number: number;
  padding_length: number;
  reset_yearly: boolean;
  is_active: boolean;
  preview_next_number?: string;
  start_date?: string;
};

export type SettingsTab = 'years' | 'periods' | 'costCenters' | 'sequences';

export async function accountsFetch<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<{ success: boolean; message?: string; data?: T } & Record<string, unknown>> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({
    success: false,
    message: 'تعذر قراءة استجابة الخادم',
  }));
  if (!res.ok) {
    return {
      ...json,
      success: false,
      message: json.message || `خطأ ${res.status}`,
    };
  }
  return json;
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'ACTIVE':
    case 'OPEN':
      return 'bg-green-100 text-green-800';
    case 'DRAFT':
      return 'bg-yellow-100 text-yellow-800';
    case 'CLOSED':
      return 'bg-gray-200 text-gray-700';
    case 'LOCKED':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    DRAFT: 'مسودة',
    ACTIVE: 'نشطة',
    CLOSED: 'مغلقة',
    OPEN: 'مفتوحة',
    LOCKED: 'مقفلة',
  };
  return map[status] || status;
}

export function dateOnly(value: string): string {
  return String(value).slice(0, 10);
}
