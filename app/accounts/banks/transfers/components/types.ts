'use client';

import { bankApi, formatMoney } from '../../components/types';
import type { BankBookBalance } from '../../vouchers/components/types';

export type BankTransferStatus = 'DRAFT' | 'POSTED' | 'VOID';

export type BankTransferListItem = {
  id: string;
  transfer_number: string;
  status: BankTransferStatus;
  source_bank_account_id: string;
  destination_bank_account_id: string;
  transfer_date: string;
  value_date?: string | null;
  amount: string;
  currency_code: string;
  fee_amount: string;
  bank_reference?: string | null;
  external_reference?: string | null;
  description: string;
  journal_entry_id: string | null;
  journal_entry_number?: string | null;
  version: number;
  updated_at: string;
  source_code?: string;
  source_name_ar?: string;
  destination_code?: string;
  destination_name_ar?: string;
  source_bank_code?: string | null;
  source_bank_name_ar?: string | null;
  destination_bank_code?: string | null;
  destination_bank_name_ar?: string | null;
  created_by_name?: string | null;
};

export type BankTransferImpact = {
  source_debit_total: string;
  destination_credit_total: string;
  fee_amount: string;
  currency_code: string;
};

export type BankTransferDetail = BankTransferListItem & {
  fiscal_year_id: string;
  fiscal_period_id: string;
  fiscal_year_code?: string;
  fiscal_period_code?: string;
  fee_expense_account_id: string | null;
  fee_account_code?: string | null;
  fee_account_name_ar?: string | null;
  cost_center_id: string | null;
  cost_center_code?: string | null;
  cost_center_name_ar?: string | null;
  source_account_number?: string | null;
  source_iban?: string | null;
  source_iban_normalized?: string | null;
  source_currency?: string;
  source_status?: string;
  source_gl_account_id?: string;
  source_gl_code?: string | null;
  source_gl_name_ar?: string | null;
  source_branch_code?: string | null;
  source_branch_name_ar?: string | null;
  destination_account_number?: string | null;
  destination_iban?: string | null;
  destination_iban_normalized?: string | null;
  destination_currency?: string;
  destination_status?: string;
  destination_gl_account_id?: string;
  destination_gl_code?: string | null;
  destination_gl_name_ar?: string | null;
  destination_branch_code?: string | null;
  destination_branch_name_ar?: string | null;
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
  impact?: BankTransferImpact | null;
  source_book_balance?: BankBookBalance | null;
  destination_book_balance?: BankBookBalance | null;
};

export type BankTransferAccountOption = {
  id: string;
  code: string;
  account_name_ar: string;
  bank_id: string;
  bank_branch_id?: string | null;
  currency_code: string;
  account_type?: string;
  gl_account_id: string;
  account_number?: string;
  iban?: string | null;
  iban_normalized?: string | null;
  allows_transfers: boolean;
  is_primary?: boolean;
  status?: string;
  bank_code?: string;
  bank_name_ar?: string;
  branch_code?: string | null;
  branch_name_ar?: string | null;
  gl_account_code?: string;
  gl_account_name_ar?: string;
};

export type BankTransferOptions = {
  bank_accounts: BankTransferAccountOption[];
  fee_accounts: Array<{
    id: string;
    code: string;
    name_ar: string;
    account_type_code: string;
    requires_cost_center: boolean;
  }>;
  cost_centers: Array<{ id: string; code: string; name_ar: string }>;
  banks: Array<{
    id: string;
    code: string;
    name_ar: string;
    short_name?: string | null;
    is_active: boolean;
  }>;
  statuses: Array<{ code: string; name_ar: string }>;
  book_balance?: BankBookBalance | null;
};

export type BankTransferStats = {
  total: number;
  draft: number;
  posted: number;
  voided: number;
  transfers_total: string;
  fees_total: string;
  /** اختياري — عند التصفية حسب حساب (صادر/وارد) */
  outbound_total?: string;
  inbound_total?: string;
};

export { bankApi, formatMoney };
export type { BankBookBalance };

export const TRANSFER_STATUS_LABEL: Record<BankTransferStatus, string> = {
  DRAFT: 'مسودة',
  POSTED: 'مرحّل',
  VOID: 'ملغى',
};

export function transferStatusClass(status: string): string {
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

/** إخفاء IBAN مع الإبقاء على أول 4 وآخر 4 أحرف */
export function maskIban(value: string | null | undefined): string {
  if (!value) return '—';
  const s = String(value).replace(/\s+/g, '').toUpperCase();
  if (s.length <= 8) return s;
  return `${s.slice(0, 4)} •••• •••• ${s.slice(-4)}`;
}
