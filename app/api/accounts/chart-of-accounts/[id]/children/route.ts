import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const parent = await query(`SELECT id FROM accounts.chart_of_accounts WHERE id = $1`, [id]);
    if (parent.rows.length === 0) {
      return jsonError('الحساب غير موجود', 404);
    }

    const result = await query(
      `SELECT a.*, t.code AS account_type_code, t.name_ar AS account_type_name_ar,
              (SELECT COUNT(*)::int FROM accounts.chart_of_accounts c WHERE c.parent_id = a.id) AS children_count
       FROM accounts.chart_of_accounts a
       JOIN accounts.account_types t ON t.id = a.account_type_id
       WHERE a.parent_id = $1
       ORDER BY a.sort_order ASC, a.code ASC`,
      [id]
    );
    return jsonSuccess({ data: result.rows });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
