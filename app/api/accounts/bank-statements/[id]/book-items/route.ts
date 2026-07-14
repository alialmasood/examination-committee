import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { listBookItems } from '@/src/lib/accounts/bank-reconciliation';
import { assertCanAccessBankStatement } from '@/src/lib/accounts/bank-statements';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const sp = request.nextUrl.searchParams;
    const q = sp.get('q');
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(200, Math.max(1, Number(sp.get('page_size') || 50)));
    const unmatchedOnly = sp.get('unmatched_only') === 'true';

    const result = await withTransaction(async (client) => {
      try {
        await assertCanAccessBankStatement(client, {
          statementId: id,
          userId: auth.user.id,
        });
      } catch (e) {
        if (e instanceof AccountsHttpError && e.status === 403) {
          throw new AccountsHttpError('كشف الحساب المصرفي غير موجود', 404);
        }
        throw e;
      }
      return listBookItems(client, {
        statementId: id,
        q,
        page,
        pageSize,
        unmatchedOnly,
      });
    });

    return jsonSuccess({
      data: result.items,
      pagination: {
        page: result.page,
        page_size: result.pageSize,
        total: result.total,
        total_pages: Math.max(1, Math.ceil(result.total / result.pageSize)),
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
