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
  vouchers?: Array<{
    id: string;
    voucher_number: string;
    voucher_type: 'CASH_RECEIPT' | 'CASH_PAYMENT';
    status: string;
    amount: string;
    party_name: string | null;
    description: string;
    journal_entry_id: string | null;
  }>;
  expected_balance?: {
    opening_book_balance: string;
    posted_receipts_total: string;
    posted_payments_total: string;
    expected_balance: string;
    current_book_balance: string;
  } | null;
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

export type CashCountAdjustmentView = {
  id: string;
  cash_count_id: string;
  cash_box_session_id: string;
  cash_box_id: string;
  direction: 'GAIN' | 'LOSS';
  variance_amount: string;
  original_signed_variance: string;
  cash_account_id: string;
  variance_account_id: string;
  gain_account_id: string | null;
  loss_account_id: string | null;
  journal_entry_id: string | null;
  journal_entry_number?: string | null;
  status: 'CREATED' | 'POSTED';
  created_by: string;
  posted_by: string | null;
  created_at: string;
  posted_at: string | null;
  updated_at: string;
  version: number;
  notes: string | null;
  cash_account_code?: string | null;
  cash_account_name_ar?: string | null;
  variance_account_code?: string | null;
  variance_account_name_ar?: string | null;
  posted_by_name?: string | null;
  created_by_name?: string | null;
};

export type CashVarianceSettingsView = {
  cash_variance_gain_account_id: string | null;
  cash_variance_loss_account_id: string | null;
};

export type AccountLabel = {
  id: string;
  code: string;
  name_ar: string;
};

export { cashApi, formatIqd };

export const SESSION_STATUS_LABEL: Record<CashSessionStatus, string> = {
  OPEN: 'مفتوحة',
  CLOSING: 'قيد الإغلاق',
  CLOSED: 'مغلقة',
};

export const ADJUSTMENT_DIRECTION_LABEL: Record<'GAIN' | 'LOSS', string> = {
  GAIN: 'زيادة',
  LOSS: 'عجز',
};

export const ADJUSTMENT_STATUS_LABEL: Record<'CREATED' | 'POSTED', string> = {
  CREATED: 'قيد الإنشاء',
  POSTED: 'مرحّلة',
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

export function accountLabel(
  accounts: AccountLabel[] | undefined,
  id: string | null | undefined
): string {
  if (!id) return '—';
  const a = accounts?.find((x) => x.id === id);
  return a ? `${a.code} — ${a.name_ar}` : shortId(id);
}

/** فرق الجرد للعرض: المعدود − الدفتري */
export function computeVariance(
  counted: string,
  book: string
): { variance: string; isZero: boolean; isGain: boolean; isLoss: boolean } {
  const v = moneyNum(counted) - moneyNum(book);
  const variance = v.toFixed(3);
  return {
    variance,
    isZero: Math.abs(v) < 0.0005,
    isGain: v > 0.0005,
    isLoss: v < -0.0005,
  };
}

export function mapAdjustVarianceError(message: string | undefined): string {
  const m = message || 'تعذر إنشاء قيد التسوية';
  if (m.includes('حسابات فروقات') || m.includes('فروقات الجرد')) {
    return 'إعدادات حسابات فروقات الجرد غير مكتملة. راجع إعدادات الصناديق.';
  }
  if (
    m.includes('تسوية سابقة') ||
    m.includes('تسوية مرحّلة') ||
    m.includes('موجودة مسبقاً')
  ) {
    return 'توجد تسوية سابقة لهذا الجرد.';
  }
  if (
    m.includes('بعد الجرد') ||
    m.includes('بعد قيد التسوية') ||
    m.includes('حركة مالية')
  ) {
    return 'ظهرت حركة مالية بعد الجرد — أعد الجرد قبل التسوية أو الإغلاق.';
  }
  if (
    m.includes('إصدار') ||
    m.includes('version') ||
    m.includes('مستخدم آخر') ||
    m.includes('تعارض') ||
    m.includes('إعادة التحميل')
  ) {
    return 'تغيرت البيانات بواسطة مستخدم آخر — حدّث الصفحة ثم أعد المحاولة.';
  }
  if (m.includes('فرق') && (m.includes('صفر') || m.includes('صفراً'))) {
    return 'لا توجد حاجة لتسوية — الفرق صفري.';
  }
  return m.includes('تعذر') ? m : `تعذر إنشاء قيد التسوية: ${m}`;
}

export function closeChecklist(
  session: CashSessionDetail,
  postedAdjustment?: CashCountAdjustmentView | null
): {
  ok: boolean;
  items: Array<{ label: string; pass: boolean }>;
} {
  const count = session.current_count;
  const closing = session.status === 'CLOSING';
  const varianceOk = Boolean(count && isZeroMoney(count.variance_amount));
  const adjusted =
    Boolean(count) &&
    Boolean(postedAdjustment) &&
    postedAdjustment!.status === 'POSTED' &&
    postedAdjustment!.cash_count_id === count!.id &&
    !isZeroMoney(count!.variance_amount);

  const balanceMatchesCounted = Boolean(
    count &&
      session.current_book_balance != null &&
      Math.abs(moneyNum(session.current_book_balance) - moneyNum(count.counted_amount)) <
        0.0005
  );

  const noDriftOnZeroPath = Boolean(
    count &&
      session.current_book_balance != null &&
      Math.abs(
        moneyNum(session.current_book_balance) - moneyNum(count.book_balance_at_count)
      ) < 0.0005
  );

  const pathOk = varianceOk ? noDriftOnZeroPath : adjusted && balanceMatchesCounted;

  const items = [
    {
      label: varianceOk
        ? 'لا يوجد فرق جرد'
        : 'تسوية فرق الجرد مرحّلة (أو فرق صفر)',
      pass: varianceOk || adjusted,
    },
    {
      label: varianceOk
        ? 'لا توجد حركة مالية مرحلة بعد الجرد'
        : 'الرصيد الدفتري يطابق المبلغ المعدود بعد التسوية',
      pass: pathOk,
    },
    { label: 'الجلسة في حالة CLOSING', pass: closing },
  ];
  return { ok: items.every((i) => i.pass), items };
}
