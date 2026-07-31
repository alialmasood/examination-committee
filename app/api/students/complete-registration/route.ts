import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import { logAuditDirect } from '@/src/lib/audit';
import {
  activateStudentsAsPaid,
  syncStudentAccountsAfterActivation,
} from '@/src/lib/accounts/activate-student-after-registration';

// POST /api/students/complete-registration
// إتمام تسجيل الطلبة قيد التسجيل وترحيلهم مباشرة إلى حسابات الطلبة (paid).
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

    const params: (string | string[])[] = [];
    let departmentCondition = '';
    let scopeDescription = 'جميع الأقسام';

    if (
      department === '__other__' ||
      department === 'other' ||
      department === 'أخرى'
    ) {
      const knownDepartments = [
        'تقنيات التخدير',
        'تقنيات الاشعة',
        'تقنيات الأشعة',
        'تقنيات صناعة الاسنان',
        'تقنيات صناعة الأسنان',
        'هندسة تقنيات البناء والانشاءات',
        'تقنيات البناء والاستشارات',
        'تقنيات هندسة النفط والغاز',
        'تقنيات الفيزياء الصحية',
        'تقنيات البصريات',
        'تقنيات صحة المجتمع',
        'تقنيات طب الطوارئ',
        'تقنيات العلاج الطبيعي',
        'هندسة تقنيات الامن السيبراني والحوسبة السحابية',
        'تقنيات الامن السيبراني',
        'تقنيات الأمن السيبراني',
        'القانون',
      ];
      params.push(knownDepartments);
      departmentCondition = `AND (
        TRIM(COALESCE(major, '')) = ''
        OR NOT EXISTS (
          SELECT 1
          FROM unnest($1::text[]) AS known(name)
          WHERE normalize_arabic(known.name) = normalize_arabic(COALESCE(major, ''))
        )
      )`;
      scopeDescription = 'الطلبة بدون قسم مطابق (أخرى)';
    } else if (department) {
      params.push(department);
      departmentCondition =
        "AND normalize_arabic(COALESCE(major, '')) = normalize_arabic($1)";
      scopeDescription = `قسم ${department}`;
    }

    const pendingRes = await query(
      `SELECT id
       FROM student_affairs.students
       WHERE TRIM(COALESCE(payment_status, '')) = 'registration_pending'
       ${departmentCondition}
       ORDER BY created_at DESC NULLS LAST`,
      params
    );

    const candidateIds = pendingRes.rows.map((r: { id: string }) => String(r.id));
    const { updatedIds } = await activateStudentsAsPaid({
      studentIds: candidateIds,
      fromStatuses: ['registration_pending'],
    });

    const completedCount = updatedIds.length;

    await syncStudentAccountsAfterActivation(user.id, updatedIds);

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
      description: `تم إتمام تسجيل ${completedCount} طالب وترحيلهم إلى حسابات الطلبة ضمن ${scopeDescription}`,
      old_values: {
        payment_status: 'registration_pending',
        department: department || null,
      },
      new_values: {
        payment_status: 'paid',
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
          ? `تم إتمام تسجيل ${completedCount} طالب — سيظهرون في حسابات الطلبة لإصدار وصل التسديد`
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
