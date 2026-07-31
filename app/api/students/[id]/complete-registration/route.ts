import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import { logAuditDirect } from '@/src/lib/audit';
import {
  activateStudentsAsPaid,
  syncStudentAccountsAfterActivation,
} from '@/src/lib/accounts/activate-student-after-registration';

// POST /api/students/[id]/complete-registration - إتمام التسجيل
// يُرحَّل الطالب مباشرة إلى حسابات الطلبة (paid) دون المرور بطابور الأقساط.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const studentResult = await query(
      `SELECT id, full_name, university_id, payment_status,
              (to_jsonb(s)->>'payment_status') as payment_status_jsonb
       FROM student_affairs.students s
       WHERE id = $1`,
      [id]
    );

    if (studentResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'الطالب غير موجود' },
        { status: 404 }
      );
    }

    const row = studentResult.rows[0];
    const currentPaymentStatus =
      row.payment_status || row.payment_status_jsonb || 'pending';

    if (currentPaymentStatus !== 'registration_pending') {
      return NextResponse.json(
        { success: false, error: 'الطالب ليس قيد التسجيل' },
        { status: 400 }
      );
    }

    const { updatedIds } = await activateStudentsAsPaid({
      studentIds: [id],
      fromStatuses: ['registration_pending'],
    });

    if (updatedIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'تعذر إتمام تسجيل الطالب' },
        { status: 400 }
      );
    }

    let userId: string | null = null;
    try {
      const accessToken = req.cookies.get('access_token')?.value;
      if (accessToken) {
        const payload = verifyAccessToken(accessToken);
        if (payload) {
          const user = await validateUser(payload.user_id);
          if (user) {
            userId = user.id;
            const ip_address =
              req.headers.get('x-forwarded-for') ||
              req.headers.get('x-real-ip') ||
              'unknown';
            const user_agent = req.headers.get('user-agent') || 'unknown';

            await logAuditDirect({
              user_id: user.id,
              username: user.username,
              full_name: user.full_name || null,
              action_type: 'complete_registration',
              entity_type: 'student',
              entity_id: id,
              entity_name: row.full_name || row.university_id,
              description: `تم إتمام تسجيل الطالب وترحيله إلى حسابات الطلبة: ${row.full_name || 'غير محدد'} (${row.university_id})`,
              old_values: {
                payment_status: 'registration_pending',
              },
              new_values: {
                payment_status: 'paid',
              },
              ip_address,
              user_agent,
            });
          }
        }
      }
    } catch (error) {
      console.error('خطأ في تسجيل العملية:', error);
    }

    await syncStudentAccountsAfterActivation(userId, updatedIds);

    return NextResponse.json({
      success: true,
      message:
        'تم إتمام التسجيل بنجاح — سيظهر الطالب في حسابات الطلبة لإصدار وصل التسديد',
    });
  } catch (e) {
    console.error('خطأ في إتمام التسجيل:', e);
    return NextResponse.json(
      { success: false, error: 'خطأ في إتمام التسجيل' },
      { status: 500 }
    );
  }
}
