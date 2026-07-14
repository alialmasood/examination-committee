import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import {
  serializeStudentInstallment,
  type StudentInstallmentRow,
} from '@/src/lib/accounts/student-billing-plans';
import { loadStudentAccount } from '@/src/lib/accounts/student-accounts';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  hasStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { txQuery, withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

async function assertBillingReadAccess(
  client: Parameters<typeof hasStudentReceivablesCapability>[0],
  userId: string
): Promise<void> {
  const canView =
    (await hasStudentReceivablesCapability(
      client,
      userId,
      STUDENT_RECEIVABLES_CAPABILITIES.VIEW
    )) ||
    (await hasStudentReceivablesCapability(
      client,
      userId,
      STUDENT_RECEIVABLES_CAPABILITIES.BILLING_VIEW
    ));
  if (!canView) {
    throw new AccountsHttpError(
      `ليس لديك صلاحية العملية المطلوبة (${STUDENT_RECEIVABLES_CAPABILITIES.BILLING_VIEW})`,
      403
    );
  }
}

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertBillingReadAccess(null, auth.user.id);
    const { id } = await context.params;
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('page_size') || 50)));
    const offset = (page - 1) * pageSize;

    const result = await withTransaction(async (client) => {
      await loadStudentAccount(client, id);

      const status = sp.get('status') || null;
      const billingPlanId = sp.get('billing_plan_id') || null;

      const where = `
        WHERE si.student_account_id = $1::uuid
          AND ($2::text IS NULL OR si.status = $2)
          AND ($3::uuid IS NULL OR si.billing_plan_id = $3::uuid)
      `;
      const params = [id, status, billingPlanId];

      const count = await txQuery<{ total: number }>(
        client,
        `SELECT COUNT(*)::int AS total
         FROM accounts.student_installments si
         ${where}`,
        params
      );

      const list = await txQuery<
        StudentInstallmentRow & {
          plan_number: string | null;
          charge_number: string | null;
        }
      >(
        client,
        `SELECT si.*,
                p.plan_number,
                sc.charge_number
         FROM accounts.student_installments si
         JOIN accounts.student_billing_plans p ON p.id = si.billing_plan_id
         LEFT JOIN accounts.student_charges sc ON sc.id = si.student_charge_id
         ${where}
         ORDER BY si.due_date ASC, si.installment_number ASC
         LIMIT $4 OFFSET $5`,
        [...params, pageSize, offset]
      );

      return {
        rows: list.rows,
        total: count.rows[0]?.total ?? 0,
        page,
        page_size: pageSize,
      };
    });

    return jsonSuccess({
      data: result.rows.map((r) => ({
        ...serializeStudentInstallment(r),
        plan_number: r.plan_number ?? null,
        charge_number: r.charge_number ?? null,
      })),
      pagination: {
        page: result.page,
        page_size: result.page_size,
        total: result.total,
        total_pages: Math.ceil(result.total / result.page_size) || 1,
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const status = error.status === 403 ? 404 : error.status;
      return jsonError(
        status === 404 ? 'الحساب المالي للطالب غير موجود' : error.message,
        status
      );
    }
    return mapPgError(error);
  }
}
