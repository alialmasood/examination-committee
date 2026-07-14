import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { calculateBankReconciliation } from '@/src/lib/accounts/bank-reconciliation';
import { assertCanAccessBankStatement } from '@/src/lib/accounts/bank-statements';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;

    const summary = await withTransaction(async (client) => {
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
      return calculateBankReconciliation(client, id);
    });

    return jsonSuccess({ data: summary });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
