import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { FIXED_ASSETS_CAPABILITIES, assertFixedAssetsCapability, getFixedAssetsCapabilities } from '@/src/lib/accounts/fixed-assets-access';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertFixedAssetsCapability(null, auth.user.id, FIXED_ASSETS_CAPABILITIES.ASSET_VIEW);
    const [categories, locations, departments, users, periods, sessions, cashBoxes, bankAccounts, glAccounts, caps] = await Promise.all([
      query(
        `SELECT id, code, name_ar, depreciation_method, useful_life_months,
                salvage_value_percent, capitalization_threshold
         FROM accounts.asset_categories WHERE is_active = TRUE ORDER BY code`
      ),
      query(
        `SELECT id, code, name_ar, location_type, parent_location_id, department_id
         FROM accounts.asset_locations WHERE is_active = TRUE ORDER BY code`
      ),
      query(`SELECT id, name_ar FROM student_affairs.departments ORDER BY name_ar`),
      query(
        `SELECT id, COALESCE(full_name, username) AS name
         FROM student_affairs.users WHERE is_active = TRUE
         ORDER BY COALESCE(full_name, username)`
      ),
      query(
        `SELECT fp.id, fp.fiscal_year_id, fp.period_number, fp.code, fp.name_ar,
                fp.start_date::text AS start_date, fp.end_date::text AS end_date,
                fy.code AS fiscal_year_code
         FROM accounts.fiscal_periods fp
         JOIN accounts.fiscal_years fy ON fy.id = fp.fiscal_year_id
         WHERE fp.status = 'OPEN'
         ORDER BY fp.start_date DESC`
      ),
      query(
        `SELECT s.id, s.cash_box_id, s.session_date::text AS session_date,
                cb.code AS cash_box_code, cb.name_ar AS cash_box_name_ar
         FROM accounts.cash_box_sessions s
         JOIN accounts.cash_boxes cb ON cb.id = s.cash_box_id
         WHERE s.status = 'OPEN' AND cb.status = 'ACTIVE'
         ORDER BY s.session_date DESC`
      ),
      query(`SELECT id, code, name_ar FROM accounts.cash_boxes WHERE status = 'ACTIVE' ORDER BY code`),
      query(
        `SELECT id, code, account_name_ar, currency_code
         FROM accounts.bank_accounts WHERE status = 'ACTIVE' ORDER BY code`
      ),
      query(
        `SELECT a.id, a.code, a.name_ar, t.code AS account_type_code
         FROM accounts.chart_of_accounts a
         JOIN accounts.account_types t ON t.id = a.account_type_id
         WHERE a.is_active = TRUE AND a.allow_posting = TRUE AND a.is_group = FALSE
         ORDER BY a.code`
      ),
      getFixedAssetsCapabilities(null, auth.user.id),
    ]);
    const gl = glAccounts.rows as Array<{ id: string; code: string; name_ar: string; account_type_code: string }>;
    const custodians = (users.rows as Array<{ id: string; name: string }>).map((u) => ({
      id: u.id,
      name: u.name,
      full_name: u.name,
    }));
    return jsonSuccess({
      data: {
        categories: categories.rows,
        locations: locations.rows,
        departments: departments.rows,
        users: users.rows,
        custodians,
        gl_accounts: gl,
        asset_accounts: gl.filter((a) => a.account_type_code === 'ASSET'),
        expense_accounts: gl.filter((a) => a.account_type_code === 'EXPENSE'),
        revenue_accounts: gl.filter((a) => a.account_type_code === 'REVENUE'),
        equity_accounts: gl.filter((a) => a.account_type_code === 'EQUITY'),
        donation_revenue_accounts: gl.filter((a) => a.account_type_code === 'REVENUE'),
        open_fiscal_periods: periods.rows,
        fiscal_periods: periods.rows,
        open_cash_sessions: sessions.rows,
        cash_sessions: sessions.rows,
        cash_boxes: cashBoxes.rows,
        bank_accounts: bankAccounts.rows,
        location_types: ['BUILDING', 'FLOOR', 'ROOM', 'WAREHOUSE', 'OFFICE', 'LAB', 'OTHER'],
        acquisition_types: ['PURCHASE', 'MANUAL', 'DONATION', 'OPENING'],
        movement_types: ['LOCATION', 'CUSTODY', 'DEPARTMENT', 'MIXED'],
        disposal_types: ['SALE', 'SCRAP', 'DAMAGE', 'LOSS', 'DONATION_OUT'],
        depreciation_methods: ['STRAIGHT_LINE', 'NONE'],
        asset_statuses: ['DRAFT', 'ACTIVE', 'SUSPENDED', 'FULLY_DEPRECIATED', 'DISPOSED', 'CANCELLED'],
        capabilities: [...caps],
      },
    });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
