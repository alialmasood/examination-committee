import { NextRequest } from 'next/server';
import {
  isAuthFailure,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { suggestNextAccountCode } from '@/src/lib/accounts/chart-of-accounts';
import {
  acquireChartOfAccountsLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const parentId = request.nextUrl.searchParams.get('parent_id');
    const result = await withTransaction(async (client) => {
      await acquireChartOfAccountsLock(client);
      return suggestNextAccountCode(client, parentId || null);
    });
    return jsonSuccess({ data: result });
  } catch (error) {
    return mapPgError(error);
  }
}
