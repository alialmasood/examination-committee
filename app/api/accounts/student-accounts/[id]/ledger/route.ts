import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import {
  getStudentLedger,
  serializeStudentLedgerEntry,
} from '@/src/lib/accounts/student-charges';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

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
    const sp = request.nextUrl.searchParams;

    const result = await withTransaction((client) =>
      getStudentLedger(client, {
        studentAccountId: id,
        page: Math.max(1, Number(sp.get('page') || 1)),
        page_size: Math.min(100, Math.max(1, Number(sp.get('page_size') || 50))),
        date_from: sp.get('date_from') || null,
        date_to: sp.get('date_to') || null,
      })
    );

    return jsonSuccess({
      data: result.rows.map(serializeStudentLedgerEntry),
      balance: result.balance,
      pagination: {
        page: result.page,
        page_size: result.page_size,
        total: result.total,
        total_pages: Math.ceil(result.total / result.page_size) || 1,
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
