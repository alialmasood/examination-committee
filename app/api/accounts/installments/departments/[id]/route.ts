import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

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

const FIXED_DISCOUNTS: Record<string, number> = {
  general: 0,
  martyrs: 50,
  social_care: 50,
  siblings_married: 10,
  top_students: 10,
  health_ministry: 20,
};

function getAnnualTuitionFee(department: string, studyType?: string | null): number {
  const isEvening = studyType === 'evening';
  const fees: Record<string, number> = {
    'تقنيات التخدير': isEvening ? 2750000 : 3000000,
    'تقنيات الاشعة': isEvening ? 2750000 : 3000000,
    'تقنيات صناعة الاسنان': isEvening ? 2250000 : 2500000,
    'تقنيات البصريات': 2750000,
    'تقنيات طب الطوارئ': 2750000,
    'تقنيات صحة المجتمع': 2750000,
    'تقنيات العلاج الطبيعي': 2750000,
    'هندسة تقنيات البناء والانشاءات': 2500000,
    'تقنيات البناء والاستشارات': 2500000,
    'تقنيات هندسة النفط والغاز': 2500000,
    'تقنيات الفيزياء الصحية': 2500000,
    'هندسة تقنيات الامن السيبراني والحوسبة السحابية': 3000000,
    'تقنيات الامن السيبراني': 3000000,
    'تقنيات الأمن السيبراني': 3000000,
    القانون: 0,
  };
  return fees[department] || 0;
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

function expectedFee(row: {
  major: string;
  study_type: string | null;
  admission_channel: string | null;
  discount_percentage: number | null;
  final_fee_after_discount: number | null;
}): number {
  if (row.final_fee_after_discount != null && Number(row.final_fee_after_discount) > 0) {
    return Number(row.final_fee_after_discount);
  }
  const annual = getAnnualTuitionFee(row.major, row.study_type);
  const channel = row.admission_channel || 'general';
  const discountPct =
    row.discount_percentage != null && Number(row.discount_percentage) >= 0
      ? Number(row.discount_percentage)
      : FIXED_DISCOUNTS[channel] ?? 0;
  return annual - (annual * discountPct) / 100;
}

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
  expected_amount: number;
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
    debt_amount: 0,
    morning: 0,
    evening: 0,
  };
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
         COALESCE(s.payment_amount, 0)::float8 AS payment_amount,
         s.discount_percentage::float8 AS discount_percentage,
         s.final_fee_after_discount::float8 AS final_fee_after_discount
       FROM student_affairs.students s
       WHERE normalize_arabic(COALESCE(s.major, '')) = normalize_arabic($1)
       ORDER BY s.admission_type NULLS LAST, s.university_id ASC`,
      [dept.name]
    );

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
    let totalDebt = 0;
    let morning = 0;
    let evening = 0;

    const unpaidStudents: Array<{
      university_id: string;
      name: string;
      stage_label: string;
      study_type: string;
      expected: number;
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
      const paidAmount = Number(row.payment_amount || 0);
      const expected = expectedFee({
        major: row.major || dept.name,
        study_type: row.study_type,
        admission_channel: row.admission_channel,
        discount_percentage: row.discount_percentage,
        final_fee_after_discount: row.final_fee_after_discount,
      });
      // الدين = المتبقي الفعلي بغض النظر عن حالة الدفع المسجّلة
      const debt = Math.max(0, expected - paidAmount);
      const isFullyPaid = debt <= 0;

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

      bucket.expected_amount += expected;
      totalExpected += expected;
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

      // كشف الديون: كل من عليه متبقي > 0 (غير مسدد أو مسدد جزئياً)
      if (debt > 0) {
        let statusLabel = 'غير مسدد';
        if (isMarkedPaid) statusLabel = paidAmount > 0 ? 'مسدد جزئياً' : 'مسجل كمسدد بدون مبلغ';
        else if (status === 'registration_pending') statusLabel = 'بانتظار إتمام التسجيل';
        else if (status === 'pending') statusLabel = 'قيد الدفع';
        else if (paidAmount > 0) statusLabel = 'مسدد جزئياً';

        unpaidStudents.push({
          university_id: row.university_id || '—',
          name: row.name || '—',
          stage_label: STAGE_LABELS[stage] || 'غير محدد',
          study_type: row.study_type === 'evening' ? 'مسائي' : 'صباحي',
          expected,
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
