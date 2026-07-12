'use client';

import { cashApi, formatIqd } from '../../components/types';

export type CashVoucherType = 'CASH_RECEIPT' | 'CASH_PAYMENT';
export type CashVoucherStatus = 'DRAFT' | 'POSTED' | 'VOID';

export type CashVoucherListItem = {
  id: string;
  voucher_number: string;
  voucher_type: CashVoucherType;
  status: CashVoucherStatus;
  cash_box_id: string;
  cash_box_session_id: string;
  cash_box_code?: string;
  cash_box_name_ar?: string;
  counter_account_id: string;
  counter_account_code?: string;
  counter_account_name_ar?: string;
  voucher_date: string;
  amount: string;
  party_name: string | null;
  description: string;
  journal_entry_id: string | null;
  journal_entry_number?: string | null;
  version: number;
  updated_at: string;
  created_by_name?: string | null;
};

export type CashVoucherDetail = CashVoucherListItem & {
  fiscal_year_id: string;
  fiscal_period_id: string;
  fiscal_year_code?: string;
  fiscal_period_code?: string;
  cost_center_id: string | null;
  cost_center_code?: string | null;
  cost_center_name_ar?: string | null;
  currency_code: string;
  party_reference: string | null;
  external_reference: string | null;
  cash_account_id?: string | null;
  cash_account_code?: string | null;
  cash_account_name_ar?: string | null;
  reversal_journal_entry_id: string | null;
  reversal_journal_entry_number?: string | null;
  posted_at: string | null;
  posted_by: string | null;
  posted_by_name?: string | null;
  voided_at: string | null;
  voided_by: string | null;
  voided_by_name?: string | null;
  void_reason: string | null;
  created_by: string;
  created_at: string;
  created_by_name?: string | null;
};

export type VoucherOptions = {
  cash_boxes: Array<{
    id: string;
    code: string;
    name_ar: string;
    account_id: string | null;
    account_code?: string | null;
    account_name_ar?: string | null;
    currency_code?: string;
  }>;
  open_sessions: Array<{
    id: string;
    cash_box_id: string;
    session_date: string;
    status: string;
    opening_book_balance: string;
  }>;
  posting_accounts: Array<{
    id: string;
    code: string;
    name_ar: string;
    account_type_code: string;
    requires_cost_center: boolean;
  }>;
  cost_centers: Array<{ id: string; code: string; name_ar: string }>;
  voucher_types: Array<{ code: string; name_ar: string }>;
  statuses: Array<{ code: string; name_ar: string }>;
};

export type VoucherStats = {
  total: number;
  draft: number;
  posted: number;
  voided: number;
  receipts_total: string;
  payments_total: string;
  net_movement: string;
};

export { cashApi, formatIqd };

export const VOUCHER_TYPE_LABEL: Record<CashVoucherType, string> = {
  CASH_RECEIPT: 'قبض',
  CASH_PAYMENT: 'صرف',
};

export const VOUCHER_STATUS_LABEL: Record<CashVoucherStatus, string> = {
  DRAFT: 'مسودة',
  POSTED: 'مرحّل',
  VOID: 'ملغى',
};

export function voucherStatusClass(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-amber-100 text-amber-900';
    case 'POSTED':
      return 'bg-green-100 text-green-800';
    case 'VOID':
      return 'bg-gray-200 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  return String(value).slice(0, 10);
}
