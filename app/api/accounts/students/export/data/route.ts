import { NextRequest, NextResponse } from 'next/server';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { getStudentExportData } from '@/src/lib/accounts/student-export-data';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const data = await getStudentExportData();
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
