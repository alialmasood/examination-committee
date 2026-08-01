import {
  STUDENT_DEPARTMENTS,
  getAnnualTuitionFee,
  normalizeDeptKey,
} from '@/app/accounts/students/lib/tuitionFees';
import {
  buildYearLedger,
  getYearVisualEntries,
  paymentCategoryFromYearStatus,
  type SettlementHistoryRow,
} from '@/app/accounts/students/lib/settlementYearLedger';
import {
  settlementDiscountForFeeYear,
  sumSettlementDiscountsByYear,
} from '@/app/accounts/students/lib/studentFeeDiscount';
import { loadTuitionFeeMap } from '@/src/lib/accounts/department-tuition-fees';
import { query } from '@/src/lib/db';

type StudentRow = {
  id: string;
  major: string;
  study_type: string | null;
  admission_type: string | null;
  admission_channel: string | null;
  payment_status: string | null;
  payment_amount: number;
  discount_percentage: number | null;
  discount_amount: number | null;
  final_fee_after_discount: number | null;
};

type ReceiptRow = SettlementHistoryRow & {
  student_id?: string;
  pay_amount?: number | string | null;
};

export type DeptFinance = {
  id: string;
  name: string;
  students: number;
  morning: number;
  evening: number;
  collected_amount: number;
  debt_amount: number;
  annual_base_total: number;
  expected_annual_total: number;
  expected_four_years_total: number;
  channel_discount_amount: number;
  settlement_discount_amount: number;
  total_discount_amount: number;
  discounts_count: number;
  collection_rate_percent: number;
};

export type StageFinance = {
  stage: string;
  label: string;
  students: number;
  collected_amount: number;
  debt_amount: number;
  expected_annual_total: number;
};

export type StudentsFinanceSummary = {
  generated_at: string;
  total_students: number;
  departments_count: number;
  departments_with_students: number;
  morning: number;
  evening: number;
  collected_amount: number;
  debt_amount: number;
  collection_rate_percent: number;
  fully_paid_count: number;
  partial_paid_count: number;
  unpaid_count: number;
  receipts_count: number;
  settlements_paid_amount: number;
  discounts_count: number;
  channel_discount_amount: number;
  settlement_discount_amount: number;
  total_discount_amount: number;
  discount_impact_percent: number;
  annual_base_total: number;
  expected_annual_total: number;
  expected_four_years_total: number;
  expected_four_years_base_total: number;
  by_stage: StageFinance[];
  top_departments: DeptFinance[];
  best_paying_departments: DeptFinance[];
  least_departments: DeptFinance[];
  top_debt_departments: DeptFinance[];
  top_discount_departments: DeptFinance[];
  departments: DeptFinance[];
};

const STAGE_ORDER = ['first', 'second', 'third', 'fourth', 'unknown'] as const;

const STAGE_LABELS: Record<string, string> = {
  first: 'المرحلة الأولى',
  second: 'المرحلة الثانية',
  third: 'المرحلة الثالثة',
  fourth: 'المرحلة الرابعة',
  unknown: 'غير محدد',
};

function emptyDept(id: string, name: string): DeptFinance {
  return {
    id,
    name,
    students: 0,
    morning: 0,
    evening: 0,
    collected_amount: 0,
    debt_amount: 0,
    annual_base_total: 0,
    expected_annual_total: 0,
    expected_four_years_total: 0,
    channel_discount_amount: 0,
    settlement_discount_amount: 0,
    total_discount_amount: 0,
    discounts_count: 0,
    collection_rate_percent: 0,
  };
}

function emptyStage(stage: string): StageFinance {
  return {
    stage,
    label: STAGE_LABELS[stage] || stage,
    students: 0,
    collected_amount: 0,
    debt_amount: 0,
    expected_annual_total: 0,
  };
}

function normalizeStage(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (['first', '1', 'الأولى', 'الاولى'].includes(s)) return 'first';
  if (['second', '2', 'الثانية'].includes(s)) return 'second';
  if (['third', '3', 'الثالثة'].includes(s)) return 'third';
  if (['fourth', '4', 'الرابعة'].includes(s)) return 'fourth';
  return 'unknown';
}

function withCollectionRate(dept: DeptFinance): DeptFinance {
  const rate =
    dept.expected_annual_total > 0
      ? Math.round((dept.collected_amount / dept.expected_annual_total) * 1000) / 10
      : 0;
  return { ...dept, collection_rate_percent: rate };
}

/**
 * ملخص مالي شامل لحسابات الطلبة — نفس منطق صفحات الحسابات/العميد.
 */
