import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import {
  expectedAnnualFee,
  getAnnualTuitionFee,
} from '@/app/accounts/students/lib/tuitionFees';
import {
  getOpenYearState,
  type SettlementHistoryRow,
} from '@/app/accounts/students/lib/settlementYearLedger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DEPARTMENTS = [
  { id: 'anesthesia', name: 'تقنيات التخدير' },
  { id: 'radiology', name: 'تقنيات الاشعة' },
  { id: 'dental', name: 'تقنيات صناعة الاسنان' },
  { id: 'construction', name: 'هندسة تقنيات البناء والانشاءات' },
  { id: 'oil-gas', name: 'تقنيات هندسة النفط والغاز' },
  { id: 'health-physics', name: 'تقنيات الفيزياء الصحية' },
  { id: 'optics', name: 'تقنيات البصريات' },
  { id: 'community-health', name: 'تقنيات صحة المجتمع' },
  { id: 'emergency-medicine', name: 'تقنيات طب الطوارئ' },
  { id: 'physical-therapy', name: 'تقنيات العلاج الطبيعي' },
  { id: 'cybersecurity', name: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية' },
  { id: 'law', name: 'القانون' },
] as const;

const STAGE_LABELS: Record<string, string> = {
  first: 'المرحلة الأولى',
  second: 'المرحلة الثانية',
  third: 'المرحلة الثالثة',
  fourth: 'المرحلة الرابعة',
  unknown: 'غير محدد',
};

type ReceiptRow = SettlementHistoryRow & {
  student_id?: string;
  pay_amount?: number | string | null;
};

type StageBucket = {
  stage: string;
  stage_label: string;
  total: number;
  males: number;
  females: number;
  unknown_gender: number;
  paid_count: number;
  unpaid_count: number;
  collected_amount: number;
  /** القسط بعد طرح التخفيض — ما يجب دفعه */
  expected_amount: number;
  /** التخفيضات (قناة + تسديد) — ليست ديناً */
  discount_amount: number;
  /** الدين = المطلوب بعد التخفيض − المدفوع */
  debt_amount: number;
  morning: number;
  evening: number;
};

function emptyStage(stage: string): StageBucket {
  return {
    stage,
    stage_label: STAGE_LABELS[stage] || stage,
    total: 0,
    males: 0,
    females: 0,
    unknown_gender: 0,
    paid_count: 0,
    unpaid_count: 0,
    collected_amount: 0,
    expected_amount: 0,
    discount_amount: 0,
    debt_amount: 0,
    morning: 0,
    evening: 0,
  };
}

