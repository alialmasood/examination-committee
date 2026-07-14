import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { removeReconciliationMatch } from '@/src/lib/accounts/bank-reconciliation';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string; matchId: string }> };

export async function DELETE(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { matchId } = await context.params;

    const result = await withTransaction((client) =>
      removeReconciliationMatch(client, { matchId, userId: auth.user.id })
    );

    return jsonSuccess({ data: { removed: result.removed, line_id: result.lineId } });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
