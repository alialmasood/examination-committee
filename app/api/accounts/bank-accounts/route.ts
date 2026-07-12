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
  createBankAccount,
  serializeBankAccount,
} from '@/src/lib/accounts/bank-accounts';
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
    const branchId = sp.get('branch_id') || sp.get('bank_branch_id') || null;
    const status = sp.get('status') || null;
    const currency = sp.get('currency') || sp.get('currency_code') || null;
    const accountType = sp.get('account_type') || null;
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('page_size') || 20)));
    const offset = (page - 1) * pageSize;

    const where = `
      WHERE ($1 = '' OR ba.code ILIKE '%'||$1||'%' OR ba.account_name_ar ILIKE '%'||$1||'%'
             OR COALESCE(ba.account_name_en,'') ILIKE '%'||$1||'%'
             OR ba.account_number ILIKE '%'||$1||'%'
             OR COALESCE(ba.iban,'') ILIKE '%'||$1||'%')
        AND ($2::uuid IS NULL OR ba.bank_id = $2::uuid)
        AND ($3::uuid IS NULL OR ba.bank_branch_id = $3::uuid)
        AND ($4::text IS NULL OR ba.status = $4)
        AND ($5::text IS NULL OR ba.currency_code = $5)
        AND ($6::text IS NULL OR ba.account_type = $6)
    `;
    const params = [q, bankId, branchId, status, currency, accountType];

    const [countRes, statsRes, listRes] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS total FROM accounts.bank_accounts ba ${where}`,
        params
      ),
      query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
           COUNT(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
           COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed,
           COUNT(*) FILTER (WHERE is_primary AND status <> 'CLOSED')::int AS primary,
           COUNT(*) FILTER (WHERE currency_code = 'IQD' AND status <> 'CLOSED')::int AS iqd,
           COUNT(*) FILTER (WHERE currency_code <> 'IQD' AND status <> 'CLOSED')::int AS other
         FROM accounts.bank_accounts`
      ),
      query(
        `SELECT ba.*,
                b.code AS bank_code,
                b.name_ar AS bank_name_ar,
                br.code AS branch_code,
                br.name_ar AS branch_name_ar,
                a.code AS gl_account_code,
                a.name_ar AS gl_account_name_ar
         FROM accounts.bank_accounts ba
         JOIN accounts.banks b ON b.id = ba.bank_id
         LEFT JOIN accounts.bank_branches br ON br.id = ba.bank_branch_id
         LEFT JOIN accounts.chart_of_accounts a ON a.id = ba.gl_account_id
         ${where}
         ORDER BY ba.code ASC
         LIMIT $7 OFFSET $8`,
        [...params, pageSize, offset]
      ),
    ]);

    return jsonSuccess({
      data: listRes.rows.map((r) => ({
        ...serializeBankAccount(r as Parameters<typeof serializeBankAccount>[0]),
        bank_code: r.bank_code ?? null,
        bank_name_ar: r.bank_name_ar ?? null,
        branch_code: r.branch_code ?? null,
        branch_name_ar: r.branch_name_ar ?? null,
        gl_account_code: r.gl_account_code ?? null,
        gl_account_name_ar: r.gl_account_name_ar ?? null,
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
      const row = await createBankAccount(client, {
        ...body,
        created_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_account.created',
        entityType: 'bank_account',
        entityId: row.id,
        newValues: serializeBankAccount(row),
        description: `إنشاء حساب مصرفي ${row.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeBankAccount(created) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
