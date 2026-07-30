import { NextRequest, NextResponse } from 'next/server';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { buildStudentsFinanceSummary } from '@/src/lib/accounts/students-finance-summary';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * ملخص مالية الطلبة — مصدر الحقيقة: وصولات التسديد
 * (accounts.student_settlement_receipts) بنفس منطق صفحات حسابات الطلبة.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const data = await buildStudentsFinanceSummary();
    return NextResponse.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('خطأ في ملخص حسابات الطلبة:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر تحميل ملخص حسابات الطلبة' },
      { status: 500 }
    );
  }
}
