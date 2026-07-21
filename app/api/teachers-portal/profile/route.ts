import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';

export async function GET(request: NextRequest) {
  try {
    // التحقق من المصادقة
    const accessToken = request.cookies.get('access_token')?.value;

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح' },
        { status: 401 }
      );
    }

    // التحقق من صحة Access Token
    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'رمز المصادقة غير صالح أو منتهي الصلاحية' },
        { status: 401 }
      );
    }

    // التحقق من وجود المستخدم
    const user = await validateUser(payload.user_id);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود أو غير نشط' },
        { status: 401 }
      );
    }

    // جلب بيانات التدريسي المرتبط بالمستخدم
    const teacherQuery = `
      SELECT 
        id,
        full_name,
        full_name_ar,
        email,
        phone,
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
      WHERE user_id = $1 AND status = 'active'
      LIMIT 1
    `;

    const teacherResult = await query(teacherQuery, [user.id]);

    if (teacherResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'التدريسي غير موجود أو غير نشط' },
        { status: 404 }
      );
    }

    const teacher = teacherResult.rows[0];

    return NextResponse.json({
      success: true,
      data: teacher
    });

  } catch (error: unknown) {
    console.error('خطأ في جلب الملف الشخصي:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في جلب الملف الشخصي: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

