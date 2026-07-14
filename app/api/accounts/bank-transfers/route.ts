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
  createBankTransfer,
  serializeBankTransfer,
} from '@/src/lib/accounts/bank-transfers';
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
    const status = sp.get('status');
    const sourceId = sp.get('source_bank_account_id');
    const destId = sp.get('destination_bank_account_id');
    const bankAccountId = sp.get('bank_account_id');
    const bankId = sp.get('bank_id');
    const currency = sp.get('currency');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const bankReference = sp.get('bank_reference')?.trim() || '';
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('page_size') || 20)));
    const offset = (page - 1) * pageSize;

    const where = `
      WHERE ($1 = '' OR t.transfer_number ILIKE '%'||$1||'%'
             OR t.description ILIKE '%'||$1||'%'
             OR COALESCE(t.bank_reference,'') ILIKE '%'||$1||'%'
             OR COALESCE(t.external_reference,'') ILIKE '%'||$1||'%')
        AND ($2::text IS NULL OR t.status = $2)
        AND ($3::uuid IS NULL OR t.source_bank_account_id = $3::uuid)
        AND ($4::uuid IS NULL OR t.destination_bank_account_id = $4::uuid)
        AND ($5::uuid IS NULL OR t.source_bank_account_id = $5::uuid
             OR t.destination_bank_account_id = $5::uuid)
        AND ($6::uuid IS NULL OR src.bank_id = $6::uuid OR dst.bank_id = $6::uuid)
        AND ($7::text IS NULL OR t.currency_code = $7)
        AND ($8::date IS NULL OR t.transfer_date >= $8::date)
        AND ($9::date IS NULL OR t.transfer_date <= $9::date)
        AND ($10 = '' OR COALESCE(t.bank_reference,'') ILIKE '%'||$10||'%')
        AND (
          EXISTS (
            SELECT 1 FROM student_affairs.users u
            WHERE u.id = $11::uuid AND u.is_active = TRUE
              AND LOWER(TRIM(u.username)) IN (
                'accounts','admin','superadmin','super_admin'
              )
          )
          OR (
            EXISTS (
              SELECT 1 FROM accounts.bank_account_users bau_s
              WHERE bau_s.bank_account_id = t.source_bank_account_id
                AND bau_s.user_id = $11::uuid
                AND bau_s.can_view = TRUE
            )
            AND EXISTS (
              SELECT 1 FROM accounts.bank_account_users bau_d
              WHERE bau_d.bank_account_id = t.destination_bank_account_id
                AND bau_d.user_id = $11::uuid
                AND bau_d.can_view = TRUE
            )
          )
        )
    `;
    const params = [
      q,
      status || null,
      sourceId || null,
      destId || null,
      bankAccountId || null,
      bankId || null,
      currency || null,
      dateFrom || null,
      dateTo || null,
      bankReference,
      auth.user.id,
    ];

    const fromJoin = `
      FROM accounts.bank_transfers t
      JOIN accounts.bank_accounts src ON src.id = t.source_bank_account_id
      JOIN accounts.bank_accounts dst ON dst.id = t.destination_bank_account_id
    `;

    const countRes = await query(
      `SELECT COUNT(*)::int AS total ${fromJoin} ${where}`,
      params
    );

    const statsRes = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE t.status = 'DRAFT')::int AS draft,
         COUNT(*) FILTER (WHERE t.status = 'POSTED')::int AS posted,
         COUNT(*) FILTER (WHERE t.status = 'VOID')::int AS voided,
         COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'POSTED'), 0)::text AS transfers_total,
         COALESCE(SUM(t.fee_amount) FILTER (WHERE t.status = 'POSTED'), 0)::text AS fees_total
       ${fromJoin} ${where}`,
      params
    );

    const listRes = await query(
      `SELECT t.*,
              src.code AS source_code,
              src.account_name_ar AS source_name_ar,
              dst.code AS destination_code,
              dst.account_name_ar AS destination_name_ar,
              sb.code AS source_bank_code,
              sb.name_ar AS source_bank_name_ar,
              db.code AS destination_bank_code,
              db.name_ar AS destination_bank_name_ar,
              je.entry_number AS journal_entry_number,
              COALESCE(u.full_name, u.username) AS created_by_name
       ${fromJoin}
       JOIN accounts.banks sb ON sb.id = src.bank_id
       JOIN accounts.banks db ON db.id = dst.bank_id
       LEFT JOIN accounts.journal_entries je ON je.id = t.journal_entry_id
       LEFT JOIN student_affairs.users u ON u.id = t.created_by
       ${where}
       ORDER BY t.transfer_date DESC, t.created_at DESC
       LIMIT $12 OFFSET $13`,
      [...params, pageSize, offset]
    );

    const total = countRes.rows[0]?.total ?? 0;
    const st = statsRes.rows[0] || {};

    return jsonSuccess({
      data: listRes.rows.map((row) => ({
        ...serializeBankTransfer(row as never),
        source_code: row.source_code,
        source_name_ar: row.source_name_ar,
        destination_code: row.destination_code,
        destination_name_ar: row.destination_name_ar,
        source_bank_code: row.source_bank_code,
        source_bank_name_ar: row.source_bank_name_ar,
        destination_bank_code: row.destination_bank_code,
        destination_bank_name_ar: row.destination_bank_name_ar,
        journal_entry_number: row.journal_entry_number,
        created_by_name: row.created_by_name,
      })),
      stats: {
        total: st.total ?? 0,
        draft: st.draft ?? 0,
        posted: st.posted ?? 0,
        voided: st.voided ?? 0,
        transfers_total: String(st.transfers_total ?? '0'),
        fees_total: String(st.fees_total ?? '0'),
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
    const transfer = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const created = await createBankTransfer(client, {
        ...body,
        created_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_transfer.created',
        entityType: 'bank_transfer',
        entityId: created.id,
        newValues: serializeBankTransfer(created),
        description: `إنشاء تحويل مصرفي ${created.transfer_number}`,
      });
      return created;
    });

    return jsonSuccess({ data: serializeBankTransfer(transfer) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
