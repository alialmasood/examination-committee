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
  getStudentRelief,
  loadStudentRelief,
  serializeStudentRelief,
  updateStudentRelief,
} from '@/src/lib/accounts/student-reliefs';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertStudentReceivablesCapability(
      null,
      auth.user.id,
      STUDENT_RECEIVABLES_CAPABILITIES.RELIEFS_VIEW
    );
    const { id } = await context.params;
    const row = await withTransaction((client) => getStudentRelief(client, id));
    return jsonSuccess({
      data: {
        ...serializeStudentRelief(row),
        relief_type_code: row.relief_type_code ?? null,
        relief_type_name_ar: row.relief_type_name_ar ?? null,
        relief_kind: row.relief_kind ?? null,
        account_number: row.account_number ?? null,
        student_full_name_ar: row.student_full_name_ar ?? null,
        charge_number: row.charge_number ?? null,
        charge_outstanding: row.charge_outstanding ?? null,
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
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
        STUDENT_RECEIVABLES_CAPABILITIES.RELIEFS_PREPARE
      );
      const before = await loadStudentRelief(client, id);
      const row = await updateStudentRelief(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        relief_type_id: body.relief_type_id,
        relief_date: body.relief_date,
        calculation_type: body.calculation_type,
        requested_amount: body.requested_amount,
        percentage_value: body.percentage_value,
        reason: body.reason,
        external_reference: body.external_reference,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'student_relief.updated',
        entityType: 'student_relief',
        entityId: row.id,
        oldValues: serializeStudentRelief(before),
        newValues: serializeStudentRelief(row),
        description: `تعديل طلب تخفيض ${row.relief_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeStudentRelief(updated) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
