import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import {
  createStudentAccount,
  ensureStudentAccountsForPaidStudents,
  listStudentAccounts,
  serializeStudentAccount,
} from '@/src/lib/accounts/student-accounts';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertStudentReceivablesCapability(
      null,
      auth.user.id,
      STUDENT_RECEIVABLES_CAPABILITIES.VIEW
    );

    const sp = request.nextUrl.searchParams;
    const hasBalanceRaw = sp.get('has_balance');
    const hasBalance =
      hasBalanceRaw == null || hasBalanceRaw === ''
        ? null
        : hasBalanceRaw === '1' || hasBalanceRaw.toLowerCase() === 'true';

    const result = await withTransaction(async (client) => {
      // مزامنة الطلبة المسددين من صفحة الأقساط إلى الحسابات المالية
      await ensureStudentAccountsForPaidStudents(client, auth.user.id);
      return listStudentAccounts(client, {
        q: sp.get('q')?.trim() || '',
        status: sp.get('status') || null,
        department_id: sp.get('department_id') || null,
        admission_type: sp.get('admission_type') || null,
        academic_year: sp.get('academic_year') || null,
        has_balance: hasBalance,
        page: Math.max(1, Number(sp.get('page') || 1)),
        page_size: Math.min(100, Math.max(1, Number(sp.get('page_size') || 20))),
      });
    });

    return jsonSuccess({
      data: result.rows.map((r) => ({
        ...serializeStudentAccount(r),
        student_full_name_ar: r.student_full_name_ar ?? null,
        student_university_id: r.student_university_id ?? null,
        student_number: r.student_number ?? null,
        student_major: r.student_major ?? null,
        student_admission_type: r.student_admission_type ?? null,
        receivable_gl_code: r.receivable_gl_code ?? null,
        receivable_gl_name_ar: r.receivable_gl_name_ar ?? null,
      })),
      pagination: {
        page: result.page,
        page_size: result.page_size,
        total: result.total,
        total_pages: Math.ceil(result.total / result.page_size) || 1,
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const body = await request.json();
    const created = await withTransaction(async (client) => {
      await assertStudentReceivablesCapability(
        client,
        auth.user.id,
        STUDENT_RECEIVABLES_CAPABILITIES.MANAGE
      );
      const row = await createStudentAccount(client, {
        ...body,
        created_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'student_account.created',
        entityType: 'student_account',
        entityId: row.id,
        newValues: serializeStudentAccount(row),
        description: `إنشاء حساب مالي للطالب ${row.account_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeStudentAccount(created) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
