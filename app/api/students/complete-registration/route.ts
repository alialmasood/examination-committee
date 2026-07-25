import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import { logAuditDirect } from '@/src/lib/audit';

// POST /api/students/complete-registration
// إتمام تسجيل كل الطلبة قيد التسجيل، أو طلبة قسم محدد.
export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('access_token')?.value;
    const payload = accessToken ? verifyAccessToken(accessToken) : null;
    const user = payload ? await validateUser(payload.user_id) : null;

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بتنفيذ هذه العملية' },
        { status: 401 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      department?: unknown;
    };
    const department =
      typeof body.department === 'string' ? body.department.trim() : '';

    const params: string[] = [];
    let departmentCondition = '';

    if (department) {
      params.push(department);
      departmentCondition =
        'AND normalize_arabic(COALESCE(major, \'\')) = normalize_arabic($1)';
    }

    const result = await query(
      `UPDATE student_affairs.students
       SET payment_status = 'pending',
           updated_at = NOW()
       WHERE TRIM(COALESCE(payment_status, '')) = 'registration_pending'
       ${departmentCondition}
       RETURNING id`,
      params
    );

    const completedCount = result.rowCount ?? 0;
    const scopeDescription = department
      ? `قسم ${department}`
      : 'جميع الأقسام';

    const ipAddress =
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await logAuditDirect({
      user_id: user.id,
      username: user.username,
      full_name: user.full_name || null,
      action_type: 'bulk_complete_registration',
      entity_type: 'student',
      entity_name: scopeDescription,
      description: `تم إتمام تسجيل ${completedCount} طالب ضمن ${scopeDescription}`,
      old_values: {
        payment_status: 'registration_pending',
        department: department || null,
      },
      new_values: {
        payment_status: 'pending',
        completed_count: completedCount,
      },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    return NextResponse.json({
      success: true,
      completed_count: completedCount,
      message:
        completedCount > 0
          ? `تم إتمام تسجيل ${completedCount} طالب بنجاح`
          : `لا يوجد طلاب قيد التسجيل ضمن ${scopeDescription}`,
    });
  } catch (error) {
    console.error('خطأ في إتمام تسجيل الطلبة جماعياً:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء إتمام تسجيل الطلبة' },
      { status: 500 }
    );
  }
}
