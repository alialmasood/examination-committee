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
  activateStudentBillingPlan,
  loadStudentBillingPlan,
  serializeStudentBillingPlan,
  serializeStudentInstallment,
} from '@/src/lib/accounts/student-billing-plans';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import {
  acquireJournalEntriesLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const result = await withTransaction(async (client) => {
      await assertStudentReceivablesCapability(
        client,
        auth.user.id,
        STUDENT_RECEIVABLES_CAPABILITIES.BILLING_ACTIVATE
      );
      await acquireJournalEntriesLock(client);

      const before = await loadStudentBillingPlan(client, id, false);
      const activated = await activateStudentBillingPlan(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        activation_date: body.activation_date,
      });

      if (before.status !== 'ACTIVE') {
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'student_billing_plan.activated',
          entityType: 'student_billing_plan',
          entityId: activated.plan.id,
          oldValues: serializeStudentBillingPlan(before),
          newValues: {
            ...serializeStudentBillingPlan(activated.plan),
            installments: activated.installments.map(serializeStudentInstallment),
          },
          description: `تفعيل خطة رسوم ${activated.plan.plan_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      }

      return { activated, wasActive: before.status === 'ACTIVE' };
    });

    return jsonSuccess({
      data: {
        ...serializeStudentBillingPlan(result.activated.plan),
        installments: result.activated.installments.map(serializeStudentInstallment),
      },
      created: !result.wasActive,
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
