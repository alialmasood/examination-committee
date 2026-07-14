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
  serializeStudentCollection,
  voidStudentCollection,
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

    const voided = await withTransaction(async (client) => {
      await assertStudentReceivablesCapability(
        client,
        auth.user.id,
        STUDENT_RECEIVABLES_CAPABILITIES.COLLECTIONS_VOID
      );
      await acquireJournalEntriesLock(client);

      const before = await loadStudentCollection(client, id, false);
      const row = await voidStudentCollection(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        reason: body.reason,
      });

      if (before.status !== 'VOID') {
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'student_collection.voided',
          entityType: 'student_collection',
          entityId: row.id,
          oldValues: serializeStudentCollection(before),
          newValues: serializeStudentCollection(row),
          description: `إلغاء تحصيل ${row.collection_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      }

      return row;
    });

    return jsonSuccess({ data: serializeStudentCollection(voided) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
