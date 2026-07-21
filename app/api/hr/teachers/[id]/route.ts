import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

// GET - جلب بيانات تدريسي محدد
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await query(
      `SELECT 
        id,
        full_name,
        full_name_ar,
        email,
        phone,
        national_id,
        employee_id,
        department,
        academic_degree,
        academic_title,
        specialization,
        status,
        hire_date,
        employment_type,
        working_days,
        notes,
        user_id,
        created_at,
        updated_at
      FROM hr.teachers
      WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'التدريسي غير موجود'
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error: any) {
    console.error('خطأ في جلب بيانات التدريسي:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ في جلب بيانات التدريسي'
      },
      { status: 500 }
    );
  }
}

// PUT - تحديث بيانات تدريسي
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // التحقق من وجود التدريسي
    const checkResult = await query(
      'SELECT id FROM hr.teachers WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'التدريسي غير موجود'
        },
        { status: 404 }
      );
    }

    // تحديث البيانات
    const updateResult = await query(
      `UPDATE hr.teachers SET
        full_name = $1,
        full_name_ar = $2,
        email = $3,
        phone = $4,
        national_id = $5,
        employee_id = $6,
        department = $7,
        academic_degree = $8,
        academic_title = $9,
        specialization = $10,
        status = $11,
        hire_date = $12,
        employment_type = $13,
        working_days = $14,
        notes = $15,
        updated_at = NOW()
      WHERE id = $16
      RETURNING id, full_name, full_name_ar, email, phone, employee_id, department, 
                academic_degree, academic_title, specialization, status, hire_date, employment_type, 
                working_days, notes, created_at, updated_at`,
      [
        body.full_name,
        body.full_name_ar,
        body.email || null,
        body.phone || null,
        body.national_id || null,
        body.employee_id || null,
        body.department,
        body.academic_degree || null,
        body.academic_title || null,
        body.specialization || null,
        body.status || 'active',
        body.hire_date || null,
        body.employment_type || 'full_time',
        body.working_days || null,
        body.notes || null,
        id
      ]
    );

    return NextResponse.json({
      success: true,
      data: updateResult.rows[0],
      message: 'تم تحديث بيانات التدريسي بنجاح'
    });
  } catch (error: any) {
    console.error('خطأ في تحديث التدريسي:', error);
    
    if (error.code === '23505') {
      if (error.constraint?.includes('national_id')) {
        return NextResponse.json(
          {
            success: false,
            error: 'الرقم الوطني موجود مسبقاً'
          },
          { status: 400 }
        );
      }
      if (error.constraint?.includes('employee_id')) {
        return NextResponse.json(
          {
            success: false,
            error: 'الرقم الوظيفي موجود مسبقاً'
          },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ في تحديث بيانات التدريسي'
      },
      { status: 500 }
    );
  }
}

// DELETE - حذف تدريسي
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await query(
      'DELETE FROM hr.teachers WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'التدريسي غير موجود'
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'تم حذف التدريسي بنجاح'
    });
  } catch (error: any) {
    console.error('خطأ في حذف التدريسي:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ في حذف التدريسي'
      },
      { status: 500 }
    );
  }
}

