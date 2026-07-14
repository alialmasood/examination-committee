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
  createCashVoucher,
  serializeCashVoucher,
} from '@/src/lib/accounts/cash-vouchers';
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
    const q = sp.get('q')?.trim() || '';
    const voucherType = sp.get('voucher_type');
    const status = sp.get('status');
    const cashBoxId = sp.get('cash_box_id');
    const sessionId = sp.get('cash_box_session_id');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('page_size') || 20)));
    const offset = (page - 1) * pageSize;

    const where = `
      WHERE ($1 = '' OR v.voucher_number ILIKE '%'||$1||'%'
             OR COALESCE(v.party_name,'') ILIKE '%'||$1||'%'
             OR v.description ILIKE '%'||$1||'%')
        AND ($2::text IS NULL OR v.voucher_type = $2)
        AND ($3::text IS NULL OR v.status = $3)
        AND ($4::uuid IS NULL OR v.cash_box_id = $4::uuid)
        AND ($5::uuid IS NULL OR v.cash_box_session_id = $5::uuid)
        AND ($6::date IS NULL OR v.voucher_date >= $6::date)
        AND ($7::date IS NULL OR v.voucher_date <= $7::date)
        AND ${sqlUserCanViewCashBox('$8', 'v.cash_box_id')}
    `;
    const params = [
      q,
      voucherType || null,
      status || null,
      cashBoxId || null,
      sessionId || null,
      dateFrom || null,
      dateTo || null,
      auth.user.id,
    ];

    const countRes = await query(
      `SELECT COUNT(*)::int AS total FROM accounts.cash_vouchers v ${where}`,
      params
    );

    const statsRes = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
         COUNT(*) FILTER (WHERE status = 'POSTED')::int AS posted,
         COUNT(*) FILTER (WHERE status = 'VOID')::int AS voided,
         COALESCE(SUM(amount) FILTER (WHERE voucher_type = 'CASH_RECEIPT' AND status = 'POSTED'), 0)::text AS receipts_total,
         COALESCE(SUM(amount) FILTER (WHERE voucher_type = 'CASH_PAYMENT' AND status = 'POSTED'), 0)::text AS payments_total
       FROM accounts.cash_vouchers v ${where}`,
      params
    );

    const listRes = await query(
      `SELECT v.*,
              cb.code AS cash_box_code,
              cb.name_ar AS cash_box_name_ar,
              ca.code AS counter_account_code,
              ca.name_ar AS counter_account_name_ar,
              je.entry_number AS journal_entry_number,
              COALESCE(u.full_name, u.username) AS created_by_name
       FROM accounts.cash_vouchers v
       JOIN accounts.cash_boxes cb ON cb.id = v.cash_box_id
       JOIN accounts.chart_of_accounts ca ON ca.id = v.counter_account_id
       LEFT JOIN accounts.journal_entries je ON je.id = v.journal_entry_id
       LEFT JOIN student_affairs.users u ON u.id = v.created_by
       ${where}
       ORDER BY v.voucher_date DESC, v.created_at DESC
       LIMIT $9 OFFSET $10`,
      [...params, pageSize, offset]
    );

    const total = countRes.rows[0]?.total ?? 0;
    const st = statsRes.rows[0] || {};
    const receipts = Number(st.receipts_total || 0);
    const payments = Number(st.payments_total || 0);

    return jsonSuccess({
      data: listRes.rows.map((row) => ({
        ...serializeCashVoucher(row as never),
        cash_box_code: row.cash_box_code,
        cash_box_name_ar: row.cash_box_name_ar,
        counter_account_code: row.counter_account_code,
        counter_account_name_ar: row.counter_account_name_ar,
        journal_entry_number: row.journal_entry_number,
        created_by_name: row.created_by_name,
      })),
      stats: {
        total: st.total ?? 0,
        draft: st.draft ?? 0,
        posted: st.posted ?? 0,
        voided: st.voided ?? 0,
        receipts_total: String(st.receipts_total ?? '0'),
        payments_total: String(st.payments_total ?? '0'),
        net_movement: (receipts - payments).toFixed(3),
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
    const voucher = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const created = await createCashVoucher(client, {
        ...body,
        created_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_voucher.created',
        entityType: 'cash_voucher',
        entityId: created.id,
        newValues: serializeCashVoucher(created),
        description: `إنشاء ${created.voucher_type === 'CASH_RECEIPT' ? 'سند قبض' : 'سند صرف'} ${created.voucher_number}`,
      });
      return created;
    });

    return jsonSuccess({ data: serializeCashVoucher(voucher) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
