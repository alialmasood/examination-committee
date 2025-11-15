import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

/**
 * PUT /api/teaching-subjects/[system]/[id]
 * تحديث مادة تدريسية
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ system: string; id: string }> }
) {
  try {
    const { system, id } = await params;
    const body = await request.json();
    
    await query(`
      ALTER TABLE examination_committee.teaching_subjects
      ADD COLUMN IF NOT EXISTS units INTEGER DEFAULT 0
    `);

    // التحقق من وجود المادة التدريسية أولاً
    const checkQuery = 'SELECT id, department FROM examination_committee.teaching_subjects WHERE id = $1';
    const checkResult = await query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المادة التدريسية غير موجودة' },
        { status: 404 }
      );
    }
    
    // التحقق من صحة البيانات
    if (!body.material_name || !body.instructor_name || !body.semester || !body.academic_year || !body.stage || !body.study_type) {
      return NextResponse.json(
        { success: false, error: 'جميع الحقول مطلوبة' },
        { status: 400 }
      );
    }

    const unitsValue = Number(body.units);
    if (!Number.isFinite(unitsValue) || unitsValue <= 0) {
      return NextResponse.json(
        { success: false, error: 'عدد الوحدات مطلوب ويجب أن يكون رقماً أكبر من صفر' },
        { status: 400 }
      );
    }
    
    // تحديث المادة التدريسية
    const updateQuery = `
      UPDATE examination_committee.teaching_subjects 
      SET material_name = $1,
          instructor_name = $2,
          semester = $3,
          academic_year = $4,
          stage = $5,
          study_type = $6,
          has_practical = $7,
          units = $8,
          updated_at = NOW()
      WHERE id = $9
      RETURNING id, department, material_name, instructor_name, semester, academic_year, stage, study_type, has_practical, units, created_at, updated_at
    `;
    
    const result = await query(updateQuery, [
      body.material_name,
      body.instructor_name,
      body.semester,
      body.academic_year,
      body.stage,
      body.study_type,
      body.has_practical !== undefined ? body.has_practical : true,
      unitsValue,
      id
    ]);
    
    return NextResponse.json({
      success: true,
      data: result.rows[0],
      message: 'تم تحديث المادة التدريسية بنجاح'
    });
  } catch (error) {
    console.error('خطأ في تحديث المادة التدريسية:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في تحديث المادة التدريسية' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/teaching-subjects/[system]/[id]
 * حذف مادة تدريسية
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ system: string; id: string }> }
) {
  try {
    const { system, id } = await params;
    
    // التحقق من وجود المادة التدريسية أولاً
    const checkQuery = 'SELECT id FROM examination_committee.teaching_subjects WHERE id = $1';
    const checkResult = await query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المادة التدريسية غير موجودة' },
        { status: 404 }
      );
    }
    
    // حذف المادة التدريسية
    const deleteQuery = 'DELETE FROM examination_committee.teaching_subjects WHERE id = $1';
    await query(deleteQuery, [id]);
    
    return NextResponse.json({
      success: true,
      message: 'تم حذف المادة التدريسية بنجاح'
    });
  } catch (error) {
    console.error('خطأ في حذف المادة التدريسية:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في حذف المادة التدريسية' },
      { status: 500 }
    );
  }
}

