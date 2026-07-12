import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { listAdjustmentsForSessionView } from '@/src/lib/accounts/cash-count-adjustments';
import { loadCashSession } from '@/src/lib/accounts/cash-box-sessions';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const rows = await withTransaction(async (client) => {
      await loadCashSession(client, id);
      return listAdjustmentsForSessionView(client, id);
    });
    return jsonSuccess({
      data: rows,
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
