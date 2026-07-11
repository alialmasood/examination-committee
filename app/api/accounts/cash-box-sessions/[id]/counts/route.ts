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
  listCashCountsForSession,
  loadCashSession,
  serializeCashCount,
} from '@/src/lib/accounts/cash-box-sessions';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const counts = await withTransaction(async (client) => {
      await loadCashSession(client, id);
      return listCashCountsForSession(client, id);
    });

    return jsonSuccess({
      data: counts.map(serializeCashCount),
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