function normalizeGender(raw: unknown): 'male' | 'female' | 'unknown' {
  const g = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (['male', 'm', 'ذكر', 'ذ'].includes(g)) return 'male';
  if (['female', 'f', 'أنثى', 'انثى', 'ا'].includes(g)) return 'female';
  return 'unknown';
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

/** خصم التسوية من أول وصل لكل سنة قسط */
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

function channelDiscountAmount(row: {
  major: string;
  study_type: string | null;
  admission_channel: string | null;
  discount_percentage: number | null;
  discount_amount: number | null;
  final_fee_after_discount: number | null;
}): number {
  const annual = getAnnualTuitionFee(row.major, row.study_type);
  if (Number(row.discount_amount || 0) > 0) {
    return Number(row.discount_amount);
  }
  const expected = expectedAnnualFee({
    major: row.major,
    study_type: row.study_type,
    admission_channel: row.admission_channel,
    discount_percentage: row.discount_percentage,
    final_fee_after_discount: row.final_fee_after_discount,
  });
  return Math.max(0, annual - expected);
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const dept = DEPARTMENTS.find((d) => d.id === id);
    if (!dept) {
      return NextResponse.json(
        { success: false, error: 'القسم غير موجود' },
        { status: 404 }
      );
    }

    await query(`
      ALTER TABLE student_affairs.students
        ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS final_fee_after_discount DECIMAL(12,2) DEFAULT 0
    `).catch(() => undefined);

    const result = await query(
      `SELECT
         s.id,
         s.university_id,
         COALESCE(NULLIF(TRIM(s.full_name_ar), ''), NULLIF(TRIM(s.full_name), ''), '—') AS name,
         COALESCE(s.major, '') AS major,
         s.gender,
         s.admission_type,
         s.admission_channel,
         s.study_type,
         s.academic_year,
         COALESCE(NULLIF(TRIM(s.payment_status), ''), 'pending') AS payment_status,
         s.discount_percentage::float8 AS discount_percentage,
         COALESCE(s.discount_amount, 0)::float8 AS discount_amount,
         s.final_fee_after_discount::float8 AS final_fee_after_discount
       FROM student_affairs.students s
       WHERE normalize_arabic(COALESCE(s.major, '')) = normalize_arabic($1)
       ORDER BY s.admission_type NULLS LAST, s.university_id ASC`,
      [dept.name]
    );

    const receiptsByStudent = new Map<string, ReceiptRow[]>();
    if (result.rows.length > 0) {
      try {
        const studentIds = result.rows.map((row: { id: string }) => row.id);
        const receiptsRes = await query(
          `SELECT
             student_id::text AS student_id,
             id,
             fee_year,
             pay_amount,
             after_discount,
             remaining_amount,
             annual_fee,
             discount_mode,
             discount_input,
             discount_amount,
             settlement_date,
             created_at
           FROM accounts.student_settlement_receipts
           WHERE student_id = ANY($1::uuid[])`,
          [studentIds]
        );
        for (const row of receiptsRes.rows) {
          const sid = String(row.student_id);
          const list = receiptsByStudent.get(sid) || [];
          list.push(row as ReceiptRow);
          receiptsByStudent.set(sid, list);
        }
      } catch {
        // لا وصولات بعد
      }
    }

    const stagesOrder = ['first', 'second', 'third', 'fourth', 'unknown'];
    const byStage: Record<string, StageBucket> = {};
    for (const s of stagesOrder) byStage[s] = emptyStage(s);

    let totalMales = 0;
    let totalFemales = 0;
    let totalUnknownGender = 0;
    let totalPaid = 0;
    let totalUnpaid = 0;
    let totalCollected = 0;
    let totalExpected = 0;
    let totalDiscount = 0;
    let totalDebt = 0;
    let morning = 0;
    let evening = 0;

    const unpaidStudents: Array<{
      university_id: string;
      name: string;
      stage_label: string;
      study_type: string;
      expected: number;
      discount: number;
      paid: number;
      debt: number;
      payment_status: string;
      status_label: string;
    }> = [];

    for (const row of result.rows) {
      const stage = normalizeStage(row.admission_type);
      const gender = normalizeGender(row.gender);
      const status = String(row.payment_status || 'pending');
      const isMarkedPaid = status === 'paid';
      const major = row.major || dept.name;
      const receipts = receiptsByStudent.get(String(row.id)) || [];

      const annualBase = getAnnualTuitionFee(major, row.study_type);
      const channelDiscount = channelDiscountAmount({
        major,
        study_type: row.study_type,
        admission_channel: row.admission_channel,
        discount_percentage: row.discount_percentage,
        discount_amount: row.discount_amount,
        final_fee_after_discount: row.final_fee_after_discount,
      });
      const settlementDiscount = settlementDiscountForStudent(receipts);
      // التخفيض ليس ديناً — يُعرض منفصلاً
      const discountTotal = channelDiscount + settlementDiscount;

      // المطلوب بعد التخفيض (قناة)
      const expectedNet = expectedAnnualFee({
        major,
        study_type: row.study_type,
        admission_channel: row.admission_channel,
        discount_percentage: row.discount_percentage,
        final_fee_after_discount: row.final_fee_after_discount,
      });

      const paidAmount = receipts.reduce(
        (sum, r) => sum + Math.max(0, Number(r.pay_amount || 0)),
        0
      );

      // الدين من دفتر السنوات: المستهدف بعد الخصم − المدفوع (لا يدخل مبلغ التخفيض في الدين)
      const annualForLedger =
        expectedNet > 0 ? expectedNet : annualBase > 0 ? annualBase : 0;
      const openState = getOpenYearState(receipts, annualForLedger);
      const debt = Math.max(0, openState.outstandingBefore);
      const isFullyPaid = debt <= 0.01;

      const bucket = byStage[stage] || byStage.unknown;
      bucket.total += 1;
      if (gender === 'male') {
        bucket.males += 1;
        totalMales += 1;
      } else if (gender === 'female') {
        bucket.females += 1;
        totalFemales += 1;
      } else {
        bucket.unknown_gender += 1;
        totalUnknownGender += 1;
      }

      if (row.study_type === 'evening') {
        bucket.evening += 1;
        evening += 1;
      } else {
        bucket.morning += 1;
        morning += 1;
      }

      bucket.expected_amount += expectedNet;
      totalExpected += expectedNet;
      bucket.discount_amount += discountTotal;
      totalDiscount += discountTotal;
      bucket.collected_amount += paidAmount;
      totalCollected += paidAmount;
      bucket.debt_amount += debt;
      totalDebt += debt;

      if (isFullyPaid) {
        bucket.paid_count += 1;
        totalPaid += 1;
      } else {
        bucket.unpaid_count += 1;
        totalUnpaid += 1;
      }

      if (debt > 0.01) {
        let statusLabel = 'غير مسدد';
        if (isMarkedPaid) {
          statusLabel = paidAmount > 0 ? 'مسدد جزئياً' : 'مسجل كمسدد بدون مبلغ';
        } else if (status === 'registration_pending') {
          statusLabel = 'بانتظار إتمام التسجيل';
        } else if (status === 'pending') {
          statusLabel = 'قيد الدفع';
        } else if (paidAmount > 0) {
          statusLabel = 'مسدد جزئياً';
        }

        unpaidStudents.push({
          university_id: row.university_id || '—',
          name: row.name || '—',
          stage_label: STAGE_LABELS[stage] || 'غير محدد',
          study_type: row.study_type === 'evening' ? 'مسائي' : 'صباحي',
          expected: expectedNet,
          discount: discountTotal,
          paid: paidAmount,
          debt,
          payment_status: status,
          status_label: statusLabel,
        });
      }
    }

    unpaidStudents.sort((a, b) => b.debt - a.debt);

    const stages = stagesOrder
      .map((s) => byStage[s])
      .filter((s) => s.total > 0 || s.stage !== 'unknown');

    return NextResponse.json(
      {
        success: true,
        data: {
          department: { id: dept.id, name: dept.name },
          generated_at: new Date().toISOString(),
          summary: {
            total_students: result.rows.length,
            males: totalMales,
            females: totalFemales,
            unknown_gender: totalUnknownGender,
            paid_count: totalPaid,
            unpaid_count: totalUnpaid,
            collected_amount: totalCollected,
            expected_amount: totalExpected,
            discount_amount: totalDiscount,
            debt_amount: totalDebt,
            morning,
            evening,
          },
          stages,
          unpaid_students: unpaidStudents.slice(0, 500),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('خطأ في إحصائيات قسم الأقساط:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب إحصائيات القسم' },
      { status: 500 }
    );
  }
}
