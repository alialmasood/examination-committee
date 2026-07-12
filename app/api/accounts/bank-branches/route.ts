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
  createBankBranch,
  serializeBankBranch,
} from '@/src/lib/accounts/bank-branches';
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
    const bankId = sp.get('bank_id') || null;
    const isActiveRaw = sp.get('is_active');
    const isActive =
      isActiveRaw === 'true' ? true : isActiveRaw === 'false' ? false : null;
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('page_size') || 20)));
    const offset = (page - 1) * pageSize;

    const where = `
      WHERE ($1 = '' OR br.code ILIKE '%'||$1||'%' OR br.name_ar ILIKE '%'||$1||'%'
             OR COALESCE(br.name_en,'') ILIKE '%'||$1||'%'
             OR COALESCE(br.city,'') ILIKE '%'||$1||'%')
        AND ($2::uuid IS NULL OR br.bank_id = $2::uuid)
        AND ($3::boolean IS NULL OR br.is_active = $3::boolean)
    `;
    const params = [q, bankId, isActive];

    const [countRes, listRes] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS total FROM accounts.bank_branches br ${where}`,
        params
      ),
      query(
        `SELECT br.*,
                b.code AS bank_code,
                b.name_ar AS bank_name_ar
         FROM accounts.bank_branches br
         JOIN accounts.banks b ON b.id = br.bank_id
         ${where}
         ORDER BY b.code ASC, br.code ASC
         LIMIT $4 OFFSET $5`,
        [...params, pageSize, offset]
      ),
    ]);

    return jsonSuccess({
      data: listRes.rows.map((r) => ({
        ...serializeBankBranch(r as Parameters<typeof serializeBankBranch>[0]),
        bank_code: r.bank_code ?? null,
        bank_name_ar: r.bank_name_ar ?? null,
      })),
      pagination: {
        page,
        page_size: pageSize,
        total: countRes.rows[0].total,
        total_pages: Math.ceil(countRes.rows[0].total / pageSize) || 1,
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
    const created = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const row = await createBankBranch(client, {
        ...body,
        created_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_branch.created',
        entityType: 'bank_branch',
        entityId: row.id,
        newValues: serializeBankBranch(row),
        description: `إنشاء فرع مصرف ${row.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeBankBranch(created) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
