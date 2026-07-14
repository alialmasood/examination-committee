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
  getStudentReliefType,
  loadStudentReliefType,
  serializeStudentReliefType,
  updateStudentReliefType,
} from '@/src/lib/accounts/student-relief-types';
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
    const row = await withTransaction((client) => getStudentReliefType(client, id));
    return jsonSuccess({
      data: {
        ...serializeStudentReliefType(row),
        gl_code: row.gl_code ?? null,
        gl_name_ar: row.gl_name_ar ?? null,
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
        STUDENT_RECEIVABLES_CAPABILITIES.RELIEF_TYPES_MANAGE
      );
      const before = await loadStudentReliefType(client, id);
      const row = await updateStudentReliefType(client, {
        id,
        userId: auth.user.id,
        name_ar: body.name_ar,
        name_en: body.name_en,
        relief_kind: body.relief_kind,
        calculation_type: body.calculation_type,
        default_value: body.default_value,
        max_value: body.max_value,
        gl_account_id: body.gl_account_id,
        requires_approval: body.requires_approval,
        description: body.description,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'student_relief_type.updated',
        entityType: 'student_relief_type',
        entityId: row.id,
        oldValues: serializeStudentReliefType(before),
        newValues: serializeStudentReliefType(row),
        description: `تعديل نوع تخفيض ${row.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeStudentReliefType(updated) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
