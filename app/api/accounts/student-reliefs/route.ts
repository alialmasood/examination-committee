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
  createStudentRelief,
  listStudentReliefs,
  serializeStudentRelief,
} from '@/src/lib/accounts/student-reliefs';
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
      STUDENT_RECEIVABLES_CAPABILITIES.RELIEFS_VIEW
    );

    const sp = request.nextUrl.searchParams;
    const result = await withTransaction((client) =>
      listStudentReliefs(client, {
        q: sp.get('q')?.trim() || '',
        status: sp.get('status') || null,
        student_account_id: sp.get('student_account_id') || null,
        student_charge_id: sp.get('student_charge_id') || null,
        relief_type_id: sp.get('relief_type_id') || null,
        page: Math.max(1, Number(sp.get('page') || 1)),
        page_size: Math.min(100, Math.max(1, Number(sp.get('page_size') || 20))),
      })
    );

    return jsonSuccess({
      data: result.rows.map((r) => ({
        ...serializeStudentRelief(r),
        relief_type_code: r.relief_type_code ?? null,
        relief_type_name_ar: r.relief_type_name_ar ?? null,
        account_number: r.account_number ?? null,
        student_full_name_ar: r.student_full_name_ar ?? null,
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
        STUDENT_RECEIVABLES_CAPABILITIES.RELIEFS_PREPARE
      );
      const row = await createStudentRelief(client, {
        ...body,
        requested_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'student_relief.created',
        entityType: 'student_relief',
        entityId: row.id,
        newValues: serializeStudentRelief(row),
        description: `إنشاء طلب تخفيض ${row.relief_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeStudentRelief(created) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
