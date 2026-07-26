import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import { isDeanUsername } from '@/src/lib/dean';
import {
  STUDENT_DEPARTMENTS,
  expectedAnnualFee,
  getAnnualTuitionFee,
  normalizeDeptKey,
} from '@/app/accounts/students/lib/tuitionFees';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

type ReceiptRow = {
  student_id: string;
  fee_year: number;
  discount_mode: string | null;
  discount_amount: number;
  settlement_date: string | null;
  created_at: string | null;
};

type DeptAgg = {
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
};

type StageAgg = {
  stage: string;
  label: string;
  students: number;
  collected_amount: number;
  debt_amount: number;
  expected_annual_total: number;
};

const STAGE_ORDER = ['first', 'second', 'third', 'fourth', 'unknown'] as const;

const STAGE_LABELS: Record<string, string> = {
  first: 'المرحلة الأولى',
  second: 'المرحلة الثانية',
  third: 'المرحلة الثالثة',
  fourth: 'المرحلة الرابعة',
  unknown: 'غير محدد',
};

function emptyDept(id: string, name: string): DeptAgg {
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
  };
}

function emptyStage(stage: string): StageAgg {
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

function receiptTime(row: ReceiptRow): number {
  const a = Date.parse(String(row.created_at || ''));
  if (Number.isFinite(a)) return a;
  const b = Date.parse(String(row.settlement_date || ''));
  return Number.isFinite(b) ? b : 0;
}

function settlementDiscountForStudent(receipts: ReceiptRow[]): number {
  const byYear = new Map<number, ReceiptRow[]>();
  for (const row of receipts) {
    const year = Math.max(1, Math.min(4, Number(row.fee_year) || 1));
    const list = byYear.get(year) || [];
    list.push(row);
    byYear.set(year, list);
  }

  let total = 0;
  for (const [, list] of byYear) {
    const first = [...list].sort((a, b) => receiptTime(a) - receiptTime(b))[0];
    if (!first) continue;
    const mode = String(first.discount_mode || 'none');
    const amount = Math.max(0, Number(first.discount_amount || 0));
    if (mode !== 'none' && amount > 0) total += amount;
  }
  return total;
}

async function requireDean(request: NextRequest) {
  const accessToken = request.cookies.get('access_token')?.value;
  if (!accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, message: 'غير مصرح' }, { status: 401 }),
    };
  }
  const payload = verifyAccessToken(accessToken);
  if (!payload) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, message: 'جلسة منتهية' }, { status: 401 }),
    };
  }
  const user = await validateUser(payload.user_id);
  if (!user || !isDeanUsername(user.username)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, message: 'هذه الصفحة مخصصة للسيد العميد فقط' },
        { status: 403 }
      ),
    };
  }
  return { ok: true as const, user };
}

