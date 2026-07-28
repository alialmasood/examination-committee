import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import {
  isSaAuthFailure,
  requireStudentAffairsAccess,
} from '@/src/lib/student-affairs/auth';

export async function GET(request: NextRequest) {
  const auth = await requireStudentAffairsAccess(request);
  if (isSaAuthFailure(auth)) return auth.response;

  try {
    const result = await query(`
      SELECT academic_year AS year, COUNT(*)::int AS student_count
      FROM student_affairs.students
      WHERE academic_year IS NOT NULL AND academic_year <> ''
      GROUP BY academic_year
      ORDER BY academic_year DESC
    `);

    return NextResponse.json({
      success: true,
      data: result.rows.map((r) => ({
        year: r.year as string,
        studentCount: Number(r.student_count || 0),
      })),
    });
  } catch (error) {
    console.error('promotions/years:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر جلب الأعوام الدراسية' },
      { status: 500 }
    );
  }
}
