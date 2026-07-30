/**
 * تجميع بيانات تصدير جدول حسابات الطلبة (Excel / PDF).
 */
import { query } from '@/src/lib/db';
import {
  buildYearLedger,
  getYearVisualEntries,
  paymentCategoryFromYearStatus,
  type FeeYear,
  type SettlementHistoryRow,
} from '@/app/accounts/students/lib/settlementYearLedger';
import {
  expectedAnnualFee,
  getAnnualTuitionFee,
} from '@/app/accounts/students/lib/tuitionFees';

export type StudentExportFilters = {
  search?: string;
  department?: string;
  stage?: string;
  studyType?: string;
  /** settled = مسدّدون · partial = تسديد جزئي · unpaid = غير مسدّدين */
  paymentStatus?: 'settled' | 'partial' | 'unpaid' | '';
  /** تقييم حالة التسديد لسنة قسط محددة (1–4)؛ فارغ = السنة الجارية */
  feeYear?: FeeYear | '' | null;
};

export type StudentExportRow = {
  id: string;
  university_id: string;
  name: string;
  department: string;
  stage: string;
  study_type: string;
  annual_fee: number;
  discount_amount: number;
  discount_type: string;
  net_fee: number;
  paid_current_year: number;
  remaining_current_year: number;
  total_collected: number;
  receipts_count: number;
  current_year: number | null;
  status_label: string;
};

export type DepartmentTotals = {
  department: string;
  students: number;
  annual_fee: number;
  discount_amount: number;
  net_fee: number;
  paid_current_year: number;
  remaining_current_year: number;
  total_collected: number;
  receipts_count: number;
};

export type StudentExportData = {
  generated_at: string;
  rows: StudentExportRow[];
  departments: DepartmentTotals[];
  totals: DepartmentTotals;
};

const STAGE_LABELS: Record<string, string> = {
  first: 'الأولى',
  second: 'الثانية',
  third: 'الثالثة',
  fourth: 'الرابعة',
};

const CHANNEL_LABELS: Record<string, string> = {
  general: 'قبول عام',
  martyrs: 'ذوي الشهداء',
  social_care: 'الرعاية الاجتماعية',
  siblings_married: 'أشقاء / متزوجون',
  top_students: 'أوائل',
  health_ministry: 'وزارة الصحة',
};

type SettlementDiscountInfo = {
  amount: number;
  mode: 'none' | 'amount' | 'percent';
  input: number;
  feeYear: number | null;
  label: string;
};

function receiptTime(row: SettlementHistoryRow): number {
  const a = Date.parse(String(row.created_at || ''));
  if (Number.isFinite(a)) return a;
  const b = Date.parse(String(row.settlement_date || ''));
  return Number.isFinite(b) ? b : 0;
}

function feeYearOf(row: SettlementHistoryRow): number {
  const y = Number(row.fee_year || 1);
  return Math.max(1, Math.min(4, y || 1));
}

/** خصم مودال التسديد المثبت على أول وصل للسنة */
function resolveSettlementDiscount(
  receipts: SettlementHistoryRow[],
  preferredYear: number | null
): SettlementDiscountInfo {
  const empty: SettlementDiscountInfo = {
    amount: 0,
    mode: 'none',
    input: 0,
    feeYear: null,
    label: '',
  };
  if (!receipts.length) return empty;

  const yearsToTry = [
    preferredYear,
    1,
    2,
    3,
    4,
  ].filter((y, i, arr): y is number => !!y && arr.indexOf(y) === i);

  for (const year of yearsToTry) {
    const yearRows = receipts
      .filter((r) => feeYearOf(r) === year)
      .sort((a, b) => receiptTime(a) - receiptTime(b));
    const first = yearRows[0];
    if (!first) continue;

    const modeRaw = String(first.discount_mode || 'none');
    const mode =
      modeRaw === 'amount' || modeRaw === 'percent' ? modeRaw : 'none';
    const amount = Math.max(0, Number(first.discount_amount || 0));
    const input = Math.max(0, Number(first.discount_input || 0));
    if (mode === 'none' || amount <= 0) continue;

    const label =
      mode === 'percent'
        ? `تسديد: خصم بنسبة ${input}% (السنة ${year})`
        : `تسديد: خصم بمبلغ ${Math.round(amount).toLocaleString('en-US')} (السنة ${year})`;

    return { amount, mode, input, feeYear: year, label };
  }

  return empty;
}

function stageLabel(value?: string | null): string {
  return STAGE_LABELS[String(value || '')] || 'غير محدد';
}

function studyTypeLabel(value?: string | null): string {
  const v = String(value || '').toLowerCase();
  if (v === 'evening' || v === 'مسائي') return 'مسائي';
  if (v === 'morning' || v === 'صباحي') return 'صباحي';
  return value?.trim() || 'غير محدد';
}

function emptyTotals(department: string): DepartmentTotals {
  return {
    department,
    students: 0,
    annual_fee: 0,
    discount_amount: 0,
    net_fee: 0,
    paid_current_year: 0,
    remaining_current_year: 0,
    total_collected: 0,
    receipts_count: 0,
  };
}

