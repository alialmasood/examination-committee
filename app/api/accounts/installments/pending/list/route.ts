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
         s.mother_name,
         s.major AS department,
         s.level,
         s.admission_type,
         s.admission_channel,
         s.semester,
         s.academic_year,
         s.registration_date,
         s.photo,
         s.study_type
       FROM student_affairs.students s
       WHERE COALESCE(s.payment_status, (to_jsonb(s)->>'payment_status'), 'pending') = 'pending'
       ORDER BY s.created_at DESC
       LIMIT 200`
    );
    return NextResponse.json({ success: true, data: result.rows });
  } catch (e) {
    return NextResponse.json({ success: false, error: 'خطأ في جلب قائمة الطلبة قيد الدفع' }, { status: 500 });
  }
}


