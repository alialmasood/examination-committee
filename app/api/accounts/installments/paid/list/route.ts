import { NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

export async function GET() {
  try {
    const result = await query(
      `SELECT 
         s.id,
         s.university_id,
         COALESCE(s.full_name_ar, s.full_name) AS name,
         s.nickname,
         s.major AS department,
         s.payment_amount,
         s.payment_date,
         s.study_type,
         s.admission_type,
         s.admission_channel,
         s.discount_percentage,
         s.discount_amount,
         s.final_fee_after_discount AS final_fee
       FROM student_affairs.students s
       WHERE COALESCE((to_jsonb(s)->>'payment_status'), 'pending') = 'paid'
       ORDER BY s.payment_date DESC NULLS LAST, s.updated_at DESC
       LIMIT 200`
    );
    return NextResponse.json({ success: true, data: result.rows });
  } catch (e) {
    return NextResponse.json({ success: false, error: 'خطأ في جلب قائمة الطلبة المسددين' }, { status: 500 });
  }
}


