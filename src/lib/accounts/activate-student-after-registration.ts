/**
 * تفعيل الطالب بعد إتمام التسجيل مباشرة إلى payment_status = paid
 * مع احتساب خصم القناة وإنشاء الحساب المالي — دون المرور بطابور الأقساط.
 */
import { query } from '@/src/lib/db';
import {
  FIXED_CHANNEL_DISCOUNTS,
  getAnnualTuitionFee,
} from '@/app/accounts/students/lib/tuitionFees';
import { loadTuitionFeeMap } from '@/src/lib/accounts/department-tuition-fees';
import { ensureStudentAccountsForPaidStudents } from '@/src/lib/accounts/student-accounts';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export type RegistrationFeeFields = {
  annualFee: number;
  discountPercentage: number;
  discountAmount: number;
  finalFeeAfterDiscount: number;
};

export async function ensureStudentPaymentColumns(): Promise<void> {
  await query(`
    ALTER TABLE student_affairs.students
      ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS final_fee_after_discount DECIMAL(12,2) DEFAULT 0
  `).catch(() => undefined);
}

export async function computeRegistrationFeeFields(row: {
  major?: string | null;
  study_type?: string | null;
  admission_channel?: string | null;
}): Promise<RegistrationFeeFields> {
  const feeMap = await loadTuitionFeeMap();
  const annualFee = getAnnualTuitionFee(row.major || '', row.study_type, feeMap);
  const channel = String(row.admission_channel || 'general').trim() || 'general';
  const discountPercentage = Object.prototype.hasOwnProperty.call(
    FIXED_CHANNEL_DISCOUNTS,
    channel
  )
    ? FIXED_CHANNEL_DISCOUNTS[channel]
    : 0;
  const discountAmount =
    Math.round(((annualFee * discountPercentage) / 100) * 100) / 100;
  const finalFeeAfterDiscount = Math.max(0, annualFee - discountAmount);
  return {
    annualFee,
    discountPercentage,
    discountAmount,
    finalFeeAfterDiscount,
  };
}

/**
 * يفعّل طلبة محددين إلى paid مع خصم القناة.
 * @returns معرفات الطلبة الذين حُدّثوا فعلاً
 */
export async function activateStudentsAsPaid(options: {
  studentIds: string[];
  /** إن وُجد يُستخدم كـ payment_amount عند غياب قيمة سابقة */
  paymentAmount?: number | null;
  /** الحالات المسموح الانتقال منها — افتراضياً قيد التسجيل أو بانتظار الأقساط */
  fromStatuses?: string[];
}): Promise<{ updatedIds: string[] }> {
  const ids = [...new Set(options.studentIds.filter(Boolean))];
  if (ids.length === 0) return { updatedIds: [] };

  await ensureStudentPaymentColumns();

  const fromStatuses = options.fromStatuses?.length
    ? options.fromStatuses
    : ['registration_pending', 'pending'];

  const studentsRes = await query(
    `SELECT id, major, study_type, admission_channel, payment_status
     FROM student_affairs.students
     WHERE id = ANY($1::uuid[])
       AND TRIM(COALESCE(payment_status, '')) = ANY($2::text[])`,
    [ids, fromStatuses]
  );

  const updatedIds: string[] = [];

  for (const row of studentsRes.rows) {
    const fees = await computeRegistrationFeeFields(row);
    const paymentAmount =
      options.paymentAmount != null && Number(options.paymentAmount) > 0
        ? Number(options.paymentAmount)
        : fees.annualFee;

    const result = await query(
      `UPDATE student_affairs.students
       SET payment_status = 'paid',
           payment_amount = COALESCE(payment_amount, $2),
           payment_date = COALESCE(payment_date, NOW()),
           discount_percentage = $3,
           discount_amount = $4,
           final_fee_after_discount = $5,
           updated_at = NOW()
       WHERE id = $1
         AND TRIM(COALESCE(payment_status, '')) = ANY($6::text[])
       RETURNING id`,
      [
        row.id,
        paymentAmount,
        fees.discountPercentage,
        fees.discountAmount,
        fees.finalFeeAfterDiscount,
        fromStatuses,
      ]
    );

    if (result.rows[0]?.id) {
      updatedIds.push(String(result.rows[0].id));
    }
  }

  return { updatedIds };
}

/** مزامنة الحساب المالي في accounts.student_accounts بعد التفعيل */
export async function syncStudentAccountsAfterActivation(
  createdBy: string | null | undefined,
  studentIds: string[]
): Promise<{ created: number; skipped: number }> {
  if (!createdBy || studentIds.length === 0) {
    return { created: 0, skipped: 0 };
  }
  try {
    return await withTransaction((client) =>
      ensureStudentAccountsForPaidStudents(client, createdBy, { studentIds })
    );
  } catch (err) {
    console.error('تعذر مزامنة الحساب المالي بعد تفعيل التسجيل:', err);
    return { created: 0, skipped: studentIds.length };
  }
}
