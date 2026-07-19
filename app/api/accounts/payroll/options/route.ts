import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { PAYROLL_CAPABILITIES, assertPayrollCapability, getPayrollCapabilities } from '@/src/lib/accounts/payroll-access';
import { PAYROLL_ENUMS } from '@/src/lib/accounts/payroll-validation';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW);
    const [glAccounts, costCenters, departments, calendars, components, fiscalYears, fiscalPeriods, activePeople, caps] = await Promise.all([
      query(
        `SELECT a.id, a.code, a.name_ar, t.code AS account_type_code
         FROM accounts.chart_of_accounts a
         JOIN accounts.account_types t ON t.id = a.account_type_id
         WHERE a.is_active = TRUE AND a.allow_posting = TRUE AND a.is_group = FALSE
         ORDER BY a.code`
      ),
      query(`SELECT id, code, name_ar FROM accounts.cost_centers WHERE is_active = TRUE ORDER BY code`),
      query(`SELECT id, name_ar FROM student_affairs.departments ORDER BY name_ar`),
      query(
        `SELECT id, code, name_ar, calendar_type, currency_code
         FROM accounts.payroll_calendars WHERE is_active = TRUE ORDER BY code`
      ),
      query(
        `SELECT id, component_code, name_ar, component_type, calculation_method, calculation_base_type
         FROM accounts.payroll_components WHERE is_active = TRUE ORDER BY component_code`
      ),
      query(
        `SELECT id, code, name_ar, start_date, end_date, status
         FROM accounts.fiscal_years WHERE status <> 'CLOSED' ORDER BY start_date DESC`
      ),
      query(
        `SELECT id, fiscal_year_id, code, name_ar, period_number
         FROM accounts.fiscal_periods ORDER BY fiscal_year_id, period_number`
      ),
      query(
        `SELECT id, person_code, full_name_ar, person_type, department_id, default_cost_center_id
         FROM accounts.payroll_people WHERE status = 'ACTIVE' ORDER BY person_code`
      ),
      getPayrollCapabilities(null, auth.user.id),
    ]);
    const gl = glAccounts.rows as Array<{ id: string; code: string; name_ar: string; account_type_code: string }>;
    return jsonSuccess({
      data: {
        gl_accounts: gl,
        expense_accounts: gl.filter((a) => a.account_type_code === 'EXPENSE'),
        liability_accounts: gl.filter((a) => a.account_type_code === 'LIABILITY'),
        cost_centers: costCenters.rows,
        departments: departments.rows,
        calendars: calendars.rows,
        components: components.rows,
        fiscal_years: fiscalYears.rows,
        fiscal_periods: fiscalPeriods.rows,
        active_people: activePeople.rows,
        enums: {
          person_type: PAYROLL_ENUMS.PERSON_TYPE,
          person_status: PAYROLL_ENUMS.PERSON_STATUS,
          compensation_basis: PAYROLL_ENUMS.COMPENSATION_BASIS,
          contract_status: PAYROLL_ENUMS.CONTRACT_STATUS,
          assignment_type: PAYROLL_ENUMS.ASSIGNMENT_TYPE,
          assignment_status: PAYROLL_ENUMS.ASSIGNMENT_STATUS,
          component_type: PAYROLL_ENUMS.COMPONENT_TYPE,
          calculation_method: PAYROLL_ENUMS.CALCULATION_METHOD,
          calculation_base_type: PAYROLL_ENUMS.CALCULATION_BASE_TYPE_IMPLEMENTED,
          mapping_scope: PAYROLL_ENUMS.MAPPING_SCOPE,
          calendar_type: PAYROLL_ENUMS.CALENDAR_TYPE,
          payment_method: PAYROLL_ENUMS.PAYMENT_METHOD,
          period_status: PAYROLL_ENUMS.PERIOD_STATUS,
          run_type: PAYROLL_ENUMS.RUN_TYPE,
          run_status: PAYROLL_ENUMS.RUN_STATUS,
          scope_type: PAYROLL_ENUMS.SCOPE_TYPE,
        },
        capabilities: [...caps],
      },
    });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
