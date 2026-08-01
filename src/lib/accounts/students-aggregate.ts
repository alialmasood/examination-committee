/**
 * دفتر الحسابات الإجمالية لمستحقات الطلبة.
 * مصدر المحصّل: وصولات التسديد فقط.
 */
import { query } from '@/src/lib/db';
import {
  STUDENT_DEPARTMENTS,
  getAnnualTuitionFee,
  normalizeDeptKey,
} from '@/app/accounts/students/lib/tuitionFees';
import { formatAdmissionChannelLabel } from '@/app/accounts/students/lib/admissionChannels';
import {
  buildYearLedger,
  type FeeYear,
  type SettlementHistoryRow,
} from '@/app/accounts/students/lib/settlementYearLedger';
import { sumSettlementDiscountsByYear } from '@/app/accounts/students/lib/studentFeeDiscount';
import { loadTuitionFeeMap } from '@/src/lib/accounts/department-tuition-fees';

type StudentRow = {
  id: string;
  major: string;
  study_type: string | null;
  admission_type: string | null;
  admission_channel: string | null;
  discount_percentage: number | null;
  discount_amount: number | null;
  final_fee_after_discount: number | null;
};

type ReceiptRow = SettlementHistoryRow & {
  student_id?: string;
  pay_amount?: number | string | null;
};

export type AggregateDeptRow = {
  id: string;
  name: string;
  students: number;
  morning: number;
  evening: number;
  annual_base_total: number;
  discount_amount: number;
  expected_annual_total: number;
  collected_amount: number;
  debt_amount: number;
  receipts_count: number;
  collection_rate_percent: number;
  expected_four_years_total: number;
};

export type AggregateStageRow = {
  stage: string;
  label: string;
  students: number;
  annual_base_total: number;
  discount_amount: number;
  expected_annual_total: number;
  collected_amount: number;
  debt_amount: number;
  receipts_count: number;
};

export type AggregateStudyTypeRow = {
  study_type: 'morning' | 'evening';
  label: string;
  students: number;
  annual_base_total: number;
  discount_amount: number;
  expected_annual_total: number;
  collected_amount: number;
  debt_amount: number;
  receipts_count: number;
};

export type AggregateFeeYearRow = {
  fee_year: FeeYear;
  label: string;
  target_amount: number;
  collected_amount: number;
  remaining_amount: number;
  receipts_count: number;
  students_with_activity: number;
};

export type AggregateDiscountType = {
  key: string;
  label: string;
  kind: 'channel' | 'settlement';
  students_count: number;
  amount: number;
};

export type StudentsAggregateData = {
  generated_at: string;
  equation: {
    annual_base_total: number;
    total_discount_amount: number;
    expected_annual_total: number;
    collected_amount: number;
    debt_amount: number;
    collection_rate_percent: number;
    expected_four_years_total: number;
    expected_four_years_base_total: number;
    channel_discount_amount: number;
    settlement_discount_amount: number;
    discount_impact_percent: number;
  };
  counts: {
    total_students: number;
    departments_with_students: number;
    morning: number;
    evening: number;
    fully_paid_count: number;
    partial_paid_count: number;
    unpaid_count: number;
    receipts_count: number;
    students_with_discount: number;
  };
  by_department: AggregateDeptRow[];
  by_stage: AggregateStageRow[];
  by_study_type: AggregateStudyTypeRow[];
  by_fee_year: AggregateFeeYearRow[];
  discount_types: AggregateDiscountType[];
  totals: {
    students: number;
    annual_base_total: number;
    discount_amount: number;
    expected_annual_total: number;
    collected_amount: number;
    debt_amount: number;
    receipts_count: number;
    expected_four_years_total: number;
  };
};

const STAGE_ORDER = ['first', 'second', 'third', 'fourth', 'unknown'] as const;
const STAGE_LABELS: Record<string, string> = {
  first: 'المرحلة الأولى',
  second: 'المرحلة الثانية',
  third: 'المرحلة الثالثة',
  fourth: 'المرحلة الرابعة',
  unknown: 'غير محدد',
};

const FEE_YEAR_LABELS: Record<FeeYear, string> = {
  1: 'السنة الأولى',
  2: 'السنة الثانية',
  3: 'السنة الثالثة',
  4: 'السنة الرابعة',
};

function emptyDept(id: string, name: string): AggregateDeptRow {
  return {
    id,
    name,
    students: 0,
    morning: 0,
    evening: 0,
    annual_base_total: 0,
    discount_amount: 0,
    expected_annual_total: 0,
    collected_amount: 0,
    debt_amount: 0,
    receipts_count: 0,
    collection_rate_percent: 0,
    expected_four_years_total: 0,
  };
}

function emptyStage(stage: string): AggregateStageRow {
  return {
    stage,
    label: STAGE_LABELS[stage] || stage,
    students: 0,
    annual_base_total: 0,
    discount_amount: 0,
    expected_annual_total: 0,
    collected_amount: 0,
    debt_amount: 0,
    receipts_count: 0,
  };
}

