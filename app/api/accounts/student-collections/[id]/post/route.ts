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
  loadStudentCollection,
  postStudentCollection,
  serializeStudentCollection,
  serializeStudentCollectionAllocation,
} from '@/src/lib/accounts/student-collections';
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
        STUDENT_RECEIVABLES_CAPABILITIES.COLLECTIONS_POST
      );
      await acquireJournalEntriesLock(client);

      const before = await loadStudentCollection(client, id, false);
      const posted = await postStudentCollection(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });

      if (before.status !== 'POSTED') {
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'student_collection.posted',
          entityType: 'student_collection',
          entityId: posted.collection.id,
          newValues: {
            ...serializeStudentCollection(posted.collection),
            allocations: posted.allocations.map(serializeStudentCollectionAllocation),
          },
          description: `ترحيل تحصيل ${posted.collection.collection_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      }

      return { posted, wasPosted: before.status === 'POSTED' };
    });

    return jsonSuccess({
      data: {
        ...serializeStudentCollection(result.posted.collection),
        allocations: result.posted.allocations.map(serializeStudentCollectionAllocation),
      },
      created: !result.wasPosted,
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
