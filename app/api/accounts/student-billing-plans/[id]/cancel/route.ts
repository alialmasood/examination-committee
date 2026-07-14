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
  cancelStudentBillingPlan,
  loadStudentBillingPlan,
  serializeStudentBillingPlan,
} from '@/src/lib/accounts/student-billing-plans';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const cancelled = await withTransaction(async (client) => {
      await assertStudentReceivablesCapability(
        client,
        auth.user.id,
        STUDENT_RECEIVABLES_CAPABILITIES.BILLING_ACTIVATE
      );
      const before = await loadStudentBillingPlan(client, id, false);
      const row = await cancelStudentBillingPlan(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        reason: body.reason,
      });
      if (before.status !== 'CANCELLED') {
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'student_billing_plan.cancelled',
          entityType: 'student_billing_plan',
          entityId: row.id,
          oldValues: serializeStudentBillingPlan(before),
          newValues: serializeStudentBillingPlan(row),
          description: `إلغاء خطة رسوم ${row.plan_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      }
      return row;
    });

    return jsonSuccess({ data: serializeStudentBillingPlan(cancelled) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
