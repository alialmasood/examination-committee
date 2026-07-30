import { NextRequest, NextResponse } from 'next/server';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { buildStudentsAggregateData } from '@/src/lib/accounts/students-aggregate';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/accounts/students/aggregate
 * دفتر الحسابات الإجمالية لمستحقات الطلبة.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const data = await buildStudentsAggregateData();
    return NextResponse.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('aggregate accounts error:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر تحميل الحسابات الإجمالية' },
      { status: 500 }
    );
  }
}
