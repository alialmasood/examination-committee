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
  createStudentCharge,
  listStudentCharges,
  serializeStudentCharge,
} from '@/src/lib/accounts/student-charges';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

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
    const result = await withTransaction((client) =>
      listStudentCharges(client, {
        q: sp.get('q')?.trim() || '',
        status: sp.get('status') || null,
        student_account_id: sp.get('student_account_id') || null,
        student_id: sp.get('student_id') || null,
        fee_type_id: sp.get('fee_type_id') || null,
        page: Math.max(1, Number(sp.get('page') || 1)),
        page_size: Math.min(100, Math.max(1, Number(sp.get('page_size') || 20))),
      })
    );

    return jsonSuccess({
      data: result.rows.map((r) => ({
        ...serializeStudentCharge(r),
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
        STUDENT_RECEIVABLES_CAPABILITIES.CHARGES_PREPARE
      );
      const row = await createStudentCharge(client, {
        ...body,
        created_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'student_charge.created',
        entityType: 'student_charge',
        entityId: row.id,
        newValues: serializeStudentCharge(row),
        description: `إنشاء مطالبة مالية ${row.charge_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeStudentCharge(created) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
