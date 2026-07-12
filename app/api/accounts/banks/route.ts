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
  createBank,
  serializeBank,
} from '@/src/lib/accounts/banks';
import {
  acquireBanksLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const sp = request.nextUrl.searchParams;
    const q = sp.get('q')?.trim() || '';
    const isActiveRaw = sp.get('is_active');
    const isActive =
      isActiveRaw === 'true' ? true : isActiveRaw === 'false' ? false : null;
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('page_size') || 20)));
    const offset = (page - 1) * pageSize;

    const where = `
      WHERE ($1 = '' OR b.code ILIKE '%'||$1||'%' OR b.name_ar ILIKE '%'||$1||'%'
             OR COALESCE(b.name_en,'') ILIKE '%'||$1||'%'
             OR COALESCE(b.short_name,'') ILIKE '%'||$1||'%')
        AND ($2::boolean IS NULL OR b.is_active = $2::boolean)
    `;
    const params = [q, isActive];

    const [countRes, statsRes, listRes] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS total FROM accounts.banks b ${where}`,
        params
      ),
      query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE is_active)::int AS active,
           COUNT(*) FILTER (WHERE NOT is_active)::int AS inactive
         FROM accounts.banks`
      ),
      query(
        `SELECT b.*,
                (SELECT COUNT(*)::int FROM accounts.bank_branches br WHERE br.bank_id = b.id) AS branches_count,
                (SELECT COUNT(*)::int FROM accounts.bank_accounts ba WHERE ba.bank_id = b.id) AS accounts_count
         FROM accounts.banks b
         ${where}
         ORDER BY b.code ASC
         LIMIT $3 OFFSET $4`,
        [...params, pageSize, offset]
      ),
    ]);

    return jsonSuccess({
      data: listRes.rows.map((r) => ({
        ...serializeBank(r as Parameters<typeof serializeBank>[0]),
        branches_count: r.branches_count ?? 0,
        accounts_count: r.accounts_count ?? 0,
      })),
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
      await acquireBanksLock(client);
      const row = await createBank(client, {
        ...body,
        created_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank.created',
        entityType: 'bank',
        entityId: row.id,
        newValues: serializeBank(row),
        description: `إنشاء مصرف ${row.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeBank(created) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
