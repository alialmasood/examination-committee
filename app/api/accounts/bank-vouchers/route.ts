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
  createBankVoucher,
  serializeBankVoucher,
} from '@/src/lib/accounts/bank-vouchers';
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
    const voucherType = sp.get('voucher_type');
    const status = sp.get('status');
    const bankAccountId = sp.get('bank_account_id');
    const bankId = sp.get('bank_id');
    const currency = sp.get('currency');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const party = sp.get('party')?.trim() || '';
    const bankReference = sp.get('bank_reference')?.trim() || '';
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('page_size') || 20)));
    const offset = (page - 1) * pageSize;

    const where = `
      WHERE ($1 = '' OR v.voucher_number ILIKE '%'||$1||'%'
             OR COALESCE(v.party_name,'') ILIKE '%'||$1||'%'
             OR v.description ILIKE '%'||$1||'%'
             OR COALESCE(v.bank_reference,'') ILIKE '%'||$1||'%')
        AND ($2::text IS NULL OR v.voucher_type = $2)
        AND ($3::text IS NULL OR v.status = $3)
        AND ($4::uuid IS NULL OR v.bank_account_id = $4::uuid)
        AND ($5::uuid IS NULL OR ba.bank_id = $5::uuid)
        AND ($6::text IS NULL OR v.currency_code = $6)
        AND ($7::date IS NULL OR v.voucher_date >= $7::date)
        AND ($8::date IS NULL OR v.voucher_date <= $8::date)
        AND ($9 = '' OR COALESCE(v.party_name,'') ILIKE '%'||$9||'%')
        AND ($10 = '' OR COALESCE(v.bank_reference,'') ILIKE '%'||$10||'%')
    `;
    const params = [
      q,
      voucherType || null,
      status || null,
      bankAccountId || null,
      bankId || null,
      currency || null,
      dateFrom || null,
      dateTo || null,
      party,
      bankReference,
    ];

    const fromJoin = `
      FROM accounts.bank_vouchers v
      JOIN accounts.bank_accounts ba ON ba.id = v.bank_account_id
    `;

    const countRes = await query(
      `SELECT COUNT(*)::int AS total ${fromJoin} ${where}`,
      params
    );

    const statsRes = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE v.status = 'DRAFT')::int AS draft,
         COUNT(*) FILTER (WHERE v.status = 'POSTED')::int AS posted,
         COUNT(*) FILTER (WHERE v.status = 'VOID')::int AS voided,
         COALESCE(SUM(v.amount) FILTER (WHERE v.voucher_type = 'BANK_RECEIPT' AND v.status = 'POSTED'), 0)::text AS receipts_total,
         COALESCE(SUM(v.amount) FILTER (WHERE v.voucher_type = 'BANK_PAYMENT' AND v.status = 'POSTED'), 0)::text AS payments_total
       ${fromJoin} ${where}`,
      params
    );

    const listRes = await query(
      `SELECT v.*,
              ba.code AS bank_account_code,
              ba.account_name_ar AS bank_account_name_ar,
              ba.currency_code AS bank_account_currency,
              b.code AS bank_code,
              b.name_ar AS bank_name_ar,
              br.code AS branch_code,
              br.name_ar AS branch_name_ar,
              ca.code AS counter_account_code,
              ca.name_ar AS counter_account_name_ar,
              je.entry_number AS journal_entry_number,
              COALESCE(u.full_name, u.username) AS created_by_name
       ${fromJoin}
       JOIN accounts.banks b ON b.id = ba.bank_id
       LEFT JOIN accounts.bank_branches br ON br.id = ba.bank_branch_id
       JOIN accounts.chart_of_accounts ca ON ca.id = v.counter_account_id
       LEFT JOIN accounts.journal_entries je ON je.id = v.journal_entry_id
       LEFT JOIN student_affairs.users u ON u.id = v.created_by
       ${where}
       ORDER BY v.voucher_date DESC, v.created_at DESC
       LIMIT $11 OFFSET $12`,
      [...params, pageSize, offset]
    );

    const total = countRes.rows[0]?.total ?? 0;
    const st = statsRes.rows[0] || {};
    const receipts = Number(st.receipts_total || 0);
    const payments = Number(st.payments_total || 0);

    return jsonSuccess({
      data: listRes.rows.map((row) => ({
        ...serializeBankVoucher(row as never),
        bank_account_code: row.bank_account_code,
        bank_account_name_ar: row.bank_account_name_ar,
        bank_account_currency: row.bank_account_currency,
        bank_code: row.bank_code,
        bank_name_ar: row.bank_name_ar,
        branch_code: row.branch_code,
        branch_name_ar: row.branch_name_ar,
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
      await acquireBanksLock(client);
      const created = await createBankVoucher(client, {
        ...body,
        created_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_voucher.created',
        entityType: 'bank_voucher',
        entityId: created.id,
        newValues: serializeBankVoucher(created),
        description: `إنشاء ${created.voucher_type === 'BANK_RECEIPT' ? 'سند قبض مصرفي' : 'سند صرف مصرفي'} ${created.voucher_number}`,
      });
      return created;
    });

    return jsonSuccess({ data: serializeBankVoucher(voucher) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
