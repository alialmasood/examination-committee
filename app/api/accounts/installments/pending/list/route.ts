import { NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * قائمة انتظار وصل القبض: فقط بعد إتمام التسجيل من شؤون الطلبة
 * (payment_status = pending). يستبعد قيد التسجيل (registration_pending).
 */
async function ensurePaymentColumns() {
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

export async function GET() {
  try {
    await ensurePaymentColumns();

    const result = await query(
      `SELECT 
         s.id,
         s.university_id,
         COALESCE(NULLIF(TRIM(s.full_name_ar), ''), NULLIF(TRIM(s.full_name), ''), TRIM(CONCAT_WS(' ', s.first_name, s.middle_name, s.last_name))) AS name,
         s.nickname,
         s.mother_name,
         COALESCE(s.major, '') AS department,
         s.level,
         s.admission_type,
         s.admission_channel,
         s.semester,
         s.academic_year,
         s.registration_date,
         s.photo,
         s.study_type,
         s.payment_status
       FROM student_affairs.students s
       WHERE TRIM(COALESCE(s.payment_status, '')) = 'pending'
       ORDER BY s.created_at DESC NULLS LAST, s.university_id DESC
       LIMIT 5000`
    );

    return NextResponse.json(
      { success: true, data: result.rows },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('خطأ في جلب قائمة الطلبة قيد الدفع:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب قائمة الطلبة قيد الدفع' },
      { status: 500 }
    );
  }
}
