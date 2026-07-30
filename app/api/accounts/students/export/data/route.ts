import { NextRequest, NextResponse } from 'next/server';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { getStudentExportData } from '@/src/lib/accounts/student-export-data';
import type { FeeYear } from '@/app/accounts/students/lib/settlementYearLedger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseFeeYear(raw: string | null): FeeYear | '' {
  const n = Number(raw);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return '';
}

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const data = await getStudentExportData({
      search: searchParams.get('search') || undefined,
      department: searchParams.get('department') || undefined,
      stage: searchParams.get('stage') || undefined,
      studyType: searchParams.get('study_type') || undefined,
      paymentStatus: (searchParams.get('payment_status') || '') as
        | 'settled'
        | 'partial'
        | 'unpaid'
        | '',
      feeYear: parseFeeYear(searchParams.get('fee_year')),
    });
    return NextResponse.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('student accounts export data error:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر تحميل بيانات التصدير' },
      { status: 500 }
    );
  }
}
