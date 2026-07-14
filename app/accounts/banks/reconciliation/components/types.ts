'use client';

import { bankApi, formatMoney } from '../../components/types';

export type BankStatementStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'RECONCILED'
  | 'CLOSED'
  | 'CANCELLED';

export type LineMatchStatus = 'UNMATCHED' | 'PARTIALLY_MATCHED' | 'MATCHED' | 'EXCLUDED';

export type MatchType = 'MANUAL' | 'REFERENCE' | 'AMOUNT_DATE' | 'SYSTEM_SUGGESTED' | 'ADJUSTMENT';

export type BankStatementListItem = {
  id: string;
  statement_number: string;
  bank_account_id: string;
  external_statement_reference: string | null;
  date_from: string;
  date_to: string;
  opening_balance: string;
  closing_balance: string;
  currency_code: string;
  status: BankStatementStatus;
  notes: string | null;
  imported_file_name: string | null;
  imported_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  reconciled_at?: string | null;
  closed_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  bank_account_code?: string;
  bank_account_name_ar?: string;
  bank_code?: string;
  bank_name_ar?: string;
  created_by_name?: string | null;
  lines_count?: number;
  matched_lines_count?: number;
  unresolved_lines_count?: number;
};

export type BankStatementLine = {
  id: string;
  bank_statement_id: string;
  line_number: number;
  transaction_date: string;
  value_date: string | null;
  description: string;
  bank_reference: string | null;
  debit_amount: string;
  credit_amount: string;
  running_balance: string | null;
  currency_code: string;
  external_line_id: string | null;
  fingerprint: string;
  match_status: LineMatchStatus;
  exclusion_reason: string | null;
  notes: string | null;
  adjustment_journal_entry_id: string | null;
  created_at: string;
  updated_at: string;
  matches?: BankReconciliationMatch[];
};

export type BankStatementDetail = BankStatementListItem & {
  gl_account_id?: string;
  gl_account_code?: string;
  gl_account_name_ar?: string;
  bank_account_currency?: string;
  branch_code?: string | null;
  branch_name_ar?: string | null;
  updated_by_name?: string | null;
  started_by_name?: string | null;
  reconciled_by_name?: string | null;
  closed_by_name?: string | null;
  cancelled_by_name?: string | null;
  lines: BankStatementLine[];
};

export type BankReconciliationMatch = {
  id: string;
  bank_statement_id: string;
  bank_statement_line_id: string;
  journal_entry_id: string;
  journal_entry_line_id: string | null;
  matched_amount: string;
  match_type: MatchType;
  confidence: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  entry_number?: string;
  entry_date?: string;
};

export type BookItem = {
  journal_entry_id: string;
  journal_entry_line_id: string | null;
  gl_line_count: number;
  entry_number: string;
  entry_date: string;
  source_type: string | null;
  source_id: string | null;
  description: string;
  bank_reference: string | null;
  side: 'DEBIT' | 'CREDIT';
  debit_on_bank_gl: string;
  credit_on_bank_gl: string;
  side_amount: string;
  matched_amount: string;
  remaining_amount: string;
};

export type MatchSuggestion = {
  bank_statement_line_id: string;
  journal_entry_id: string;
  journal_entry_line_id: string | null;
  entry_number: string;
  entry_date: string;
  amount: string;
  confidence: number;
  reason: string;
};

export type BankReconciliationSummary = {
  opening_balance: string;
  closing_balance: string;
  total_credits: string;
  total_debits: string;
  statement_movement: string;
  expected_closing: string;
  statement_balance_ok: boolean;
  book_balance_at_date_to: string;
  unmatched_bank_credits: string;
  unmatched_bank_debits: string;
  outstanding_book_debits: string;
  outstanding_book_credits: string;
  adjustments_count: number;
  adjustments_net: string;
  bank_adjusted: string;
  reconciled_book_balance: string;
  difference: string;
  within_tolerance: boolean;
};

