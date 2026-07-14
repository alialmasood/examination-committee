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
  createStudentReliefType,
  listStudentReliefTypes,
  serializeStudentReliefType,
} from '@/src/lib/accounts/student-relief-types';
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
    const activeRaw = sp.get('is_active');
    const isActive =
      activeRaw == null || activeRaw === ''
        ? null
        : activeRaw === '1' || activeRaw.toLowerCase() === 'true';

    const result = await withTransaction((client) =>
      listStudentReliefTypes(client, {
        q: sp.get('q')?.trim() || '',
        relief_kind: sp.get('relief_kind') || null,
        is_active: isActive,
        page: Math.max(1, Number(sp.get('page') || 1)),
        page_size: Math.min(100, Math.max(1, Number(sp.get('page_size') || 50))),
      })
    );

    return jsonSuccess({
      data: result.rows.map((r) => ({
        ...serializeStudentReliefType(r),
        gl_code: r.gl_code ?? null,
        gl_name_ar: r.gl_name_ar ?? null,
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
        STUDENT_RECEIVABLES_CAPABILITIES.RELIEF_TYPES_MANAGE
      );
      const row = await createStudentReliefType(client, {
        ...body,
        created_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'student_relief_type.created',
        entityType: 'student_relief_type',
        entityId: row.id,
        newValues: serializeStudentReliefType(row),
        description: `إنشاء نوع تخفيض ${row.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeStudentReliefType(created) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
