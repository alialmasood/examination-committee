import { NextRequest } from 'next/server';
import {
  isAuthFailure,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { toDateOnly } from '@/src/lib/accounts/fiscal';
import { normalizeMoneyInput } from '@/src/lib/accounts/money';
import { query } from '@/src/lib/db';

/** دفتر اليومية الأساسي — قيود POSTED فقط */
export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const sp = request.nextUrl.searchParams;
    const fiscalYearId = sp.get('fiscal_year_id');
    const fiscalPeriodId = sp.get('fiscal_period_id');
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const entryNumber = sp.get('entry_number')?.trim() || '';
    const entryType = sp.get('entry_type');
    const accountId = sp.get('account_id');
    const costCenterId = sp.get('cost_center_id');
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('page_size') || 50)));
    const offset = (page - 1) * pageSize;

    const where = `
      WHERE e.status = 'POSTED'
        AND ($1::uuid IS NULL OR e.fiscal_year_id = $1::uuid)
        AND ($2::uuid IS NULL OR e.fiscal_period_id = $2::uuid)
        AND ($3::date IS NULL OR e.entry_date >= $3::date)
        AND ($4::date IS NULL OR e.entry_date <= $4::date)
        AND ($5 = '' OR e.entry_number ILIKE '%'||$5||'%')
        AND ($6::text IS NULL OR e.entry_type = $6)
        AND ($7::uuid IS NULL OR l.account_id = $7::uuid)
        AND ($8::uuid IS NULL OR l.cost_center_id = $8::uuid)
    `;
    const params = [
      fiscalYearId || null,
      fiscalPeriodId || null,
      dateFrom ? toDateOnly(dateFrom) : null,
      dateTo ? toDateOnly(dateTo) : null,
      entryNumber,
      entryType || null,
      accountId || null,
      costCenterId || null,
    ];

    const totals = await query(
      `SELECT COUNT(*)::int AS row_count,
              COALESCE(SUM(l.debit_amount),0)::numeric AS total_debit,
              COALESCE(SUM(l.credit_amount),0)::numeric AS total_credit
       FROM accounts.journal_entry_lines l
       JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
       ${where}`,
      params
    );

    const rows = await query(
      `SELECT e.entry_date, e.entry_number, e.description AS entry_description, e.entry_type,
              a.code AS account_code, a.name_ar AS account_name_ar,
              cc.code AS cost_center_code, cc.name_ar AS cost_center_name_ar,
              l.description AS line_description,
              l.debit_amount, l.credit_amount,
              e.id AS journal_entry_id, l.id AS line_id
       FROM accounts.journal_entry_lines l
       JOIN accounts.journal_entries e ON e.id = l.journal_entry_id
       JOIN accounts.chart_of_accounts a ON a.id = l.account_id
       LEFT JOIN accounts.cost_centers cc ON cc.id = l.cost_center_id
       ${where}
       ORDER BY e.entry_date ASC, e.entry_number ASC, l.line_number ASC
       LIMIT $9 OFFSET $10`,
      [...params, pageSize, offset]
    );

    const pageDebit = rows.rows.reduce(
      (s, r) => s + Number(normalizeMoneyInput(r.debit_amount)),
      0
    );
    const pageCredit = rows.rows.reduce(
      (s, r) => s + Number(normalizeMoneyInput(r.credit_amount)),
      0
    );

    return jsonSuccess({
      data: rows.rows.map((r) => ({
        ...r,
        entry_date: toDateOnly(r.entry_date),
        debit_amount: normalizeMoneyInput(r.debit_amount),
        credit_amount: normalizeMoneyInput(r.credit_amount),
      })),
      pagination: {
        page,
        page_size: pageSize,
        total: totals.rows[0].row_count,
        total_pages: Math.ceil(totals.rows[0].row_count / pageSize) || 1,
      },
      totals: {
        total_debit: normalizeMoneyInput(totals.rows[0].total_debit),
        total_credit: normalizeMoneyInput(totals.rows[0].total_credit),
        page_debit: pageDebit.toFixed(3),
        page_credit: pageCredit.toFixed(3),
      },
    });
  } catch (error) {
    return mapPgError(error);
  }
}