export type BankStatementAccountOption = {
  id: string;
  code: string;
  account_name_ar: string;
  bank_id: string;
  bank_branch_id?: string | null;
  currency_code: string;
  account_type?: string;
  gl_account_id: string;
  status?: string;
  bank_code?: string;
  bank_name_ar?: string;
  branch_code?: string | null;
  branch_name_ar?: string | null;
  gl_account_code?: string;
  gl_account_name_ar?: string;
};

export type BankStatementOptions = {
  bank_accounts: BankStatementAccountOption[];
  adjustment_accounts: Array<{
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
};

export type BankStatementStats = {
  total: number;
  draft: number;
  in_progress: number;
  reconciled: number;
  closed: number;
  cancelled: number;
};

export type ParsedCsvLine = {
  row_number: number;
  transaction_date: string | null;
  value_date: string | null;
  description: string;
  bank_reference: string | null;
  debit_amount: string;
  credit_amount: string;
  running_balance: string | null;
  external_line_id: string | null;
  fingerprint: string | null;
  valid: boolean;
  errors: string[];
};

export type PreviewCsvResult = {
  delimiter: ',' | ';';
  header: string[];
  total_rows: number;
  valid_count: number;
  invalid_count: number;
  truncated: boolean;
  warnings: string[];
  rows: ParsedCsvLine[];
};

export type CommitCsvResult = {
  imported: number;
  skipped_duplicate: number;
  invalid: number;
  total_input: number;
};

export { bankApi, formatMoney };

export const STATEMENT_STATUS_LABEL: Record<BankStatementStatus, string> = {
  DRAFT: 'مسودة',
  IN_PROGRESS: 'قيد المعالجة',
  RECONCILED: 'مُسوّى',
  CLOSED: 'مغلق',
  CANCELLED: 'ملغى',
};

export function statementStatusClass(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-amber-100 text-amber-900';
    case 'IN_PROGRESS':
      return 'bg-blue-100 text-blue-900';
    case 'RECONCILED':
      return 'bg-green-100 text-green-800';
    case 'CLOSED':
      return 'bg-gray-200 text-gray-700';
    case 'CANCELLED':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export const MATCH_STATUS_LABEL: Record<LineMatchStatus, string> = {
  UNMATCHED: 'غير مطابق',
  PARTIALLY_MATCHED: 'مطابق جزئياً',
  MATCHED: 'مطابق',
  EXCLUDED: 'مستبعد',
};

export function matchStatusClass(status: string): string {
  switch (status) {
    case 'UNMATCHED':
      return 'bg-red-100 text-red-800';
    case 'PARTIALLY_MATCHED':
      return 'bg-amber-100 text-amber-900';
    case 'MATCHED':
      return 'bg-green-100 text-green-800';
    case 'EXCLUDED':
      return 'bg-gray-200 text-gray-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export const MATCH_TYPE_LABEL: Record<MatchType, string> = {
  MANUAL: 'يدوية',
  REFERENCE: 'بالمرجع',
  AMOUNT_DATE: 'بالمبلغ والتاريخ',
  SYSTEM_SUGGESTED: 'مقترحة آلياً',
  ADJUSTMENT: 'تسوية آلية',
};

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

/** الجانب الفعّال لسطر كشف (مدين أو دائن) بحسب المبلغ الموجب */
export function lineSide(line: BankStatementLine): { side: 'DEBIT' | 'CREDIT'; amount: string } {
  const debit = Number(line.debit_amount) || 0;
  if (debit > 0) return { side: 'DEBIT', amount: line.debit_amount };
  return { side: 'CREDIT', amount: line.credit_amount };
}

export function remainingOnLine(line: BankStatementLine, matchedTotal: string | number): string {
  const { amount } = lineSide(line);
  const remaining = Number(amount) - Number(matchedTotal || 0);
  return remaining > 0 ? remaining.toFixed(3) : '0.000';
}

/**
 * نسخة عرض فقط من حماية CSV Injection (مطابقة لـ sanitizeExportCell في bank-statement-csv.ts)
 * — تُستخدم في صفحات الطباعة/العرض لحقول قد تكون مستوردة من CSV، دون استيراد كود الخادم للعميل.
 */
export function sanitizeDisplayCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s)) return `'${s}`;
  return s;
}
