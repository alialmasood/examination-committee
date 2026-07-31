import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import {
  activateStudentsAsPaid,
  ensureStudentPaymentColumns,
  syncStudentAccountsAfterActivation,
} from '@/src/lib/accounts/activate-student-after-registration';

/**
 * POST /api/accounts/installments/mark-paid
 * مسار انتقالي: تفعيل الطلبة العالقين بـ pending إلى paid (بدون وصل).
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAccountsAccess(req);
    if (isAuthFailure(auth)) {
      return auth.response;
    }

    const body = (await req.json().catch(() => ({}))) as {
      department?: unknown;
    };
    const department =
      typeof body.department === 'string' ? body.department.trim() : '';

    await ensureStudentPaymentColumns();

    const params: string[] = [];
    let departmentCondition = '';
    if (department) {
      params.push(department);
      departmentCondition =
        "AND normalize_arabic(COALESCE(major, '')) = normalize_arabic($1)";
    }

    const pendingResult = await query(
      `SELECT id
       FROM student_affairs.students
       WHERE TRIM(COALESCE(payment_status, '')) = 'pending'
       ${departmentCondition}
       ORDER BY created_at DESC NULLS LAST`,
      params
    );

    if (pendingResult.rows.length === 0) {
      const scope = department ? `قسم ${department}` : 'قائمة الانتظار';
      return NextResponse.json({
        success: true,
        updated_count: 0,
        message: `لا يوجد طلبة بانتظار تأكيد الدفع ضمن ${scope}`,
      });
    }

    const candidateIds = pendingResult.rows.map((r: { id: string }) =>
      String(r.id)
    );
    const { updatedIds } = await activateStudentsAsPaid({
      studentIds: candidateIds,
      fromStatuses: ['pending'],
    });

    await syncStudentAccountsAfterActivation(auth.user.id, updatedIds);

    return NextResponse.json({
      success: true,
      updated_count: updatedIds.length,
      message: `تم تفعيل ${updatedIds.length} طالب في حسابات الطلبة`,
    });
  } catch (error) {
    console.error('خطأ في تأكيد الدفع الجماعي:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تأكيد الدفع للجميع' },
      { status: 500 }
    );
  }
}
