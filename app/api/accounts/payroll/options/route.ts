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
    const [glAccounts, costCenters, departments, calendars, components, caps] = await Promise.all([
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
        `SELECT id, component_code, name_ar, component_type, calculation_method
         FROM accounts.payroll_components WHERE is_active = TRUE ORDER BY component_code`
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
        enums: {
          person_type: PAYROLL_ENUMS.PERSON_TYPE,
          person_status: PAYROLL_ENUMS.PERSON_STATUS,
          compensation_basis: PAYROLL_ENUMS.COMPENSATION_BASIS,
          contract_status: PAYROLL_ENUMS.CONTRACT_STATUS,
          assignment_type: PAYROLL_ENUMS.ASSIGNMENT_TYPE,
          assignment_status: PAYROLL_ENUMS.ASSIGNMENT_STATUS,
          component_type: PAYROLL_ENUMS.COMPONENT_TYPE,
          calculation_method: PAYROLL_ENUMS.CALCULATION_METHOD,
          mapping_scope: PAYROLL_ENUMS.MAPPING_SCOPE,
          calendar_type: PAYROLL_ENUMS.CALENDAR_TYPE,
          payment_method: PAYROLL_ENUMS.PAYMENT_METHOD,
        },
        capabilities: [...caps],
      },
    });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
