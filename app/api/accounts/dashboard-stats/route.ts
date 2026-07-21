import { NextRequest } from 'next/server';
import {
  isAuthFailure,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { getAccountsDashboardStats } from '@/src/lib/accounts/accounts-dashboard';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const stats = await withTransaction((client) => getAccountsDashboardStats(client));
    return jsonSuccess({ stats });
  } catch (error) {
    return mapPgError(error);
  }
}
