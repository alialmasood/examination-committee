import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

/**
 * GET /api/examinationadministration/dashboard-stats
 * جلب إحصائيات شاملة للوحة التحكم المركزية
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const academicYear = searchParams.get('academicYear') || '2025-2026';

    // جلب إجمالي الطلاب من جميع الأقسام
    const totalStudentsResult = await query(
      `SELECT COUNT(DISTINCT id) as count 
       FROM student_affairs.students 
       WHERE academic_year = $1 AND payment_status = 'paid'`,
      [academicYear]
    );
    const totalStudents = parseInt(totalStudentsResult.rows[0]?.count || '0', 10);

    // جلب عدد المواد التدريسية
    const totalSubjectsResult = await query(
      `SELECT COUNT(DISTINCT id) as count 
       FROM examination_committee.teaching_subjects 
       WHERE academic_year = $1`,
      [academicYear]
    );
    const totalSubjects = parseInt(totalSubjectsResult.rows[0]?.count || '0', 10);

    // جلب عدد درجات الماستر شيت
    const masterSheetGradesResult = await query(
      `SELECT COUNT(*) as count 
       FROM examination_committee.student_grades 
       WHERE academic_year = $1`,
      [academicYear]
    );
    const masterSheetGrades = parseInt(masterSheetGradesResult.rows[0]?.count || '0', 10);

    // جلب عدد درجات السب ماستر
    const subMasterGradesResult = await query(
      `SELECT COUNT(*) as count 
       FROM examination_committee.sub_master_grades 
       WHERE academic_year = $1`,
      [academicYear]
    );
    const subMasterGrades = parseInt(subMasterGradesResult.rows[0]?.count || '0', 10);

    // جلب إحصائيات النتائج
    // حساب النتائج بناءً على الدرجات النهائية
    const resultsStatsResult = await query(
      `SELECT 
        COUNT(DISTINCT sg.student_id) as total_with_grades,
        COUNT(DISTINCT CASE 
          WHEN sg.first_final_100 >= 50 OR sg.second_final_100 >= 50 
          THEN sg.student_id 
        END) as passed_count,
        COUNT(DISTINCT CASE 
          WHEN (sg.first_final_100 < 50 AND (sg.second_final_100 IS NULL OR sg.second_final_100 < 50))
          THEN sg.student_id 
        END) as failed_count
       FROM examination_committee.student_grades sg
       WHERE sg.academic_year = $1`,
      [academicYear]
    );

    const totalWithGrades = parseInt(resultsStatsResult.rows[0]?.total_with_grades || '0', 10);
    const passedCount = parseInt(resultsStatsResult.rows[0]?.passed_count || '0', 10);
    const failedCount = parseInt(resultsStatsResult.rows[0]?.failed_count || '0', 10);

    return NextResponse.json({
      success: true,
      stats: {
        totalStudents,
        totalSubjects,
        masterSheetGrades,
        subMasterGrades,
        totalWithGrades,
        passedCount,
        failedCount,
        academicYear
      }
    });
  } catch (error) {
    console.error('خطأ في جلب إحصائيات لوحة التحكم:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب الإحصائيات' },
      { status: 500 }
    );
  }
}
