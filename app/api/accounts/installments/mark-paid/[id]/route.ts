import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { getSystemPathByDepartment } from '@/src/lib/department-system-map';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import {
  activateStudentsAsPaid,
  syncStudentAccountsAfterActivation,
} from '@/src/lib/accounts/activate-student-after-registration';

/**
 * POST /api/accounts/installments/mark-paid/[id]
 * مسار انتقالي لطلبة عالقين بحالة pending — يفعّلهم إلى paid.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const amount = Number(body?.amount ?? 0) || null;

    const studentResult = await query(
      `SELECT major, university_id, study_type, admission_channel, payment_status
       FROM student_affairs.students WHERE id = $1`,
      [id]
    );

    if (studentResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'الطالب غير موجود' },
        { status: 404 }
      );
    }

    const department = studentResult.rows[0].major;
    const systemPath = getSystemPathByDepartment(department);
    const status = String(studentResult.rows[0].payment_status || '').trim();

    if (status === 'paid') {
      return NextResponse.json({
        success: true,
        systemPath: systemPath || null,
        department: department || null,
        message: 'الطالب مفعّل مسبقاً في حسابات الطلبة',
      });
    }

    if (status !== 'pending' && status !== 'registration_pending') {
      return NextResponse.json(
        { success: false, error: 'حالة الطالب لا تسمح بتأكيد الدفع' },
        { status: 400 }
      );
    }

    const { updatedIds } = await activateStudentsAsPaid({
      studentIds: [id],
      paymentAmount: amount,
      fromStatuses: [status],
    });

    if (updatedIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'تعذر تأكيد الدفع' },
        { status: 400 }
      );
    }

    try {
      const auth = await requireAccountsAccess(req);
      if (!isAuthFailure(auth)) {
        await syncStudentAccountsAfterActivation(auth.user.id, updatedIds);
      }
    } catch (syncErr) {
      console.error('تعذر مزامنة الحساب المالي بعد تأكيد الدفع:', syncErr);
    }

    return NextResponse.json({
      success: true,
      systemPath: systemPath || null,
      department: department || null,
    });
  } catch (e) {
    console.error('خطأ في تحديث حالة الدفع:', e);
    return NextResponse.json(
      { success: false, error: 'خطأ في تحديث حالة الدفع' },
      { status: 500 }
    );
  }
}
