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

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const cashBoxId = request.nextUrl.searchParams.get('cash_box_id');

    const boxes = await query(
      `SELECT cb.id, cb.code, cb.name_ar, cb.status, cb.account_id, cb.currency_code,
              a.code AS account_code, a.name_ar AS account_name_ar,
              pc.user_id AS primary_custodian_user_id
       FROM accounts.cash_boxes cb
       LEFT JOIN accounts.chart_of_accounts a ON a.id = cb.account_id
       LEFT JOIN accounts.cash_box_custodians pc
         ON pc.cash_box_id = cb.id AND pc.is_primary AND pc.valid_to IS NULL
       WHERE cb.status = 'ACTIVE'
       ORDER BY cb.code`
    );

    const sessions = await query(
      `SELECT s.id, s.cash_box_id, s.session_date::text AS session_date, s.status,
              s.fiscal_year_id, s.fiscal_period_id, s.opening_book_balance::text AS opening_book_balance
       FROM accounts.cash_box_sessions s
       WHERE s.status = 'OPEN'
         AND ($1::uuid IS NULL OR s.cash_box_id = $1::uuid)
       ORDER BY s.session_date DESC`,
      [cashBoxId || null]
    );

    const accounts = await query(
      `SELECT a.id, a.code, a.name_ar, t.code AS account_type_code, a.requires_cost_center
       FROM accounts.chart_of_accounts a
       JOIN accounts.account_types t ON t.id = a.account_type_id
       WHERE NOT a.is_group AND a.allow_posting AND a.is_active
       ORDER BY a.code
       LIMIT 500`
    );

    const costCenters = await query(
      `SELECT id, code, name_ar FROM accounts.cost_centers
       WHERE is_active AND NOT is_group
       ORDER BY code LIMIT 200`
    );

    return jsonSuccess({
      data: {
        cash_boxes: boxes.rows,
        open_sessions: sessions.rows,
        posting_accounts: accounts.rows,
        cost_centers: costCenters.rows,
        voucher_types: [
          { code: 'CASH_RECEIPT', name_ar: 'سند قبض' },
          { code: 'CASH_PAYMENT', name_ar: 'سند صرف' },
        ],
        statuses: [
          { code: 'DRAFT', name_ar: 'مسودة' },
          { code: 'POSTED', name_ar: 'مرحّل' },
          { code: 'VOID', name_ar: 'ملغى' },
        ],
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
