import { NextRequest, NextResponse } from 'next/server';

import { getStudentStatistics } from '@/src/lib/reports/studentStatistics';
import { StudentReportFilters } from '@/src/lib/types/reports';

function extractFilter(searchParams: URLSearchParams, key: keyof StudentReportFilters): string | null {
  const value = searchParams.get(key);
  if (!value || value === 'all') {
    return null;
  }
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filters: StudentReportFilters = {};

    const departmentId = extractFilter(searchParams, 'departmentId');
    const stageId = extractFilter(searchParams, 'stageId');
    const semesterId = extractFilter(searchParams, 'semesterId');
    const academicYear = extractFilter(searchParams, 'academicYear');
    const status = extractFilter(searchParams, 'status');
    const gender = extractFilter(searchParams, 'gender');
    const admissionChannel = extractFilter(searchParams, 'admissionChannel');
    const studyType = extractFilter(searchParams, 'studyType');
    const paymentStatus = extractFilter(searchParams, 'paymentStatus');

    if (departmentId) filters.departmentId = departmentId;
    if (stageId) filters.stageId = stageId;
    if (semesterId) filters.semesterId = semesterId;
    if (academicYear) filters.academicYear = academicYear;
    if (status) filters.status = status;
    if (gender) filters.gender = gender;
    if (admissionChannel) filters.admissionChannel = admissionChannel;
    if (studyType) filters.studyType = studyType;
    if (paymentStatus) filters.paymentStatus = paymentStatus;

    const data = await getStudentStatistics(filters);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Failed to fetch student statistics:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'حدث خطأ أثناء جلب إحصائيات الطلبة.',
      },
      { status: 500 }
    );
  }
}

