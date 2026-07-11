import { NextRequest } from 'next/server';
import {
  isAuthFailure,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { buildAccountTree } from '@/src/lib/accounts/chart-of-accounts';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const active = request.nextUrl.searchParams.get('is_active');
    const typeId = request.nextUrl.searchParams.get('account_type_id');
    const isGroup = request.nextUrl.searchParams.get('is_group');

    const result = await query(
      `SELECT a.*, t.code AS account_type_code, t.name_ar AS account_type_name_ar,
              (SELECT COUNT(*)::int FROM accounts.chart_of_accounts c WHERE c.parent_id = a.id) AS children_count
       FROM accounts.chart_of_accounts a
       JOIN accounts.account_types t ON t.id = a.account_type_id
       WHERE ($1::boolean IS NULL OR a.is_active = $1::boolean)
         AND ($2::uuid IS NULL OR a.account_type_id = $2::uuid)
         AND ($3::boolean IS NULL OR a.is_group = $3::boolean)
       ORDER BY a.sort_order ASC, a.code ASC`,
      [
        active === null || active === '' ? null : active === 'true' || active === '1',
        typeId || null,
        isGroup === null || isGroup === '' ? null : isGroup === 'true' || isGroup === '1',
      ]
    );

    const tree = buildAccountTree(result.rows);
    return jsonSuccess({
      data: tree,
      flat: result.rows,
      totals: {
        total: result.rows.length,
        active: result.rows.filter((r) => r.is_active).length,
        inactive: result.rows.filter((r) => !r.is_active).length,
        groups: result.rows.filter((r) => r.is_group).length,
        posting: result.rows.filter((r) => r.allow_posting).length,
      },
    });
  } catch (error) {
    return mapPgError(error);
  }
}