function accumulate(target: DepartmentTotals, row: StudentExportRow): void {
  target.students += 1;
  target.annual_fee += row.annual_fee;
  target.discount_amount += row.discount_amount;
  target.net_fee += row.net_fee;
  target.paid_current_year += row.paid_current_year;
  target.remaining_current_year += row.remaining_current_year;
  target.total_collected += row.total_collected;
  target.receipts_count += row.receipts_count;
}

export function paymentStatusOfRow(
  row: Pick<
    StudentExportRow,
    'current_year' | 'paid_current_year' | 'remaining_current_year'
  >,
  feeYear?: FeeYear | '' | null,
  yearStatus?: {
    current_year: number | null;
    all_completed: boolean;
    years: ReturnType<typeof getYearVisualEntries>;
  } | null
): 'settled' | 'partial' | 'unpaid' {
  if (yearStatus) {
    return paymentCategoryFromYearStatus(yearStatus, feeYear);
  }
  // نفس منطق paymentCategoryFromYearStatus على السنة الجارية
  if (!row.current_year || row.remaining_current_year <= 0.01) return 'settled';
  if (row.paid_current_year > 0.01) return 'partial';
  return 'unpaid';
}

function matchesExportFilters(
  row: StudentExportRow,
  rawAdmissionType: string | null | undefined,
  rawStudyType: string | null | undefined,
  filters?: StudentExportFilters,
  yearStatus?: {
    current_year: number | null;
    all_completed: boolean;
    years: ReturnType<typeof getYearVisualEntries>;
  } | null
): boolean {
  if (!filters) return true;

  if (filters.department && row.department !== filters.department) return false;

  if (filters.stage) {
    const stage = String(rawAdmissionType || '')
      .trim()
      .toLowerCase();
    if (stage !== filters.stage) return false;
  }

  if (filters.studyType) {
    const st = String(rawStudyType || '').toLowerCase();
    if (filters.studyType === 'morning') {
      if (st !== 'morning' && st !== 'صباحي') return false;
    } else if (filters.studyType === 'evening') {
      if (st !== 'evening' && st !== 'مسائي') return false;
    }
  }

  if (filters.paymentStatus) {
    if (
      paymentStatusOfRow(row, filters.feeYear, yearStatus) !==
      filters.paymentStatus
    ) {
      return false;
    }
  }

  const q = (filters.search || '').trim().toLowerCase();
  if (q) {
    const name = row.name.toLowerCase();
    const uni = row.university_id.toLowerCase();
    const dept = row.department.toLowerCase();
    if (!name.includes(q) && !uni.includes(q) && !dept.includes(q)) return false;
  }

  return true;
}

