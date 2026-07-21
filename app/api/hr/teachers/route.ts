import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

// GET - جلب قائمة التدريسيين
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const department = searchParams.get('department');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const user_id = searchParams.get('user_id');

    let queryText = `
      SELECT 
        id,
        full_name,
        full_name_ar,
        email,
        phone,
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
      WHERE 1=1
    `;
    const params: (string | null)[] = [];
    let paramIndex = 1;

    if (department && department !== 'all') {
      queryText += ` AND department = $${paramIndex}`;
      params.push(department);
      paramIndex++;
    }

    if (status && status !== 'all') {
      queryText += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    } else if (!status) {
      // بشكل افتراضي، إظهار التدريسيين النشطين فقط إذا لم يتم تحديد status
      queryText += ` AND status = 'active'`;
    }
    // إذا كان status = 'all'، نعرض الجميع بدون فلتر

    if (user_id) {
      queryText += ` AND user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }

    if (search) {
      queryText += ` AND (
        full_name ILIKE $${paramIndex} OR 
        full_name_ar ILIKE $${paramIndex} OR 
        employee_id ILIKE $${paramIndex} OR
        email ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    queryText += ` ORDER BY full_name_ar ASC`;

    const result = await query(queryText, params);

    return NextResponse.json({
      success: true,
      data: result.rows
    });
  } catch (error: unknown) {
    console.error('خطأ في جلب التدريسيين:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ في جلب بيانات التدريسيين'
      },
      { status: 500 }
    );
  }
}

// POST - إضافة تدريسي جديد
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // التحقق من البيانات المطلوبة
    if (!body.full_name || !body.full_name_ar || !body.department) {
      return NextResponse.json(
        {
          success: false,
          error: 'الاسم والقسم مطلوبان'
        },
        { status: 400 }
      );
    }

    // إنشاء التدريسي
    const result = await query(
      `INSERT INTO hr.teachers (
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
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
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
        body.notes || null
      ]
    );

    return NextResponse.json({
      success: true,
      data: result.rows[0],
      message: 'تم إضافة التدريسي بنجاح'
    });
  } catch (error: unknown) {
    console.error('خطأ في إضافة التدريسي:', error);
    
    // معالجة أخطاء القيود الفريدة
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      const dbError = error as { code?: string; constraint?: string };
      if (dbError.constraint?.includes('national_id')) {
        return NextResponse.json(
          {
            success: false,
            error: 'الرقم الوطني موجود مسبقاً'
          },
          { status: 400 }
        );
      }
      if (dbError.constraint?.includes('employee_id')) {
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
        error: 'حدث خطأ في إضافة التدريسي'
      },
      { status: 500 }
    );
  }
}

