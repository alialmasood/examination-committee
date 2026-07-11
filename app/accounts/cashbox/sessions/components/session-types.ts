'use client';

import { cashApi, formatIqd } from '../../components/types';

export type CashSessionStatus = 'OPEN' | 'CLOSING' | 'CLOSED';

export type CashCountView = {
  id: string;
  session_id: string;
  sequence_no: number;
  is_current: boolean;
  counted_amount: string;
  book_balance_at_count: string;
  variance_amount: string;
  counted_at: string;
  counted_by: string;
  last_posted_entry_id_at_count: string | null;
  last_posted_entry_at_count: string | null;
  notes: string | null;
};

export type CashSessionListItem = {
  id: string;
  cash_box_id: string;
  cash_box_code?: string;
  cash_box_name_ar?: string;
  fiscal_year_id: string;
  fiscal_period_id: string;
  fiscal_year_code?: string;
  fiscal_period_code?: string;
  session_date: string;
  status: CashSessionStatus;
  primary_custodian_user_id: string;
  primary_custodian_username?: string | null;
  primary_custodian_name?: string | null;
  opened_at: string;
  opening_book_balance: string;
  closed_at?: string | null;
  updated_at: string;
  version: number;
};

export type CashSessionDetail = CashSessionListItem & {
  account_id?: string | null;
  opening_last_posted_entry_id?: string | null;
  opening_last_posted_at?: string | null;
  closed_by?: string | null;
  final_book_balance?: string | null;
  final_counted_amount?: string | null;
  final_variance_amount?: string | null;
  current_count_id?: string | null;
  closing_started_at?: string | null;
  cancel_closing_reason?: string | null;
  notes?: string | null;
  current_book_balance?: string | null;
  current_count?: CashCountView | null;
  counts?: CashCountView[];
};

export type SessionOptions = {
  cash_boxes: Array<{
    id: string;
    code: string;
    name_ar: string;
    status: string;
    account_id: string | null;
    primary_custodian_user_id?: string | null;
    primary_custodian_username?: string | null;
  }>;
  fiscal_years: Array<{
    id: string;
    code: string;
    name_ar?: string;
    status: string;
    start_date: string;
    end_date: string;
  }>;
  fiscal_periods: Array<{
    id: string;
    fiscal_year_id: string;
    code: string;
    name_ar?: string;
    status: string;
    start_date: string;
    end_date: string;
  }>;
  live_sessions: Array<{
    cash_box_id: string;
    session_id: string;
    status: string;
    session_date: string;
  }>;
  session_statuses: string[];
};

export type SessionStats = {
  total: number;
  open: number;
  closing: number;
  closed: number;
};

export { cashApi, formatIqd };

export const SESSION_STATUS_LABEL: Record<CashSessionStatus, string> = {
  OPEN: 'مفتوحة',
  CLOSING: 'قيد الإغلاق',
  CLOSED: 'مغلقة',
};

export function sessionStatusBadgeClass(status: string): string {
  switch (status) {
    case 'OPEN':
      return 'bg-green-100 text-green-800';
    case 'CLOSING':
      return 'bg-amber-100 text-amber-900';
    case 'CLOSED':
      return 'bg-gray-200 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('ar-IQ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

export function moneyNum(value: string | number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function isZeroMoney(value: string | null | undefined): boolean {
  return Math.abs(moneyNum(value)) < 0.0005;
}

/** فرق الجرد للعرض: المعدود − الدفتري */
export function computeVariance(
  counted: string,
  book: string
): { variance: string; isZero: boolean } {
  const v = moneyNum(counted) - moneyNum(book);
  const variance = v.toFixed(3);
  return { variance, isZero: Math.abs(v) < 0.0005 };
}

export function closeChecklist(session: CashSessionDetail): {
  ok: boolean;
  items: Array<{ label: string; pass: boolean }>;
} {
  const count = session.current_count;
  const varianceOk = Boolean(count && isZeroMoney(count.variance_amount));
  const noDrift = Boolean(
    count &&
      session.current_book_balance != null &&
      Math.abs(moneyNum(session.current_book_balance) - moneyNum(count.book_balance_at_count)) <
        0.0005
  );
  const closing = session.status === 'CLOSING';
  const items = [
    { label: 'لا يوجد فرق جرد', pass: varianceOk },
    { label: 'لا توجد حركة مالية مرحلة بعد الجرد', pass: noDrift },
    { label: 'الجلسة في حالة CLOSING', pass: closing },
  ];
  return { ok: items.every((i) => i.pass), items };
}
