import { NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

// GET /api/academic-years - جلب قائمة الأعوام الدراسية المتاحة
export async function GET() {
  try {
    // جلب قائمة الأعوام الدراسية المميزة من جدول الطلاب
    const result = await query(
      `SELECT DISTINCT academic_year 
       FROM student_affairs.students 
       WHERE academic_year IS NOT NULL 
         AND academic_year != ''
       ORDER BY academic_year DESC`
    );

    const academicYears = result.rows.map((row) => row.academic_year as string);

    // إذا لم يكن هناك أعوام، نضيف العام الحالي كقيمة افتراضية
    if (academicYears.length === 0) {
      academicYears.push('2025-2026');
    }

    return NextResponse.json({
      success: true,
      data: academicYears
    });
  } catch (error) {
    console.error('خطأ في جلب الأعوام الدراسية:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب الأعوام الدراسية' },
      { status: 500 }
    );
  }
}

