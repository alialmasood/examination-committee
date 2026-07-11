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
    const boxes = await query(
      `SELECT cb.id, cb.code, cb.name_ar, cb.status, cb.account_id,
              pc.user_id AS primary_custodian_user_id,
              u.username AS primary_custodian_username
       FROM accounts.cash_boxes cb
       LEFT JOIN accounts.cash_box_custodians pc
         ON pc.cash_box_id = cb.id AND pc.is_primary = TRUE AND pc.valid_to IS NULL
       LEFT JOIN student_affairs.users u ON u.id = pc.user_id
       WHERE cb.status = 'ACTIVE'
       ORDER BY cb.code`
    );

    const years = await query(
      `SELECT id, code, name_ar, status, start_date::text AS start_date, end_date::text AS end_date,
              is_default
       FROM accounts.fiscal_years
       WHERE status = 'ACTIVE'
       ORDER BY start_date DESC`
    );

    const yearIds = years.rows.map((y) => y.id as string);
    const periods =
      yearIds.length === 0
        ? { rows: [] as Array<Record<string, unknown>> }
        : await query(
            `SELECT id, fiscal_year_id, code, name_ar, status,
                    start_date::text AS start_date, end_date::text AS end_date
             FROM accounts.fiscal_periods
             WHERE fiscal_year_id = ANY($1::uuid[])
               AND status = 'OPEN'
             ORDER BY start_date`,
            [yearIds]
          );

    const live = await query(
      `SELECT cash_box_id, id AS session_id, status, session_date::text AS session_date
       FROM accounts.cash_box_sessions
       WHERE status IN ('OPEN', 'CLOSING')`
    );

    return jsonSuccess({
      data: {
        cash_boxes: boxes.rows,
        fiscal_years: years.rows,
        fiscal_periods: periods.rows,
        live_sessions: live.rows,
        session_statuses: ['OPEN', 'CLOSING', 'CLOSED'],
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
