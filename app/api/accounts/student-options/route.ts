import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { listEligibleReceivableGlAccounts } from '@/src/lib/accounts/student-accounts';
import { listEligibleRevenueGlAccounts } from '@/src/lib/accounts/student-fee-types';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertStudentReceivablesCapability(
      null,
      auth.user.id,
      STUDENT_RECEIVABLES_CAPABILITIES.VIEW
    );

    const sp = request.nextUrl.searchParams;
    const q = sp.get('q')?.trim() || '';
    const studentLimit = Math.min(50, Math.max(1, Number(sp.get('student_limit') || 20)));

    const [
      students,
      feeTypes,
      fiscalYears,
      fiscalPeriods,
      costCenters,
      receivableGl,
      revenueGl,
    ] = await Promise.all([
      query(
        `SELECT id,
                university_id,
                COALESCE(NULLIF(TRIM(student_number), ''), university_id) AS student_number,
                COALESCE(NULLIF(TRIM(full_name_ar), ''), full_name) AS full_name_ar,
                major,
                admission_type,
                study_type,
                status,
                academic_year,
                department_id
         FROM student_affairs.students
         WHERE LOWER(TRIM(status)) = 'active'
           AND COALESCE(NULLIF(TRIM(payment_status), ''), 'pending') = 'paid'
           AND ($1 = ''
                OR university_id ILIKE '%'||$1||'%'
                OR COALESCE(student_number,'') ILIKE '%'||$1||'%'
                OR COALESCE(full_name_ar,'') ILIKE '%'||$1||'%'
                OR COALESCE(full_name,'') ILIKE '%'||$1||'%')
         ORDER BY full_name_ar ASC NULLS LAST
         LIMIT $2`,
        [q, studentLimit]
      ),
      query(
        `SELECT id, code, name_ar, category, default_amount, currency_code,
                revenue_gl_account_id, requires_cost_center, default_cost_center_id,
                is_tuition, is_refundable
         FROM accounts.student_fee_types
         WHERE is_active = TRUE
         ORDER BY code ASC
         LIMIT 200`
      ),
      query(
        `SELECT id, code, name_ar, status, is_default, start_date, end_date
         FROM accounts.fiscal_years
         ORDER BY is_default DESC, start_date DESC
         LIMIT 20`
      ),
      query(
        `SELECT id, fiscal_year_id, code, name_ar, status, start_date, end_date, period_number
         FROM accounts.fiscal_periods
         WHERE status IN ('OPEN', 'CLOSED')
         ORDER BY start_date DESC
         LIMIT 100`
      ),
      query(
        `SELECT id, code, name_ar
         FROM accounts.cost_centers
         WHERE is_active = TRUE
         ORDER BY code ASC
         LIMIT 300`
      ),
      withTransaction((client) => listEligibleReceivableGlAccounts(client)),
      withTransaction((client) => listEligibleRevenueGlAccounts(client)),
    ]);

    return jsonSuccess({
      data: {
        students: students.rows,
        fee_types: feeTypes.rows,
        fiscal_years: fiscalYears.rows,
        fiscal_periods: fiscalPeriods.rows,
        cost_centers: costCenters.rows,
        receivable_gl_accounts: receivableGl,
        revenue_gl_accounts: revenueGl,
        fee_categories: [
          { code: 'TUITION', name_ar: 'دراسي' },
          { code: 'REGISTRATION', name_ar: 'تسجيل' },
          { code: 'LAB', name_ar: 'مختبر' },
          { code: 'EXAM', name_ar: 'امتحان' },
          { code: 'SERVICE', name_ar: 'خدمة' },
          { code: 'TRANSPORT', name_ar: 'نقل' },
          { code: 'ACCOMMODATION', name_ar: 'سكن' },
          { code: 'OTHER', name_ar: 'أخرى' },
        ],
        account_statuses: [
          { code: 'ACTIVE', name_ar: 'نشط' },
          { code: 'SUSPENDED', name_ar: 'معلّق' },
          { code: 'CLOSED', name_ar: 'مغلق' },
        ],
        charge_statuses: [
          { code: 'DRAFT', name_ar: 'مسودة' },
          { code: 'POSTED', name_ar: 'مرحّل' },
          { code: 'PARTIALLY_SETTLED', name_ar: 'مسدد جزئياً' },
          { code: 'SETTLED', name_ar: 'مسدد' },
          { code: 'VOID', name_ar: 'ملغى' },
        ],
        currencies: ['IQD'],
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
