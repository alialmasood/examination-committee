import { NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * يظهر فقط الطلبة بعد «إتمام التسجيل» من شؤون الطلبة
 * (payment_status = pending) — وليس قيد التسجيل (registration_pending).
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

    const result = await query(`
      SELECT COUNT(*)::int AS count
      FROM student_affairs.students s
      WHERE TRIM(COALESCE(s.payment_status, '')) = 'pending'
    `);
    const count = result.rows[0]?.count || 0;
    return NextResponse.json(
      { success: true, data: { count } },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('خطأ في جلب عدد الطلبة قيد الدفع:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب عدد الطلبة قيد الدفع' },
      { status: 500 }
    );
  }
}
