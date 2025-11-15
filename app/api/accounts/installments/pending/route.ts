import { NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

export async function GET() {
  try {
    const result = await query(`
      SELECT COUNT(*)::int AS count
      FROM student_affairs.students s
      WHERE COALESCE(s.payment_status, (to_jsonb(s)->>'payment_status'), 'pending') = 'pending'
    `);
    const count = result.rows[0]?.count || 0;
    return NextResponse.json({ success: true, data: { count } });
  } catch (e) {
    return NextResponse.json({ success: false, error: 'خطأ في جلب عدد الطلبة قيد الدفع' }, { status: 500 });
  }
}


