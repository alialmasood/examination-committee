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
  closeStudentAccount,
  loadStudentAccount,
  serializeStudentAccount,
} from '@/src/lib/accounts/student-accounts';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const closed = await withTransaction(async (client) => {
      const before = await loadStudentAccount(client, id);
      const row = await closeStudentAccount(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'student_account.closed',
        entityType: 'student_account',
        entityId: row.id,
        oldValues: serializeStudentAccount(before),
        newValues: serializeStudentAccount(row),
        description: `إغلاق حساب مالي للطالب ${row.account_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeStudentAccount(closed) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const status = error.status === 403 ? 403 : error.status;
      return jsonError(error.message, status);
    }
    return mapPgError(error);
  }
}
