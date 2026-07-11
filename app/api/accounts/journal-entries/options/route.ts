import { NextRequest } from 'next/server';
import {
  isAuthFailure,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { UI_JOURNAL_ENTRY_TYPES, TYPE_LABEL_AR } from '@/src/lib/accounts/journal-transitions';
import { toDateOnly } from '@/src/lib/accounts/fiscal';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const years = await query(
      `SELECT id, code, name_ar, status, is_default, start_date, end_date
       FROM accounts.fiscal_years
       ORDER BY start_date DESC`
    );

    const defaultYear =
      years.rows.find((y) => y.is_default && y.status === 'ACTIVE') ||
      years.rows.find((y) => y.status === 'ACTIVE') ||
      null;

    let openPeriods: unknown[] = [];
    if (defaultYear) {
      const periods = await query(
        `SELECT id, code, name_ar, period_number, status, start_date, end_date, fiscal_year_id
         FROM accounts.fiscal_periods
         WHERE fiscal_year_id = $1 AND status = 'OPEN'
         ORDER BY period_number ASC`,
        [defaultYear.id]
      );
      openPeriods = periods.rows.map((p) => ({
        ...p,
        start_date: toDateOnly(p.start_date),
        end_date: toDateOnly(p.end_date),
      }));
    }

    const accounts = await query(
      `SELECT id, code, name_ar, name_en, requires_cost_center, normal_balance, account_type_id
       FROM accounts.chart_of_accounts
       WHERE is_active = TRUE AND allow_posting = TRUE AND is_group = FALSE
       ORDER BY sort_order ASC, code ASC
       LIMIT 2000`
    );

    const costCenters = await query(
      `SELECT id, code, name_ar, is_group, level
       FROM accounts.cost_centers
       WHERE is_active = TRUE
       ORDER BY code ASC
       LIMIT 1000`
    );

    return jsonSuccess({
      data: {
        default_fiscal_year: defaultYear
          ? {
              ...defaultYear,
              start_date: toDateOnly(defaultYear.start_date),
              end_date: toDateOnly(defaultYear.end_date),
            }
          : null,
        fiscal_years: years.rows.map((y) => ({
          ...y,
          start_date: toDateOnly(y.start_date),
          end_date: toDateOnly(y.end_date),
        })),
        open_periods: openPeriods,
        posting_accounts: accounts.rows,
        cost_centers: costCenters.rows,
        entry_types: UI_JOURNAL_ENTRY_TYPES.map((t) => ({
          code: t,
          name_ar: TYPE_LABEL_AR[t],
        })),
      },
    });
  } catch (error) {
    return mapPgError(error);
  }
}
