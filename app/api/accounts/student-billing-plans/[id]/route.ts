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
  getStudentBillingPlan,
  replaceInstallments,
  serializeStudentBillingPlan,
  serializeStudentInstallment,
  updateStudentBillingPlan,
} from '@/src/lib/accounts/student-billing-plans';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
  hasStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

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

    const detail = await query(
      `SELECT p.*,
              ft.code AS fee_type_code,
              ft.name_ar AS fee_type_name_ar,
              sa.account_number,
              COALESCE(s.full_name_ar, s.full_name) AS student_full_name_ar,
              s.university_id AS student_university_id
       FROM accounts.student_billing_plans p
       JOIN accounts.student_fee_types ft ON ft.id = p.fee_type_id
       JOIN accounts.student_accounts sa ON sa.id = p.student_account_id
       JOIN student_affairs.students s ON s.id = p.student_id
       WHERE p.id = $1::uuid`,
      [id]
    );
    if (!detail.rows[0]) {
      return jsonError('خطة الرسوم غير موجودة', 404);
    }

    const { installments } = await withTransaction((client) =>
      getStudentBillingPlan(client, id)
    );
    const row = detail.rows[0];

    return jsonSuccess({
      data: {
        ...serializeStudentBillingPlan(
          row as Parameters<typeof serializeStudentBillingPlan>[0]
        ),
        fee_type_code: row.fee_type_code ?? null,
        fee_type_name_ar: row.fee_type_name_ar ?? null,
        account_number: row.account_number ?? null,
        student_full_name_ar: row.student_full_name_ar ?? null,
        student_university_id: row.student_university_id ?? null,
        installments: installments.map(serializeStudentInstallment),
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const status = error.status === 403 ? 404 : error.status;
      return jsonError(
        status === 404 ? 'خطة الرسوم غير موجودة' : error.message,
        status
      );
    }
    return mapPgError(error);
  }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const updated = await withTransaction(async (client) => {
      await assertStudentReceivablesCapability(
        client,
        auth.user.id,
        STUDENT_RECEIVABLES_CAPABILITIES.BILLING_MANAGE
      );
      const before = await getStudentBillingPlan(client, id);

      let plan = before.plan;
      let installments = before.installments;
      let version = body.version;
      let updatedAt = body.updated_at;

      if (Array.isArray(body.installments)) {
        const replaced = await replaceInstallments(client, {
          planId: id,
          userId: auth.user.id,
          version,
          updated_at: updatedAt,
          installments: body.installments,
          total_amount: body.total_amount,
        });
        plan = replaced.plan;
        installments = replaced.installments;
        version = plan.version;
        updatedAt = plan.updated_at;
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'student_billing_plan.installments_replaced',
          entityType: 'student_billing_plan',
          entityId: plan.id,
          oldValues: {
            ...serializeStudentBillingPlan(before.plan),
            installments: before.installments.map(serializeStudentInstallment),
          },
          newValues: {
            ...serializeStudentBillingPlan(plan),
            installments: installments.map(serializeStudentInstallment),
          },
          description: `تحديث أقساط خطة رسوم ${plan.plan_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      }

      const hasMetadataUpdate =
        body.fee_type_id !== undefined ||
        body.academic_year_id !== undefined ||
        body.academic_year !== undefined ||
        body.description !== undefined ||
        body.external_reference !== undefined;

      if (hasMetadataUpdate) {
        const beforeMeta = plan;
        plan = await updateStudentBillingPlan(client, {
          id,
          userId: auth.user.id,
          version,
          updated_at: updatedAt,
          fee_type_id: body.fee_type_id,
          academic_year_id: body.academic_year_id,
          academic_year: body.academic_year,
          description: body.description,
          external_reference: body.external_reference,
        });
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'student_billing_plan.updated',
          entityType: 'student_billing_plan',
          entityId: plan.id,
          oldValues: serializeStudentBillingPlan(beforeMeta),
          newValues: serializeStudentBillingPlan(plan),
          description: `تعديل خطة رسوم ${plan.plan_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      } else if (!Array.isArray(body.installments)) {
        plan = await updateStudentBillingPlan(client, {
          id,
          userId: auth.user.id,
          version,
          updated_at: updatedAt,
          fee_type_id: body.fee_type_id,
          academic_year_id: body.academic_year_id,
          academic_year: body.academic_year,
          description: body.description,
          external_reference: body.external_reference,
        });
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'student_billing_plan.updated',
          entityType: 'student_billing_plan',
          entityId: plan.id,
          oldValues: serializeStudentBillingPlan(before.plan),
          newValues: serializeStudentBillingPlan(plan),
          description: `تعديل خطة رسوم ${plan.plan_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      }

      return { plan, installments };
    });

    return jsonSuccess({
      data: {
        ...serializeStudentBillingPlan(updated.plan),
        installments: updated.installments.map(serializeStudentInstallment),
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