export async function GET(request: NextRequest) {
  const auth = await requireDean(request);
  if (!auth.ok) return auth.response;

  try {
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
             COALESCE(discount_amount, 0)::float8 AS discount_amount,
             settlement_date,
             created_at,
             COALESCE(pay_amount, 0)::float8 AS pay_amount
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
    let discountsCount = 0;
    let fullyPaidCount = 0;
    let partialPaidCount = 0;
    let unpaidCount = 0;
    let channelDiscountTotal = 0;
    let settlementDiscountTotal = 0;

    const byDept = new Map<string, DeptAgg>();
    for (const dept of STUDENT_DEPARTMENTS) {
      byDept.set(normalizeDeptKey(dept.name), emptyDept(dept.id, dept.name));
    }

    const byStage = new Map<string, StageAgg>();
    for (const stage of STAGE_ORDER) {
      byStage.set(stage, emptyStage(stage));
    }

    for (const row of students) {
      const studyType = String(row.study_type || '').toLowerCase();
      const isEvening = studyType === 'evening' || studyType === 'مسائي';
      if (isEvening) evening += 1;
      else morning += 1;

      const major = row.major || '';
      const annualBase = getAnnualTuitionFee(
        major,
        isEvening ? 'evening' : 'morning'
      );
      const expected = expectedAnnualFee({
        major,
        study_type: isEvening ? 'evening' : row.study_type,
        admission_channel: row.admission_channel,
        discount_percentage: row.discount_percentage,
        final_fee_after_discount: row.final_fee_after_discount,
      });
      const paid = Number(row.payment_amount || 0);
      const debt = Math.max(0, expected - paid);

      const channelDiscount =
        Number(row.discount_amount || 0) > 0
          ? Number(row.discount_amount)
          : Math.max(0, annualBase - expected);

      const settlementDiscount = settlementDiscountForStudent(
        receiptsByStudent.get(row.id) || []
      );
      const studentTotalDiscount = channelDiscount + settlementDiscount;

      annualBaseTotal += annualBase;
      expectedAnnualTotal += expected;
      collectedAmount += paid;
      debtAmount += debt;
      channelDiscountTotal += channelDiscount;
      settlementDiscountTotal += settlementDiscount;

      if (debt <= 0 && (expected > 0 || paid > 0)) {
        fullyPaidCount += 1;
      } else if (paid > 0 && debt > 0) {
        partialPaidCount += 1;
      } else {
        unpaidCount += 1;
      }

      const hasDiscount =
        studentTotalDiscount > 0.5 ||
        Number(row.discount_percentage || 0) > 0 ||
        (annualBase > 0 && expected < annualBase - 0.5);
      if (hasDiscount) discountsCount += 1;

      const key = normalizeDeptKey(major);
      let dept = byDept.get(key);
      if (!dept) {
        dept = emptyDept(
          `other-${key || 'unknown'}`,
          major.trim() || 'غير محدد'
        );
        byDept.set(key || 'unknown', dept);
      }

      dept.students += 1;
      if (isEvening) dept.evening += 1;
      else dept.morning += 1;
      dept.collected_amount += paid;
      dept.debt_amount += debt;
      dept.annual_base_total += annualBase;
      dept.expected_annual_total += expected;
      dept.expected_four_years_total += expected * 4;
      dept.channel_discount_amount += channelDiscount;
      dept.settlement_discount_amount += settlementDiscount;
      dept.total_discount_amount += studentTotalDiscount;
      if (hasDiscount) dept.discounts_count += 1;

      const stageKey = normalizeStage(row.admission_type);
      const stage = byStage.get(stageKey) || byStage.get('unknown')!;
      stage.students += 1;
      stage.collected_amount += paid;
      stage.debt_amount += debt;
      stage.expected_annual_total += expected;
    }

    const totalDiscountAmount = channelDiscountTotal + settlementDiscountTotal;
    const discountImpactPercent =
      annualBaseTotal > 0
        ? Math.round((totalDiscountAmount / annualBaseTotal) * 1000) / 10
        : 0;

    const departments = Array.from(byDept.values())
      .filter((d) => d.students > 0)
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

    const byStageList = STAGE_ORDER.map((s) => byStage.get(s)!).filter(
      (s) => s.students > 0 || s.stage !== 'unknown'
    );

    const collectionRatePercent =
      expectedAnnualTotal > 0
        ? Math.round((collectedAmount / expectedAnnualTotal) * 1000) / 10
        : 0;

    return NextResponse.json({
      success: true,
      data: {
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
        expected_four_years_total: expectedAnnualTotal * 4,
        expected_four_years_base_total: annualBaseTotal * 4,
        by_stage: byStageList,
        top_departments: topDepartments,
        least_departments: leastDepartments,
        top_debt_departments: topDebtDepartments,
        top_discount_departments: topDiscountDepartments,
        departments,
      },
    });
  } catch (error) {
    console.error('خطأ في ملخص حسابات العميد:', error);
    return NextResponse.json(
      { success: false, message: 'تعذر تحميل إحصائيات الحسابات' },
      { status: 500 }
    );
  }
}
