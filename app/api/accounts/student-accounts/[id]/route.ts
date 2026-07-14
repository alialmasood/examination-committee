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
  loadStudentAccount,
  serializeStudentAccount,
  updateStudentAccount,
} from '@/src/lib/accounts/student-accounts';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { loadStudentRef } from '@/src/lib/accounts/students-ref';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertStudentReceivablesCapability(
      null,
      auth.user.id,
      STUDENT_RECEIVABLES_CAPABILITIES.VIEW
    );
    const { id } = await context.params;
    const detail = await query(
      `SELECT sa.*,
              a.code AS receivable_gl_code,
              a.name_ar AS receivable_gl_name_ar
       FROM accounts.student_accounts sa
       LEFT JOIN accounts.chart_of_accounts a ON a.id = sa.receivable_gl_account_id
       WHERE sa.id = $1::uuid`,
      [id]
    );
    if (!detail.rows[0]) {
      return jsonError('الحساب المالي للطالب غير موجود', 404);
    }

    const row = detail.rows[0];
    const student = await withTransaction((client) =>
      loadStudentRef(client, row.student_id as string)
    );

    return jsonSuccess({
      data: {
        ...serializeStudentAccount(
          row as Parameters<typeof serializeStudentAccount>[0]
        ),
        receivable_gl_code: row.receivable_gl_code ?? null,
        receivable_gl_name_ar: row.receivable_gl_name_ar ?? null,
        student,
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const status = error.status === 403 ? 404 : error.status;
      return jsonError(
        status === 404 ? 'الحساب المالي للطالب غير موجود' : error.message,
        status
      );
    }
    return mapPgError(error);
  }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const updated = await withTransaction(async (client) => {
      await assertStudentReceivablesCapability(
        client,
        auth.user.id,
        STUDENT_RECEIVABLES_CAPABILITIES.MANAGE
      );
      const before = await loadStudentAccount(client, id);
      const row = await updateStudentAccount(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        department_id: body.department_id,
        academic_year: body.academic_year,
        opening_reference: body.opening_reference,
        notes: body.notes,
        receivable_gl_account_id: body.receivable_gl_account_id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'student_account.updated',
        entityType: 'student_account',
        entityId: row.id,
        oldValues: serializeStudentAccount(before),
        newValues: serializeStudentAccount(row),
        description: `تعديل حساب مالي للطالب ${row.account_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeStudentAccount(updated) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