function emptyStudy(study_type: 'morning' | 'evening'): AggregateStudyTypeRow {
  return {
    study_type,
    label: study_type === 'morning' ? 'صباحي' : 'مسائي',
    students: 0,
    annual_base_total: 0,
    discount_amount: 0,
    expected_annual_total: 0,
    collected_amount: 0,
    debt_amount: 0,
    receipts_count: 0,
  };
}

function emptyFeeYear(year: FeeYear): AggregateFeeYearRow {
  return {
    fee_year: year,
    label: FEE_YEAR_LABELS[year],
    target_amount: 0,
    collected_amount: 0,
    remaining_amount: 0,
    receipts_count: 0,
    students_with_activity: 0,
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

function withRate(dept: AggregateDeptRow): AggregateDeptRow {
  const rate =
    dept.expected_annual_total > 0
      ? Math.round((dept.collected_amount / dept.expected_annual_total) * 1000) / 10
      : 0;
  return { ...dept, collection_rate_percent: rate };
}

export async function buildStudentsAggregateData(): Promise<StudentsAggregateData> {
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

  const byDept = new Map<string, AggregateDeptRow>();
  for (const dept of STUDENT_DEPARTMENTS) {
    byDept.set(normalizeDeptKey(dept.name), emptyDept(dept.id, dept.name));
  }

  const byStage = new Map<string, AggregateStageRow>();
  for (const s of STAGE_ORDER) byStage.set(s, emptyStage(s));

  const byStudy = new Map<'morning' | 'evening', AggregateStudyTypeRow>([
    ['morning', emptyStudy('morning')],
    ['evening', emptyStudy('evening')],
  ]);

  const byFeeYear = new Map<FeeYear, AggregateFeeYearRow>([
    [1, emptyFeeYear(1)],
    [2, emptyFeeYear(2)],
    [3, emptyFeeYear(3)],
    [4, emptyFeeYear(4)],
  ]);

  const discountTypes = new Map<string, AggregateDiscountType>();

  let morning = 0;
  let evening = 0;
  let debtAmount = 0;
  let annualBaseTotal = 0;
  let expectedAnnualTotal = 0;
  let channelDiscountTotal = 0;
  let settlementDiscountTotal = 0;
  let studentsWithDiscount = 0;
  let fullyPaid = 0;
  let partialPaid = 0;
  let unpaid = 0;

  const feeMap = await loadTuitionFeeMap();

  for (const row of students) {
    const studyRaw = String(row.study_type || '').toLowerCase();
    const isEvening = studyRaw === 'evening' || studyRaw === 'مسائي';
    const studyKey: 'morning' | 'evening' = isEvening ? 'evening' : 'morning';
    if (isEvening) evening += 1;
    else morning += 1;

    const major = row.major || '';
    const annualBase = getAnnualTuitionFee(major, studyKey, feeMap);

    const receipts = receiptsByStudent.get(row.id) || [];
    const paid = receipts.reduce(
      (sum, r) => sum + Math.max(0, Number(r.pay_amount || 0)),
      0
    );
    const studentReceipts = receipts.filter(
      (r) => Math.max(0, Number(r.pay_amount || 0)) > 0
    ).length;

    // الخصم والدين من وصولات المودال فقط
    const ledger = buildYearLedger(receipts, annualBase);
    const settlementDiscount = sumSettlementDiscountsByYear(receipts);
    const studentDiscount = settlementDiscount;
    const debt = ledger.years.reduce((sum, e) => sum + Math.max(0, e.remaining), 0);
    const currentEntry = ledger.currentYear
      ? ledger.years.find((y) => y.year === ledger.currentYear)
      : null;
    const netDue = currentEntry?.target ?? (ledger.allYearsCompleted ? 0 : annualBase);

    annualBaseTotal += annualBase;
    expectedAnnualTotal += netDue;
    debtAmount += debt;

    if (paid <= 0.01 && debt > 0.01) unpaid += 1;
    else if (paid > 0.01 && debt > 0.01) partialPaid += 1;
    else fullyPaid += 1;

    if (studentDiscount > 0.5) studentsWithDiscount += 1;

    // سنة القسط
    for (const entry of ledger.years) {
      const fy = byFeeYear.get(entry.year)!;
      fy.target_amount += entry.target;
      fy.collected_amount += entry.paid;
      fy.remaining_amount += entry.remaining;
      fy.receipts_count += entry.receiptsCount;
      if (entry.paid > 0.01 || entry.receiptsCount > 0) {
        fy.students_with_activity += 1;
      }
    }

    // أنواع التخفيض — من الوصولات فقط
    let attributedChannel = 0;
    let attributedSettlement = 0;
    if (settlementDiscount > 0.5) {
      const channelFromReceipt = receipts
        .map((r) => String((r as { discount_channel?: string }).discount_channel || '').trim())
        .find((ch) => ch && ch !== 'general');
      if (channelFromReceipt) {
        attributedChannel = settlementDiscount;
        const key = `channel:${channelFromReceipt}`;
        let bucket = discountTypes.get(key);
        if (!bucket) {
          bucket = {
            key,
            label: formatAdmissionChannelLabel(channelFromReceipt),
            kind: 'channel',
            students_count: 0,
            amount: 0,
          };
          discountTypes.set(key, bucket);
        }
        bucket.students_count += 1;
        bucket.amount += settlementDiscount;
      } else {
        attributedSettlement = settlementDiscount;
        const key = 'settlement:modal';
        let bucket = discountTypes.get(key);
        if (!bucket) {
          bucket = {
            key,
            label: 'خصم عند التسديد',
            kind: 'settlement',
            students_count: 0,
            amount: 0,
          };
          discountTypes.set(key, bucket);
        }
        bucket.students_count += 1;
        bucket.amount += settlementDiscount;
      }
    }
    channelDiscountTotal += attributedChannel;
    settlementDiscountTotal += attributedSettlement;

    // قسم
    const deptKey = normalizeDeptKey(major);
    let dept = byDept.get(deptKey);
    if (!dept) {
      dept = emptyDept(`other-${deptKey || 'unknown'}`, major.trim() || 'غير محدد');
      byDept.set(deptKey || 'unknown', dept);
    }
    dept.students += 1;
    if (isEvening) dept.evening += 1;
    else dept.morning += 1;
    dept.annual_base_total += annualBase;
    dept.discount_amount += studentDiscount;
    dept.expected_annual_total += netDue;
    dept.collected_amount += paid;
    dept.debt_amount += debt;
    dept.receipts_count += studentReceipts;
    dept.expected_four_years_total += netDue * 4;

    // مرحلة
    const stageKey = normalizeStage(row.admission_type);
    const stage = byStage.get(stageKey) || byStage.get('unknown')!;
    stage.students += 1;
    stage.annual_base_total += annualBase;
    stage.discount_amount += studentDiscount;
    stage.expected_annual_total += netDue;
    stage.collected_amount += paid;
    stage.debt_amount += debt;
    stage.receipts_count += studentReceipts;

    // نوع دراسة
    const study = byStudy.get(studyKey)!;
    study.students += 1;
    study.annual_base_total += annualBase;
    study.discount_amount += studentDiscount;
    study.expected_annual_total += netDue;
    study.collected_amount += paid;
    study.debt_amount += debt;
    study.receipts_count += studentReceipts;
  }

  const totalDiscount = channelDiscountTotal + settlementDiscountTotal;
  const discountImpactPercent =
    annualBaseTotal > 0
      ? Math.round((totalDiscount / annualBaseTotal) * 1000) / 10
      : 0;
  const collectionRatePercent =
    expectedAnnualTotal > 0
      ? Math.round((settlementsPaidAmount / expectedAnnualTotal) * 1000) / 10
      : 0;

  const departments = Array.from(byDept.values())
    .filter((d) => d.students > 0)
    .map(withRate)
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  const byStageList = STAGE_ORDER.map((s) => byStage.get(s)!)
    .filter((s) => s.students > 0 || s.stage !== 'unknown');

  const byStudyList = [byStudy.get('morning')!, byStudy.get('evening')!].filter(
    (s) => s.students > 0
  );

  const byFeeYearList = ([1, 2, 3, 4] as FeeYear[]).map((y) => byFeeYear.get(y)!);

  return {
    generated_at: new Date().toISOString(),
    equation: {
      annual_base_total: annualBaseTotal,
      total_discount_amount: totalDiscount,
      expected_annual_total: expectedAnnualTotal,
      collected_amount: settlementsPaidAmount,
      debt_amount: debtAmount,
      collection_rate_percent: collectionRatePercent,
      expected_four_years_total: expectedAnnualTotal * 4,
      expected_four_years_base_total: annualBaseTotal * 4,
      channel_discount_amount: channelDiscountTotal,
      settlement_discount_amount: settlementDiscountTotal,
      discount_impact_percent: discountImpactPercent,
    },
    counts: {
      total_students: students.length,
      departments_with_students: departments.length,
      morning,
      evening,
      fully_paid_count: fullyPaid,
      partial_paid_count: partialPaid,
      unpaid_count: unpaid,
      receipts_count: receiptsCount,
      students_with_discount: studentsWithDiscount,
    },
    by_department: departments,
    by_stage: byStageList,
    by_study_type: byStudyList,
    by_fee_year: byFeeYearList,
    discount_types: Array.from(discountTypes.values()).sort(
      (a, b) => b.amount - a.amount
    ),
    totals: {
      students: students.length,
      annual_base_total: annualBaseTotal,
      discount_amount: totalDiscount,
      expected_annual_total: expectedAnnualTotal,
      collected_amount: settlementsPaidAmount,
      debt_amount: debtAmount,
      receipts_count: receiptsCount,
      expected_four_years_total: expectedAnnualTotal * 4,
    },
  };
}
