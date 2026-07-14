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
  createCashTransfer,
  serializeCashTransfer,
} from '@/src/lib/accounts/cash-transfers';
import {
  acquireCashBoxesLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { sqlUserCanViewCashTransferPair } from '@/src/lib/accounts/cash-box-access';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const sp = request.nextUrl.searchParams;
    const q = sp.get('q')?.trim() || '';
    const status = sp.get('status');
    const sourceBoxId = sp.get('source_cash_box_id');
    const destBoxId = sp.get('destination_cash_box_id');
    const cashBoxId = sp.get('cash_box_id');
    const sourceSessionId = sp.get('source_session_id');
    const destSessionId = sp.get('destination_session_id');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('page_size') || 20)));
    const offset = (page - 1) * pageSize;

    const where = `
      WHERE ($1 = '' OR t.transfer_number ILIKE '%'||$1||'%'
             OR t.description ILIKE '%'||$1||'%'
             OR COALESCE(t.external_reference,'') ILIKE '%'||$1||'%')
        AND ($2::text IS NULL OR t.status = $2)
        AND ($3::uuid IS NULL OR t.source_cash_box_id = $3::uuid)
        AND ($4::uuid IS NULL OR t.destination_cash_box_id = $4::uuid)
        AND ($5::uuid IS NULL OR t.source_cash_box_id = $5::uuid OR t.destination_cash_box_id = $5::uuid)
        AND ($6::uuid IS NULL OR t.source_session_id = $6::uuid)
        AND ($7::uuid IS NULL OR t.destination_session_id = $7::uuid)
        AND ($8::date IS NULL OR t.transfer_date >= $8::date)
        AND ($9::date IS NULL OR t.transfer_date <= $9::date)
        AND ${sqlUserCanViewCashTransferPair(
          '$10',
          't.source_cash_box_id',
          't.destination_cash_box_id'
        )}
    `;
    const params = [
      q,
      status || null,
      sourceBoxId || null,
      destBoxId || null,
      cashBoxId || null,
      sourceSessionId || null,
      destSessionId || null,
      dateFrom || null,
      dateTo || null,
      auth.user.id,
    ];

    const countRes = await query(
      `SELECT COUNT(*)::int AS total FROM accounts.cash_transfers t ${where}`,
      params
    );

    const statsRes = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
         COUNT(*) FILTER (WHERE status = 'DISPATCHED')::int AS dispatched,
         COUNT(*) FILTER (WHERE status = 'RECEIVED')::int AS received,
         COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
         COALESCE(SUM(amount) FILTER (WHERE status IN ('DISPATCHED','RECEIVED')), 0)::text AS outbound_total,
         COALESCE(SUM(amount) FILTER (WHERE status = 'RECEIVED'), 0)::text AS inbound_total
       FROM accounts.cash_transfers t ${where}`,
      params
    );

    const listRes = await query(
      `SELECT t.*,
              sb.code AS source_cash_box_code,
              sb.name_ar AS source_cash_box_name_ar,
              db.code AS destination_cash_box_code,
              db.name_ar AS destination_cash_box_name_ar,
              dje.entry_number AS dispatch_journal_entry_number,
              rje.entry_number AS receipt_journal_entry_number,
              COALESCE(u.full_name, u.username) AS created_by_name
       FROM accounts.cash_transfers t
       JOIN accounts.cash_boxes sb ON sb.id = t.source_cash_box_id
       JOIN accounts.cash_boxes db ON db.id = t.destination_cash_box_id
       LEFT JOIN accounts.journal_entries dje ON dje.id = t.dispatch_journal_entry_id
       LEFT JOIN accounts.journal_entries rje ON rje.id = t.receipt_journal_entry_id
       LEFT JOIN student_affairs.users u ON u.id = t.created_by
       ${where}
       ORDER BY t.transfer_date DESC, t.created_at DESC
       LIMIT $11 OFFSET $12`,
      [...params, pageSize, offset]
    );

    const total = countRes.rows[0]?.total ?? 0;
    const st = statsRes.rows[0] || {};

    return jsonSuccess({
      data: listRes.rows.map((row) => ({
        ...serializeCashTransfer(row as never),
        source_cash_box_code: row.source_cash_box_code,
        source_cash_box_name_ar: row.source_cash_box_name_ar,
        destination_cash_box_code: row.destination_cash_box_code,
        destination_cash_box_name_ar: row.destination_cash_box_name_ar,
        dispatch_journal_entry_number: row.dispatch_journal_entry_number,
        receipt_journal_entry_number: row.receipt_journal_entry_number,
        created_by_name: row.created_by_name,
      })),
      stats: {
        total: st.total ?? 0,
        draft: st.draft ?? 0,
        dispatched: st.dispatched ?? 0,
        received: st.received ?? 0,
        cancelled: st.cancelled ?? 0,
        outbound_total: String(st.outbound_total ?? '0'),
        inbound_total: String(st.inbound_total ?? '0'),
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
    const body = await request.json().catch(() => ({}));
    const created = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const row = await createCashTransfer(client, {
        ...body,
        created_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_transfer.created',
        entityType: 'cash_transfer',
        entityId: row.id,
        newValues: serializeCashTransfer(row),
        description: `إنشاء تحويل ${row.transfer_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });
    return jsonSuccess({ data: serializeCashTransfer(created) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
