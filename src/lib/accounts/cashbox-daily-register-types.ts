/**
 * أنواع ومساعدات سجل يومية الصندوق — آمنة للاستيراد من Client Components
 * (بدون اعتماد على pg / db).
 */

export type CashboxDocType = 'receipt' | 'payment' | '';

export type CashboxRegisterFilters = {
  search?: string;
  department?: string;
  stage?: string;
  docType?: CashboxDocType;
  dateFrom?: string;
  dateTo?: string;
};

export type CashboxRegisterRow = {
  id: string;
  seq: number;
  cash_received: number;
  bank_deposit: number | null;
  statement: string;
  doc_type: 'receipt' | 'payment';
  doc_type_label: string;
  doc_date: string;
  doc_number: string;
  check_date: string | null;
  check_number: string | null;
  department: string;
  stage: string;
  stage_label: string;
  study_type: string;
  study_type_label: string;
  university_id: string;
  student_id: string;
  notes: string;
  pay_amount: number;
  fee_year: number | null;
  created_at: string | null;
};

export type CashboxRegisterData = {
  generated_at: string;
  title: string;
  filters: CashboxRegisterFilters;
  rows: CashboxRegisterRow[];
  totals: {
    count: number;
    cash_received: number;
    bank_deposit: number;
  };
  departments: string[];
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** بداية/نهاية الأسبوع الحالي (الاثنين → الأحد) */
export function currentWeekRange(ref = new Date()): { from: string; to: string } {
  const d = new Date(ref);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay(); // 0=أحد
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: ymd(monday), to: ymd(sunday) };
}

/** الشهر الحالي */
export function currentMonthRange(ref = new Date()): { from: string; to: string } {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const from = new Date(y, m, 1);
  const to = new Date(y, m + 1, 0);
  return { from: ymd(from), to: ymd(to) };
}
