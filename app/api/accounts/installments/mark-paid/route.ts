import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { ensureStudentAccountsForPaidStudents } from '@/src/lib/accounts/student-accounts';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

const FIXED_DISCOUNTS: Record<string, number> = {
  general: 0,
  martyrs: 50,
  social_care: 50,
  siblings_married: 10,
  top_students: 10,
  health_ministry: 20,
};

function getAnnualTuitionFee(dept: string, studyType?: string | null) {
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
  };
  return fees[dept] || 0;
}

function resolveDiscountPercentage(admissionChannel?: string | null) {
  if (!admissionChannel) return 0;
  if (Object.prototype.hasOwnProperty.call(FIXED_DISCOUNTS, admissionChannel)) {
    return FIXED_DISCOUNTS[admissionChannel];
  }
  return 0;
}

/**
 * POST /api/accounts/installments/mark-paid
 * تأكيد الدفع جماعياً للطلبة بانتظار وصل القبض (بدون إصدار وصل).
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAccountsAccess(req);
    if (isAuthFailure(auth)) {
      return auth.response;
    }

    const body = (await req.json().catch(() => ({}))) as {
      department?: unknown;
    };
    const department =
      typeof body.department === 'string' ? body.department.trim() : '';

    await query(`
      ALTER TABLE student_affairs.students
        ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(12,2),
        ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS final_fee_after_discount DECIMAL(12,2) DEFAULT 0
    `).catch(() => undefined);

    const params: string[] = [];
    let departmentCondition = '';
    if (department) {
      params.push(department);
      departmentCondition =
        "AND normalize_arabic(COALESCE(major, '')) = normalize_arabic($1)";
    }

    const pendingResult = await query(
      `SELECT id, major, study_type, admission_channel
       FROM student_affairs.students
       WHERE TRIM(COALESCE(payment_status, '')) = 'pending'
       ${departmentCondition}
       ORDER BY created_at DESC NULLS LAST`,
      params
    );

    if (pendingResult.rows.length === 0) {
      const scope = department ? `قسم ${department}` : 'قائمة الانتظار';
      return NextResponse.json({
        success: true,
        updated_count: 0,
        message: `لا يوجد طلبة بانتظار تأكيد الدفع ضمن ${scope}`,
      });
    }

    const updatedIds: string[] = [];

    for (const row of pendingResult.rows) {
      const annualFee = getAnnualTuitionFee(row.major || '', row.study_type);
      const discountPercentage = resolveDiscountPercentage(row.admission_channel);
      const discountAmount = (annualFee * discountPercentage) / 100;
      const finalFeeAfterDiscount = annualFee - discountAmount;

      await query(
        `UPDATE student_affairs.students
         SET payment_status = 'paid',
             payment_amount = COALESCE(payment_amount, $2),
             payment_date = COALESCE(payment_date, NOW()),
             discount_percentage = $3,
             discount_amount = $4,
             final_fee_after_discount = $5,
             updated_at = NOW()
         WHERE id = $1
           AND TRIM(COALESCE(payment_status, '')) = 'pending'`,
        [
          row.id,
          finalFeeAfterDiscount,
          discountPercentage,
          discountAmount,
          finalFeeAfterDiscount,
        ]
      );

      updatedIds.push(row.id);
    }

    try {
      await withTransaction((client) =>
        ensureStudentAccountsForPaidStudents(client, auth.user.id, {
          studentIds: updatedIds,
        })
      );
    } catch (syncErr) {
      console.error('تعذر مزامنة الحسابات المالية بعد التأكيد الجماعي:', syncErr);
    }

    return NextResponse.json({
      success: true,
      updated_count: updatedIds.length,
      message: `تم تأكيد الدفع لـ ${updatedIds.length} طالب دون إصدار وصل`,
    });
  } catch (error) {
    console.error('خطأ في تأكيد الدفع الجماعي:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تأكيد الدفع للجميع' },
      { status: 500 }
    );
  }
}
