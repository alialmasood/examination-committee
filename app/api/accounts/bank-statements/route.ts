import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { sqlUserCanAccessBankStatementAccount } from '@/src/lib/accounts/bank-account-access';
import {
  createBankStatement,
  serializeBankStatement,
} from '@/src/lib/accounts/bank-statements';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const sp = request.nextUrl.searchParams;
    const q = sp.get('q')?.trim() || '';
    const bankAccountId = sp.get('bank_account_id');
    const bankId = sp.get('bank_id');
    const status = sp.get('status');
    const currency = sp.get('currency');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('page_size') || 20)));
    const offset = (page - 1) * pageSize;

    const where = `
      WHERE ($1 = '' OR s.statement_number ILIKE '%'||$1||'%'
             OR COALESCE(s.external_statement_reference,'') ILIKE '%'||$1||'%'
             OR COALESCE(s.notes,'') ILIKE '%'||$1||'%')
        AND ($2::uuid IS NULL OR s.bank_account_id = $2::uuid)
        AND ($3::uuid IS NULL OR ba.bank_id = $3::uuid)
        AND ($4::text IS NULL OR s.status = $4)
        AND ($5::text IS NULL OR s.currency_code = $5)
        AND ($6::date IS NULL OR s.date_to >= $6::date)
        AND ($7::date IS NULL OR s.date_from <= $7::date)
        AND ${sqlUserCanAccessBankStatementAccount('$8', 's.bank_account_id')}
    `;
    const params = [
      q,
      bankAccountId || null,
      bankId || null,
      status || null,
      currency || null,
      dateFrom || null,
      dateTo || null,
      auth.user.id,
    ];

    const fromJoin = `
      FROM accounts.bank_statements s
      JOIN accounts.bank_accounts ba ON ba.id = s.bank_account_id
      JOIN accounts.banks b ON b.id = ba.bank_id
    `;

    const countRes = await query(
      `SELECT COUNT(*)::int AS total ${fromJoin} ${where}`,
      params
    );

    const statsRes = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE s.status = 'DRAFT')::int AS draft,
         COUNT(*) FILTER (WHERE s.status = 'IN_PROGRESS')::int AS in_progress,
         COUNT(*) FILTER (WHERE s.status = 'RECONCILED')::int AS reconciled,
         COUNT(*) FILTER (WHERE s.status = 'CLOSED')::int AS closed,
         COUNT(*) FILTER (WHERE s.status = 'CANCELLED')::int AS cancelled
       ${fromJoin} ${where}`,
      params
    );

    const listRes = await query(
      `SELECT s.*,
              ba.code AS bank_account_code,
              ba.account_name_ar AS bank_account_name_ar,
              b.code AS bank_code,
              b.name_ar AS bank_name_ar,
              COALESCE(u.full_name, u.username) AS created_by_name,
              (SELECT COUNT(*)::int FROM accounts.bank_statement_lines l
                WHERE l.bank_statement_id = s.id) AS lines_count,
              (SELECT COUNT(*)::int FROM accounts.bank_statement_lines l
                WHERE l.bank_statement_id = s.id AND l.match_status = 'MATCHED') AS matched_lines_count,
              (SELECT COUNT(*)::int FROM accounts.bank_statement_lines l
                WHERE l.bank_statement_id = s.id
                  AND l.match_status IN ('UNMATCHED', 'PARTIALLY_MATCHED')) AS unresolved_lines_count
       ${fromJoin}
       LEFT JOIN student_affairs.users u ON u.id = s.created_by
       ${where}
       ORDER BY s.date_to DESC, s.created_at DESC
       LIMIT $9 OFFSET $10`,
      [...params, pageSize, offset]
    );

    const total = countRes.rows[0]?.total ?? 0;
    const st = statsRes.rows[0] || {};

    return jsonSuccess({
      data: listRes.rows.map((row) => ({
        ...serializeBankStatement(row as never),
        bank_account_code: row.bank_account_code,
        bank_account_name_ar: row.bank_account_name_ar,
        bank_code: row.bank_code,
        bank_name_ar: row.bank_name_ar,
        created_by_name: row.created_by_name,
        lines_count: row.lines_count,
        matched_lines_count: row.matched_lines_count,
        unresolved_lines_count: row.unresolved_lines_count,
      })),
      stats: {
        total: st.total ?? 0,
        draft: st.draft ?? 0,
        in_progress: st.in_progress ?? 0,
        reconciled: st.reconciled ?? 0,
        closed: st.closed ?? 0,
        cancelled: st.cancelled ?? 0,
      },
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
    const statement = await withTransaction(async (client) =>
      createBankStatement(client, {
        ...body,
        created_by: auth.user.id,
      })
    );

    return jsonSuccess({ data: serializeBankStatement(statement) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
