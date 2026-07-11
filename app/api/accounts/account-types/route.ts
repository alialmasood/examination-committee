import { NextRequest } from 'next/server';
import {
  isAuthFailure,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const activeOnly = request.nextUrl.searchParams.get('active') !== '0';
    const result = await query(
      `SELECT id, code, name_ar, name_en, normal_balance, sort_order, is_active
       FROM accounts.account_types
       WHERE ($1::boolean = FALSE OR is_active = TRUE)
       ORDER BY sort_order ASC, code ASC`,
      [activeOnly]
    );
    return jsonSuccess({ data: result.rows });
  } catch (error) {
    return mapPgError(error);
  }
}