export async function getStudentExportData(
  filters?: StudentExportFilters
): Promise<StudentExportData> {
  await query(`
    ALTER TABLE student_affairs.students
      ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS final_fee_after_discount DECIMAL(12,2) DEFAULT 0
  `).catch(() => undefined);

  const studentsRes = await query(
    `SELECT
       s.id,
       COALESCE(s.university_id, '') AS university_id,
       COALESCE(NULLIF(TRIM(s.full_name_ar), ''), NULLIF(TRIM(s.full_name), ''), '—') AS name,
       COALESCE(s.major, '') AS department,
       s.admission_type,
       s.study_type,
       s.admission_channel,
       COALESCE(s.payment_amount, 0)::float8 AS payment_amount,
       COALESCE(s.discount_percentage, 0)::float8 AS discount_percentage,
       COALESCE(s.discount_amount, 0)::float8 AS discount_amount,
       s.final_fee_after_discount::float8 AS final_fee
     FROM student_affairs.students s
     WHERE COALESCE(NULLIF(TRIM(s.payment_status), ''), 'pending') = 'paid'
     ORDER BY s.major ASC, s.admission_type ASC, s.university_id ASC
     LIMIT 5000`
  );

  const students = studentsRes.rows;
  const studentIds = students.map((s: { id: string }) => s.id);

  const receiptsByStudent = new Map<string, SettlementHistoryRow[]>();
  if (studentIds.length > 0) {
    try {
      const receiptsRes = await query(
        `SELECT
           student_id, id, fee_year, pay_amount, after_discount,
           remaining_amount, annual_fee,
           discount_mode, discount_input, discount_amount,
           settlement_date, created_at
         FROM accounts.student_settlement_receipts
         WHERE student_id = ANY($1::uuid[])`,
        [studentIds]
      );
      for (const row of receiptsRes.rows) {
        const sid = String(row.student_id);
        const list = receiptsByStudent.get(sid) || [];
        list.push(row as SettlementHistoryRow);
        receiptsByStudent.set(sid, list);
      }
    } catch {
      // جدول الوصولات قد لا يكون موجوداً
    }
  }

  const rows: StudentExportRow[] = [];
  const deptMap = new Map<string, DepartmentTotals>();
  const totals = emptyTotals('الإجمالي العام');

  for (const s of students) {
    const department = String(s.department || '').trim() || 'غير محدد';
    const studyType = String(s.study_type || '').toLowerCase();
    const isEvening = studyType === 'evening' || studyType === 'مسائي';

    const annualFee = getAnnualTuitionFee(
      department,
      isEvening ? 'evening' : 'morning'
    );
    const netFeeFromStudent =
      s.final_fee != null && Number(s.final_fee) > 0
        ? Number(s.final_fee)
        : expectedAnnualFee({
            major: department,
            study_type: isEvening ? 'evening' : s.study_type,
            admission_channel: s.admission_channel,
            discount_percentage: s.discount_percentage,
            final_fee_after_discount: s.final_fee,
          });

    const channelDiscountAmount =
      Number(s.discount_amount || 0) > 0
        ? Number(s.discount_amount)
        : Math.max(0, annualFee - netFeeFromStudent);

    const discountPct = Number(s.discount_percentage || 0);
    const channel = String(s.admission_channel || 'general');
    const channelDiscountType =
      channelDiscountAmount <= 0
        ? ''
        : discountPct > 0
          ? `${discountPct}% — ${CHANNEL_LABELS[channel] || channel}`
          : CHANNEL_LABELS[channel] || 'تخفيض مبلغ';

    const receipts = receiptsByStudent.get(s.id) || [];
    const ledger = buildYearLedger(receipts, netFeeFromStudent);
    const yearVisual = getYearVisualEntries(ledger);
    const yearStatus = {
      current_year: ledger.currentYear,
      all_completed: ledger.allYearsCompleted,
      years: yearVisual,
    };

    const selectedFeeYear =
      filters?.feeYear === 1 ||
      filters?.feeYear === 2 ||
      filters?.feeYear === 3 ||
      filters?.feeYear === 4
        ? filters.feeYear
        : null;

    const currentYear = selectedFeeYear ?? ledger.currentYear;
    const currentEntry = currentYear
      ? ledger.years.find((y) => y.year === currentYear) || null
      : null;

    const settlementDiscount = resolveSettlementDiscount(
      receipts,
      selectedFeeYear ?? ledger.currentYear
    );

    const discountParts = [
      channelDiscountType,
      settlementDiscount.label,
    ].filter(Boolean);
    const discountType =
      discountParts.length > 0 ? discountParts.join(' + ') : 'بدون تخفيض';
    const discountAmount =
      channelDiscountAmount + settlementDiscount.amount;

    // المستحق الفعلي للسنة = هدف دفتر التسديد (يشمل خصم المودال إن وُجد)
    const netFee = currentEntry?.target ?? netFeeFromStudent;

    const settlementsTotal = receipts.reduce(
      (sum, r) => sum + Math.max(0, Number(r.pay_amount || 0)),
      0
    );
    const totalCollected =
      settlementsTotal > 0 ? settlementsTotal : Number(s.payment_amount || 0);

    const paidCurrentYear = currentEntry ? currentEntry.paid : 0;
    const remainingCurrentYear = currentEntry
      ? currentEntry.remaining
      : !selectedFeeYear && ledger.allYearsCompleted
        ? 0
        : Math.max(0, netFee - (selectedFeeYear ? 0 : totalCollected));

    const statusLabel = selectedFeeYear
      ? remainingCurrentYear <= 0.01
        ? `السنة ${selectedFeeYear} — مسدّدة`
        : paidCurrentYear > 0.01
          ? `السنة ${selectedFeeYear} — تسديد جزئي`
          : `السنة ${selectedFeeYear} — غير مسدّدة`
      : !ledger.currentYear
        ? 'مسدّد — اكتملت السنوات'
        : remainingCurrentYear <= 0.01
          ? `السنة ${ledger.currentYear} — مسدّدة`
          : paidCurrentYear > 0.01
            ? `السنة ${ledger.currentYear} — تسديد جزئي`
            : `السنة ${ledger.currentYear} — غير مسدّدة`;

    const row: StudentExportRow = {
      id: s.id,
      university_id: String(s.university_id || '').trim() || '—',
      name: String(s.name || '').trim() || '—',
      department,
      stage: stageLabel(s.admission_type),
      study_type: studyTypeLabel(s.study_type),
      annual_fee: annualFee,
      discount_amount: discountAmount,
      discount_type: discountType,
      net_fee: netFee,
      paid_current_year: paidCurrentYear,
      remaining_current_year: remainingCurrentYear,
      total_collected: totalCollected,
      receipts_count: receipts.length,
      current_year: currentYear,
      status_label: statusLabel,
    };

    if (
      !matchesExportFilters(
        row,
        s.admission_type,
        s.study_type,
        filters,
        yearStatus
      )
    ) {
      continue;
    }

    rows.push(row);

    let deptTotals = deptMap.get(department);
    if (!deptTotals) {
      deptTotals = emptyTotals(department);
      deptMap.set(department, deptTotals);
    }
    accumulate(deptTotals, row);
    accumulate(totals, row);
  }

  const departments = Array.from(deptMap.values()).sort((a, b) =>
    a.department.localeCompare(b.department, 'ar')
  );

  return {
    generated_at: new Date().toISOString(),
    rows,
    departments,
    totals,
  };
}
