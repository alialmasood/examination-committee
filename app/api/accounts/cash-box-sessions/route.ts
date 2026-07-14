import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import {
  openCashSession,
  serializeCashSession,
} from '@/src/lib/accounts/cash-box-sessions';
import {
  acquireCashBoxesLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { sqlUserCanViewCashBox } from '@/src/lib/accounts/cash-box-access';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const sp = request.nextUrl.searchParams;
    const cashBoxId = sp.get('cash_box_id');
    const status = sp.get('status');
    const q = sp.get('q')?.trim() || '';
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('page_size') || 20)));
    const offset = (page - 1) * pageSize;

    const where = `
      WHERE ($1::uuid IS NULL OR s.cash_box_id = $1::uuid)
        AND ($2::text IS NULL OR s.status = $2)
        AND (
          $3 = ''
          OR cb.code ILIKE '%'||$3||'%'
          OR cb.name_ar ILIKE '%'||$3||'%'
          OR s.id::text ILIKE '%'||$3||'%'
          OR COALESCE(u.username,'') ILIKE '%'||$3||'%'
        )
        AND ${sqlUserCanViewCashBox('$4', 's.cash_box_id')}
    `;
    const params = [cashBoxId || null, status || null, q, auth.user.id];

    const countRes = await query(
      `SELECT COUNT(*)::int AS total
       FROM accounts.cash_box_sessions s
       JOIN accounts.cash_boxes cb ON cb.id = s.cash_box_id
       LEFT JOIN student_affairs.users u ON u.id = s.primary_custodian_user_id
       ${where}`,
      params
    );

    const statsRes = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE s.status = 'OPEN')::int AS open,
         COUNT(*) FILTER (WHERE s.status = 'CLOSING')::int AS closing,
         COUNT(*) FILTER (WHERE s.status = 'CLOSED')::int AS closed
       FROM accounts.cash_box_sessions s
       JOIN accounts.cash_boxes cb ON cb.id = s.cash_box_id
       LEFT JOIN student_affairs.users u ON u.id = s.primary_custodian_user_id
       ${where}`,
      params
    );

    const listRes = await query(
      `SELECT s.*,
              cb.code AS cash_box_code,
              cb.name_ar AS cash_box_name_ar,
              fy.code AS fiscal_year_code,
              fp.code AS fiscal_period_code,
              u.username AS primary_custodian_username,
              COALESCE(u.full_name, u.username) AS primary_custodian_name
       FROM accounts.cash_box_sessions s
       JOIN accounts.cash_boxes cb ON cb.id = s.cash_box_id
       JOIN accounts.fiscal_years fy ON fy.id = s.fiscal_year_id
       JOIN accounts.fiscal_periods fp ON fp.id = s.fiscal_period_id
       LEFT JOIN student_affairs.users u ON u.id = s.primary_custodian_user_id
       ${where}
       ORDER BY s.session_date DESC, s.opened_at DESC
       LIMIT $5 OFFSET $6`,
      [...params, pageSize, offset]
    );

    const total = (countRes.rows[0]?.total as number) ?? 0;
    return jsonSuccess({
      data: listRes.rows.map((row) => ({
        ...serializeCashSession(row as never),
        cash_box_code: row.cash_box_code,
        cash_box_name_ar: row.cash_box_name_ar,
        fiscal_year_code: row.fiscal_year_code,
        fiscal_period_code: row.fiscal_period_code,
        primary_custodian_username: row.primary_custodian_username,
        primary_custodian_name: row.primary_custodian_name,
      })),
      stats: statsRes.rows[0] ?? { total: 0, open: 0, closing: 0, closed: 0 },
      page,
      page_size: pageSize,
      total,
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const body = await request.json();
    const session = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const created = await openCashSession(client, {
        cash_box_id: body.cash_box_id,
        fiscal_year_id: body.fiscal_year_id,
        fiscal_period_id: body.fiscal_period_id,
        session_date: body.session_date,
        notes: body.notes,
        opened_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_session.opened',
        entityType: 'cash_box_session',
        entityId: created.id,
        newValues: {
          ...serializeCashSession(created),
          cash_box_id: created.cash_box_id,
          primary_custodian_user_id: created.primary_custodian_user_id,
          fiscal_year_id: created.fiscal_year_id,
          fiscal_period_id: created.fiscal_period_id,
          opening_book_balance: created.opening_book_balance,
        },
        description: 'فتح جلسة صندوق يومية',
      });
      return created;
    });

    return jsonSuccess({ data: serializeCashSession(session) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
