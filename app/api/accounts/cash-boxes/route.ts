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
import { getAccountsBookBalances } from '@/src/lib/accounts/account-book-balance';
import {
  createCashBox,
  serializeCashBox,
} from '@/src/lib/accounts/cash-boxes';
import {
  acquireCashBoxesLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const sp = request.nextUrl.searchParams;
    const q = sp.get('q')?.trim() || '';
    const status = sp.get('status');
    const boxType = sp.get('box_type_code');
    const accountId = sp.get('account_id');
    const custodianUserId = sp.get('primary_custodian_user_id');
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('page_size') || 20)));
    const offset = (page - 1) * pageSize;

    const where = `
      WHERE ($1 = '' OR cb.code ILIKE '%'||$1||'%' OR cb.name_ar ILIKE '%'||$1||'%'
             OR COALESCE(cb.name_en,'') ILIKE '%'||$1||'%')
        AND ($2::text IS NULL OR cb.status = $2)
        AND ($3::text IS NULL OR cb.box_type_code = $3)
        AND ($4::uuid IS NULL OR cb.account_id = $4::uuid)
        AND (
          $5::uuid IS NULL
          OR EXISTS (
            SELECT 1 FROM accounts.cash_box_custodians pcx
            WHERE pcx.cash_box_id = cb.id
              AND pcx.is_primary = TRUE
              AND pcx.valid_to IS NULL
              AND pcx.user_id = $5::uuid
          )
        )
    `;
    const params = [
      q,
      status || null,
      boxType || null,
      accountId || null,
      custodianUserId || null,
    ];

    const countRes = await query(
      `SELECT COUNT(*)::int AS total FROM accounts.cash_boxes cb ${where}`,
      params
    );

    const statsRes = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
         COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
         COUNT(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
         COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed
       FROM accounts.cash_boxes`
    );

    const listRes = await query(
      `SELECT cb.*,
              a.code AS account_code,
              a.name_ar AS account_name_ar,
              t.name_ar AS box_type_name_ar,
              pc.user_id AS primary_custodian_user_id,
              u.username AS primary_custodian_username
       FROM accounts.cash_boxes cb
       LEFT JOIN accounts.chart_of_accounts a ON a.id = cb.account_id
       LEFT JOIN accounts.cash_box_types t ON t.code = cb.box_type_code
       LEFT JOIN accounts.cash_box_custodians pc
         ON pc.cash_box_id = cb.id AND pc.is_primary = TRUE AND pc.valid_to IS NULL
       LEFT JOIN student_affairs.users u ON u.id = pc.user_id
       ${where}
       ORDER BY cb.code ASC
       LIMIT $6 OFFSET $7`,
      [...params, pageSize, offset]
    );

    const accountIds = listRes.rows
      .map((r) => r.account_id as string | null)
      .filter((id): id is string => Boolean(id));
    const balances = await getAccountsBookBalances(accountIds);

    const data = listRes.rows.map((r) => {
      const serialized = serializeCashBox(r as Parameters<typeof serializeCashBox>[0]);
      return {
        ...serialized,
        account_code: r.account_code ?? null,
        account_name_ar: r.account_name_ar ?? null,
        box_type_name_ar: r.box_type_name_ar ?? null,
        primary_custodian_user_id: r.primary_custodian_user_id ?? null,
        primary_custodian_username: r.primary_custodian_username ?? null,
        book_balance:
          r.account_id != null
            ? balances.get(r.account_id as string) ?? '0.000'
            : '0.000',
      };
    });

    return jsonSuccess({
      data,
      pagination: {
        page,
        page_size: pageSize,
        total: countRes.rows[0].total,
        total_pages: Math.ceil(countRes.rows[0].total / pageSize) || 1,
      },
      stats: statsRes.rows[0],
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
    const created = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const row = await createCashBox(client, {
        ...body,
        created_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_box.created',
        entityType: 'cash_box',
        entityId: row.id,
        newValues: serializeCashBox(row),
        description: `إنشاء صندوق ${row.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    let bookBalance = '0.000';
    if (created.account_id) {
      const { getAccountBookBalance } = await import(
        '@/src/lib/accounts/account-book-balance'
      );
      bookBalance = (await getAccountBookBalance(created.account_id)).balance;
    }

    return jsonSuccess(
      {
        data: {
          ...serializeCashBox(created),
          book_balance: bookBalance,
        },
      },
      201
    );
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
