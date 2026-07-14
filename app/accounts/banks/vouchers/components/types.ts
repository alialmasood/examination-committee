'use client';

import { bankApi, formatMoney } from '../../components/types';

export type BankVoucherType = 'BANK_RECEIPT' | 'BANK_PAYMENT';
export type BankVoucherStatus = 'DRAFT' | 'POSTED' | 'VOID';

export type BankVoucherListItem = {
  id: string;
  voucher_number: string;
  voucher_type: BankVoucherType;
  status: BankVoucherStatus;
  bank_account_id: string;
  bank_account_code?: string;
  bank_account_name_ar?: string;
  bank_code?: string | null;
  bank_name_ar?: string | null;
  branch_code?: string | null;
  branch_name_ar?: string | null;
  counter_account_id: string;
  counter_account_code?: string;
  counter_account_name_ar?: string;
  voucher_date: string;
  value_date?: string | null;
  amount: string;
  currency_code: string;
  party_name: string | null;
  bank_reference?: string | null;
  description: string;
  journal_entry_id: string | null;
  journal_entry_number?: string | null;
  version: number;
  updated_at: string;
  created_by_name?: string | null;
};

export type BankBookBalance = {
  bank_account_id: string;
  gl_account_id: string;
  currency_code: string;
  book_balance: string;
  source: string;
  totals: {
    bank_receipts_posted: string;
    bank_payments_posted: string;
    other_posted_net: string;
  };
  counts: {
    draft: number;
    posted: number;
    void: number;
  };
};

export type BankVoucherDetail = BankVoucherListItem & {
  fiscal_year_id: string;
  fiscal_period_id: string;
  fiscal_year_code?: string;
  fiscal_period_code?: string;
  cost_center_id: string | null;
  cost_center_code?: string | null;
  cost_center_name_ar?: string | null;
  party_reference: string | null;
  external_reference: string | null;
  bank_account_number?: string | null;
  bank_account_iban?: string | null;
  bank_account_iban_normalized?: string | null;
  bank_account_currency?: string;
  bank_account_status?: string;
  bank_id?: string;
  gl_account_id?: string;
  gl_account_code?: string | null;
  gl_account_name_ar?: string | null;
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
  book_balance?: BankBookBalance | null;
};

export type BankVoucherOptions = {
  bank_accounts: Array<{
    id: string;
    code: string;
    account_name_ar: string;
    bank_id: string;
    bank_branch_id?: string | null;
    currency_code: string;
    gl_account_id: string;
    account_number?: string;
    iban?: string | null;
    allows_receipts: boolean;
    allows_payments: boolean;
    bank_code?: string;
    bank_name_ar?: string;
    branch_code?: string | null;
    branch_name_ar?: string | null;
    gl_account_code?: string;
    gl_account_name_ar?: string;
  }>;
  posting_accounts: Array<{
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
  voucher_types: Array<{ code: string; name_ar: string }>;
  statuses: Array<{ code: string; name_ar: string }>;
  book_balance?: BankBookBalance | null;
};

export type BankVoucherStats = {
  total: number;
  draft: number;
  posted: number;
  voided: number;
  receipts_total: string;
  payments_total: string;
  net_movement: string;
};

export { bankApi, formatMoney };

export const VOUCHER_TYPE_LABEL: Record<BankVoucherType, string> = {
  BANK_RECEIPT: 'قبض مصرفي',
  BANK_PAYMENT: 'صرف مصرفي',
};

export const VOUCHER_STATUS_LABEL: Record<BankVoucherStatus, string> = {
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

/** إظهار آخر 4 أرقام فقط من رقم الحساب */
export function maskAccountNumber(value: string | null | undefined): string {
  if (!value) return '—';
  const s = String(value).replace(/\s+/g, '');
  if (s.length <= 4) return s;
  return `•••• ${s.slice(-4)}`;
}

export function formatIbanDisplay(value: string | null | undefined): string {
  if (!value) return '—';
  const s = String(value).replace(/\s+/g, '').toUpperCase();
  return s.replace(/(.{4})/g, '$1 ').trim();
}

const ONES = [
  '',
  'واحد',
  'اثنان',
  'ثلاثة',
  'أربعة',
  'خمسة',
  'ستة',
  'سبعة',
  'ثمانية',
  'تسعة',
  'عشرة',
  'أحد عشر',
  'اثنا عشر',
  'ثلاثة عشر',
  'أربعة عشر',
  'خمسة عشر',
  'ستة عشر',
  'سبعة عشر',
  'ثمانية عشر',
  'تسعة عشر',
];
const TENS = [
  '',
  '',
  'عشرون',
  'ثلاثون',
  'أربعون',
  'خمسون',
  'ستون',
  'سبعون',
  'ثمانون',
  'تسعون',
];
const HUNDREDS = [
  '',
  'مائة',
  'مائتان',
  'ثلاثمائة',
  'أربعمائة',
  'خمسمائة',
  'ستمائة',
  'سبعمائة',
  'ثمانمائة',
  'تسعمائة',
];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  if (!o) return TENS[t];
  return `${ONES[o]} و${TENS[t]}`;
}

function threeDigits(n: number): string {
  if (n < 100) return twoDigits(n);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (!rest) return HUNDREDS[h];
  return `${HUNDREDS[h]} و${twoDigits(rest)}`;
}

function scaleWord(n: number, singular: string, dual: string, plural: string): string {
  if (n === 0) return '';
  if (n === 1) return singular;
  if (n === 2) return dual;
  if (n >= 3 && n <= 10) return `${threeDigits(n)} ${plural}`;
  return `${threeDigits(n)} ${singular}`;
}

function integerToArabicWords(n: number): string {
  if (n === 0) return 'صفر';
  if (n < 1000) return threeDigits(n);

  const billions = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  if (billions) {
    parts.push(scaleWord(billions, 'مليار', 'ملياران', 'مليارات'));
  }
  if (millions) {
    parts.push(scaleWord(millions, 'مليون', 'مليونان', 'ملايين'));
  }
  if (thousands) {
    if (thousands === 1) parts.push('ألف');
    else if (thousands === 2) parts.push('ألفان');
    else if (thousands <= 10) parts.push(`${threeDigits(thousands)} آلاف`);
    else parts.push(`${threeDigits(thousands)} ألفاً`);
  }
  if (rest) parts.push(threeDigits(rest));
  return parts.join(' و');
}

/** تحويل مبلغ IQD إلى كلمات عربية (عدد صحيح + فلوس) */
export function amountToArabicWords(
  value: string | number | null | undefined,
  currency = 'IQD'
): string {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '';

  const abs = Math.abs(n);
  const whole = Math.floor(abs + 1e-9);
  const fils = Math.round((abs - whole) * 1000);

  const wholeWords = integerToArabicWords(whole);
  let result =
    currency === 'IQD'
      ? `${wholeWords} دينار عراقي`
      : `${wholeWords} ${currency}`;

  if (fils > 0) {
    result += ` و${integerToArabicWords(fils)} فلس`;
  }
  return `${result} فقط لا غير`;
}
