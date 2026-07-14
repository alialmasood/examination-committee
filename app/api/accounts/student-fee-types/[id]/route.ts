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
  loadStudentFeeType,
  serializeStudentFeeType,
  updateStudentFeeType,
} from '@/src/lib/accounts/student-fee-types';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertStudentReceivablesCapability(
      null,
      auth.user.id,
      STUDENT_RECEIVABLES_CAPABILITIES.VIEW
    );
    const { id } = await context.params;
    const detail = await query(
      `SELECT ft.*,
              a.code AS revenue_gl_code,
              a.name_ar AS revenue_gl_name_ar,
              cc.code AS default_cost_center_code,
              cc.name_ar AS default_cost_center_name_ar
       FROM accounts.student_fee_types ft
       LEFT JOIN accounts.chart_of_accounts a ON a.id = ft.revenue_gl_account_id
       LEFT JOIN accounts.cost_centers cc ON cc.id = ft.default_cost_center_id
       WHERE ft.id = $1::uuid`,
      [id]
    );
    if (!detail.rows[0]) {
      return jsonError('نوع الرسم غير موجود', 404);
    }
    const row = detail.rows[0];
    return jsonSuccess({
      data: {
        ...serializeStudentFeeType(
          row as Parameters<typeof serializeStudentFeeType>[0]
        ),
        revenue_gl_code: row.revenue_gl_code ?? null,
        revenue_gl_name_ar: row.revenue_gl_name_ar ?? null,
        default_cost_center_code: row.default_cost_center_code ?? null,
        default_cost_center_name_ar: row.default_cost_center_name_ar ?? null,
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const status = error.status === 403 ? 404 : error.status;
      return jsonError(
        status === 404 ? 'نوع الرسم غير موجود' : error.message,
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
        STUDENT_RECEIVABLES_CAPABILITIES.FEE_TYPES_MANAGE
      );
      const before = await loadStudentFeeType(client, id);
      const row = await updateStudentFeeType(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        name_ar: body.name_ar,
        name_en: body.name_en,
        category: body.category,
        revenue_gl_account_id: body.revenue_gl_account_id,
        default_amount: body.default_amount,
        requires_cost_center: body.requires_cost_center,
        default_cost_center_id: body.default_cost_center_id,
        is_tuition: body.is_tuition,
        is_refundable: body.is_refundable,
        description: body.description,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'student_fee_type.updated',
        entityType: 'student_fee_type',
        entityId: row.id,
        oldValues: serializeStudentFeeType(before),
        newValues: serializeStudentFeeType(row),
        description: `تعديل نوع رسم ${row.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeStudentFeeType(updated) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
