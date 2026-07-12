'use client';

import { cashApi, formatIqd } from '../../components/types';

export type CashTransferStatus =
  | 'DRAFT'
  | 'DISPATCHED'
  | 'RECEIVED'
  | 'CANCELLED';

export type CashTransferListItem = {
  id: string;
  transfer_number: string;
  status: CashTransferStatus;
  source_cash_box_id: string;
  source_session_id: string;
  destination_cash_box_id: string;
  destination_session_id: string | null;
  transfer_date: string;
  amount: string;
  description: string;
  external_reference: string | null;
  source_cash_box_code?: string;
  source_cash_box_name_ar?: string;
  destination_cash_box_code?: string;
  destination_cash_box_name_ar?: string;
  dispatch_journal_entry_id: string | null;
  receipt_journal_entry_id: string | null;
  dispatch_journal_entry_number?: string | null;
  receipt_journal_entry_number?: string | null;
  version: number;
  updated_at: string;
  created_by_name?: string | null;
};

export type CashTransferDetail = CashTransferListItem & {
  fiscal_year_id: string;
  fiscal_year_code?: string;
  dispatch_period_id: string | null;
  receipt_period_id: string | null;
  currency_code: string;
  reversal_journal_entry_id: string | null;
  reversal_journal_entry_number?: string | null;
  dispatched_at: string | null;
  dispatched_by: string | null;
  dispatched_by_name?: string | null;
  received_at: string | null;
  received_by: string | null;
  received_by_name?: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancelled_by_name?: string | null;
  cancellation_reason: string | null;
  created_by: string;
  created_at: string;
  created_by_name?: string | null;
  source_session_date?: string | null;
  destination_session_date?: string | null;
};

export type TransferSessionOption = {
  id: string;
  cash_box_id: string;
  session_date: string;
  status: string;
  opening_book_balance: string;
  expected_balance?: {
    expected_balance: string;
    transfers_out_total?: string;
    transfers_in_total?: string;
  } | null;
};

export type TransferOptions = {
  cash_boxes: Array<{
    id: string;
    code: string;
    name_ar: string;
    status: string;
    account_id: string | null;
    account_code?: string | null;
    account_name_ar?: string | null;
    currency_code?: string;
  }>;
  open_sessions: TransferSessionOption[];
  cash_in_transit_account?: { id: string; code: string; name_ar: string } | null;
  statuses: Array<{ code: string; name_ar: string }>;
};

export type TransferStats = {
  total: number;
  draft: number;
  dispatched: number;
  received: number;
  cancelled: number;
  outbound_total: string;
  inbound_total: string;
};

export { cashApi, formatIqd };

export const TRANSFER_STATUS_LABEL: Record<CashTransferStatus, string> = {
  DRAFT: 'مسودة',
  DISPATCHED: 'قيد النقل',
  RECEIVED: 'مُستلم',
  CANCELLED: 'ملغى',
};

export function transferStatusClass(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-amber-100 text-amber-900';
    case 'DISPATCHED':
      return 'bg-orange-100 text-orange-900';
    case 'RECEIVED':
      return 'bg-green-100 text-green-800';
    case 'CANCELLED':
      return 'bg-gray-200 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  return String(value).slice(0, 10);
}
