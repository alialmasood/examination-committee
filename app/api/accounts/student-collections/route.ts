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
  createStudentCollection,
  listStudentCollections,
  serializeStudentCollection,
  serializeStudentCollectionAllocation,
} from '@/src/lib/accounts/student-collections';
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
      listStudentCollections(client, {
        q: sp.get('q')?.trim() || '',
        status: sp.get('status') || null,
        student_account_id: sp.get('student_account_id') || null,
        student_id: sp.get('student_id') || null,
        payment_method: sp.get('payment_method') || null,
        page: Math.max(1, Number(sp.get('page') || 1)),
        page_size: Math.min(100, Math.max(1, Number(sp.get('page_size') || 20))),
      })
    );

    return jsonSuccess({
      data: result.rows.map((r) => ({
        ...serializeStudentCollection(r),
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
        STUDENT_RECEIVABLES_CAPABILITIES.COLLECTIONS_PREPARE
      );
      const result = await createStudentCollection(client, {
        ...body,
        created_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'student_collection.created',
        entityType: 'student_collection',
        entityId: result.collection.id,
        newValues: {
          ...serializeStudentCollection(result.collection),
          allocations: result.allocations.map(serializeStudentCollectionAllocation),
        },
        description: `إنشاء تحصيل ${result.collection.collection_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return result;
    });

    return jsonSuccess(
      {
        data: {
          ...serializeStudentCollection(created.collection),
          allocations: created.allocations.map(serializeStudentCollectionAllocation),
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
