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
  createStudentBillingPlan,
  listStudentBillingPlans,
  serializeStudentBillingPlan,
  serializeStudentInstallment,
} from '@/src/lib/accounts/student-billing-plans';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
  hasStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

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

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertBillingReadAccess(null, auth.user.id);

    const sp = request.nextUrl.searchParams;
    const result = await withTransaction((client) =>
      listStudentBillingPlans(client, {
        q: sp.get('q')?.trim() || '',
        status: sp.get('status') || null,
        student_account_id: sp.get('student_account_id') || null,
        student_id: sp.get('student_id') || null,
        page: Math.max(1, Number(sp.get('page') || 1)),
        page_size: Math.min(100, Math.max(1, Number(sp.get('page_size') || 20))),
      })
    );

    return jsonSuccess({
      data: result.rows.map((r) => ({
        ...serializeStudentBillingPlan(r),
        fee_type_code: r.fee_type_code ?? null,
        fee_type_name_ar: r.fee_type_name_ar ?? null,
        account_number: r.account_number ?? null,
        student_full_name_ar: r.student_full_name_ar ?? null,
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
    const created = await withTransaction(async (client) => {
      await assertStudentReceivablesCapability(
        client,
        auth.user.id,
        STUDENT_RECEIVABLES_CAPABILITIES.BILLING_MANAGE
      );
      const result = await createStudentBillingPlan(client, {
        ...body,
        created_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'student_billing_plan.created',
        entityType: 'student_billing_plan',
        entityId: result.plan.id,
        newValues: {
          ...serializeStudentBillingPlan(result.plan),
          installments: result.installments.map(serializeStudentInstallment),
        },
        description: `إنشاء خطة رسوم ${result.plan.plan_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return result;
    });

    return jsonSuccess(
      {
        data: {
          ...serializeStudentBillingPlan(created.plan),
          installments: created.installments.map(serializeStudentInstallment),
        },
      },
      201
    );
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