export async function buildStudentsFinanceSummary(): Promise<StudentsFinanceSummary> {
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
       COALESCE(s.major, '') AS major,
       s.study_type,
       s.admission_type,
       s.admission_channel,
       COALESCE(NULLIF(TRIM(s.payment_status), ''), 'pending') AS payment_status,
       COALESCE(s.payment_amount, 0)::float8 AS payment_amount,
       s.discount_percentage::float8 AS discount_percentage,
       COALESCE(s.discount_amount, 0)::float8 AS discount_amount,
       s.final_fee_after_discount::float8 AS final_fee_after_discount
     FROM student_affairs.students s`
  );

  const students = studentsRes.rows as StudentRow[];
  const studentIds = students.map((s) => s.id);

  const receiptsByStudent = new Map<string, ReceiptRow[]>();
  let receiptsCount = 0;
  let settlementsPaidAmount = 0;

  if (studentIds.length > 0) {
    try {
      const receiptsRes = await query(
        `SELECT
           student_id::text AS student_id,
           COALESCE(fee_year, 1)::int AS fee_year,
           discount_mode,
           discount_channel,
           discount_input,
           COALESCE(discount_amount, 0)::float8 AS discount_amount,
           COALESCE(after_discount, 0)::float8 AS after_discount,
           COALESCE(pay_amount, 0)::float8 AS pay_amount,
           settlement_date,
           created_at
         FROM accounts.student_settlement_receipts
         WHERE student_id = ANY($1::uuid[])`,
        [studentIds]
      );
      receiptsCount = receiptsRes.rows.length;
      for (const row of receiptsRes.rows) {
        settlementsPaidAmount += Number(row.pay_amount || 0);
        const sid = String(row.student_id);
        const list = receiptsByStudent.get(sid) || [];
        list.push(row as ReceiptRow);
        receiptsByStudent.set(sid, list);
      }
    } catch {
      receiptsCount = 0;
      settlementsPaidAmount = 0;
    }
  }

  let morning = 0;
  let evening = 0;
  let collectedAmount = 0;
  let debtAmount = 0;
  let annualBaseTotal = 0;
  let expectedAnnualTotal = 0;
  let expectedFourYearsTotal = 0;
  let discountsCount = 0;
  let fullyPaidCount = 0;
  let partialPaidCount = 0;
  let unpaidCount = 0;
  let channelDiscountTotal = 0;
  let settlementDiscountTotal = 0;

  const byDept = new Map<string, DeptFinance>();
  for (const dept of STUDENT_DEPARTMENTS) {
    byDept.set(normalizeDeptKey(dept.name), emptyDept(dept.id, dept.name));
  }

  const byStage = new Map<string, StageFinance>();
  for (const stage of STAGE_ORDER) {
    byStage.set(stage, emptyStage(stage));
  }

  const feeMap = await loadTuitionFeeMap();

  for (const row of students) {
    const studyType = String(row.study_type || '').toLowerCase();
    const isEvening = studyType === 'evening' || studyType === 'مسائي';
    if (isEvening) evening += 1;
    else morning += 1;

    const major = row.major || '';
    const annualBase = getAnnualTuitionFee(
      major,
      isEvening ? 'evening' : 'morning',
      feeMap
    );

    const receipts = receiptsByStudent.get(row.id) || [];
    const paid = receipts.reduce(
      (sum, r) => sum + Math.max(0, Number(r.pay_amount || 0)),
      0
    );

    // دفتر السنوات — الخصم من وصولات المودال فقط
    const ledger = buildYearLedger(receipts, annualBase);
    const yearVisual = getYearVisualEntries(ledger);
    const category = paymentCategoryFromYearStatus({
      current_year: ledger.currentYear,
      all_completed: ledger.allYearsCompleted,
      years: yearVisual,
    });

    const currentEntry = ledger.currentYear
      ? ledger.years.find((y) => y.year === ledger.currentYear)
      : null;
    // الدين = متبقي السنة الجارية فقط (كما في تلميح البطاقة)
    const debt = currentEntry ? Math.max(0, currentEntry.remaining) : 0;
    const netDue = currentEntry
      ? Math.max(0, currentEntry.target)
      : ledger.allYearsCompleted
        ? 0
        : annualBase;
    const expectedFourYears = ledger.years.reduce(
      (sum, entry) => sum + Math.max(0, entry.target),
      0
    );

    const settlementDiscount = sumSettlementDiscountsByYear(receipts);
    const currentYearDiscount = ledger.currentYear
      ? settlementDiscountForFeeYear(receipts, ledger.currentYear)
      : 0;
    const channelFromReceipt = receipts
      .map((r) =>
        String((r as { discount_channel?: string }).discount_channel || '').trim()
      )
      .find((ch) => ch && ch !== 'general');
    const attributedChannel =
      settlementDiscount > 0.5 && channelFromReceipt ? settlementDiscount : 0;
    const attributedSettlement =
      settlementDiscount > 0.5 && !channelFromReceipt ? settlementDiscount : 0;

    annualBaseTotal += annualBase;
    expectedAnnualTotal += netDue;
    expectedFourYearsTotal += expectedFourYears;
    debtAmount += debt;
    channelDiscountTotal += attributedChannel;
    settlementDiscountTotal += attributedSettlement;

    if (category === 'settled') fullyPaidCount += 1;
    else if (category === 'partial') partialPaidCount += 1;
    else unpaidCount += 1;

    const hasDiscount = settlementDiscount > 0.5 || currentYearDiscount > 0.5;
    if (hasDiscount) discountsCount += 1;

    const key = normalizeDeptKey(major);
    let dept = byDept.get(key);
    if (!dept) {
      dept = emptyDept(`other-${key || 'unknown'}`, major.trim() || 'غير محدد');
      byDept.set(key || 'unknown', dept);
    }

    dept.students += 1;
    if (isEvening) dept.evening += 1;
    else dept.morning += 1;
    dept.collected_amount += paid;
    dept.debt_amount += debt;
    dept.annual_base_total += annualBase;
    dept.expected_annual_total += netDue;
    dept.expected_four_years_total += expectedFourYears;
    dept.channel_discount_amount += attributedChannel;
    dept.settlement_discount_amount += attributedSettlement;
    dept.total_discount_amount += settlementDiscount;
    if (hasDiscount) dept.discounts_count += 1;

    const stageKey = normalizeStage(row.admission_type);
    const stage = byStage.get(stageKey) || byStage.get('unknown')!;
    stage.students += 1;
    stage.collected_amount += paid;
    stage.debt_amount += debt;
    stage.expected_annual_total += netDue;
  }

  // المدفوع الكلي = مجموع pay_amount من وصولات التسديد فقط
  collectedAmount = settlementsPaidAmount;

  const totalDiscountAmount = channelDiscountTotal + settlementDiscountTotal;
  const discountImpactPercent =
    annualBaseTotal > 0
      ? Math.round((totalDiscountAmount / annualBaseTotal) * 1000) / 10
      : 0;

  const departments = Array.from(byDept.values())
    .filter((d) => d.students > 0)
    .map(withCollectionRate)
    .sort((a, b) => b.collected_amount - a.collected_amount);

  const ranked = [...departments].sort((a, b) => {
    if (b.expected_annual_total !== a.expected_annual_total) {
      return b.expected_annual_total - a.expected_annual_total;
    }
    return b.collected_amount - a.collected_amount;
  });

  const topDepartments = ranked.slice(0, 5);
  const leastDepartments = [...ranked].reverse().slice(0, 5);
  const topDebtDepartments = [...departments]
    .filter((d) => d.debt_amount > 0)
    .sort((a, b) => b.debt_amount - a.debt_amount)
    .slice(0, 5);
  const topDiscountDepartments = [...departments]
    .filter((d) => d.total_discount_amount > 0)
    .sort((a, b) => b.total_discount_amount - a.total_discount_amount)
    .slice(0, 8);
  const bestPayingDepartments = [...departments]
    .filter((d) => d.expected_annual_total > 0)
    .sort((a, b) => {
      if (b.collection_rate_percent !== a.collection_rate_percent) {
        return b.collection_rate_percent - a.collection_rate_percent;
      }
      return b.collected_amount - a.collected_amount;
    })
    .slice(0, 5);

  const byStageList = STAGE_ORDER.map((s) => byStage.get(s)!).filter(
    (s) => s.students > 0 || s.stage !== 'unknown'
  );

  const collectionRatePercent =
    expectedAnnualTotal > 0
      ? Math.round((collectedAmount / expectedAnnualTotal) * 1000) / 10
      : 0;

  return {
    generated_at: new Date().toISOString(),
    total_students: students.length,
    departments_count: STUDENT_DEPARTMENTS.length,
    departments_with_students: departments.length,
    morning,
    evening,
    collected_amount: collectedAmount,
    debt_amount: debtAmount,
    collection_rate_percent: collectionRatePercent,
    fully_paid_count: fullyPaidCount,
    partial_paid_count: partialPaidCount,
    unpaid_count: unpaidCount,
    receipts_count: receiptsCount,
    settlements_paid_amount: settlementsPaidAmount,
    discounts_count: discountsCount,
    channel_discount_amount: channelDiscountTotal,
    settlement_discount_amount: settlementDiscountTotal,
    total_discount_amount: totalDiscountAmount,
    discount_impact_percent: discountImpactPercent,
    annual_base_total: annualBaseTotal,
    expected_annual_total: expectedAnnualTotal,
    expected_four_years_total: expectedFourYearsTotal,
    expected_four_years_base_total: annualBaseTotal * 4,
    by_stage: byStageList,
    top_departments: topDepartments,
    best_paying_departments: bestPayingDepartments,
    least_departments: leastDepartments,
    top_debt_departments: topDebtDepartments,
    top_discount_departments: topDiscountDepartments,
    departments,
  };
}
