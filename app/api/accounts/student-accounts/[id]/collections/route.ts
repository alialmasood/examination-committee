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
  listStudentCollections,
  serializeStudentCollection,
} from '@/src/lib/accounts/student-collections';
import { loadStudentAccount } from '@/src/lib/accounts/student-accounts';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  hasStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

async function assertBillingReadAccess(
  client: Parameters<typeof hasStudentReceivablesCapability>[0],
  userId: string
): Promise<void> {
  const canView =
    (await hasStudentReceivablesCapability(
      client,
      userId,
      STUDENT_RECEIVABLES_CAPABILITIES.VIEW
    )) ||
    (await hasStudentReceivablesCapability(
      client,
      userId,
      STUDENT_RECEIVABLES_CAPABILITIES.BILLING_VIEW
    ));
  if (!canView) {
    throw new AccountsHttpError(
      `ليس لديك صلاحية العملية المطلوبة (${STUDENT_RECEIVABLES_CAPABILITIES.BILLING_VIEW})`,
      403
    );
  }
}

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertBillingReadAccess(null, auth.user.id);
    const { id } = await context.params;
    const sp = request.nextUrl.searchParams;

    const result = await withTransaction(async (client) => {
      await loadStudentAccount(client, id);
      return listStudentCollections(client, {
        q: sp.get('q')?.trim() || '',
        status: sp.get('status') || null,
        student_account_id: id,
        student_id: null,
        payment_method: sp.get('payment_method') || null,
        page: Math.max(1, Number(sp.get('page') || 1)),
        page_size: Math.min(100, Math.max(1, Number(sp.get('page_size') || 20))),
      });
    });

    return jsonSuccess({
      data: result.rows.map((r) => ({
        ...serializeStudentCollection(r),
        account_number: r.account_number ?? null,
        student_full_name_ar: r.student_full_name_ar ?? null,
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
      const status = error.status === 403 ? 404 : error.status;
      return jsonError(
        status === 404 ? 'الحساب المالي للطالب غير موجود' : error.message,
        status
      );
    }
    return mapPgError(error);
  }
}
