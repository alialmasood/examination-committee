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
  loadStudentRelief,
  postStudentRelief,
  serializeStudentRelief,
} from '@/src/lib/accounts/student-reliefs';
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
        STUDENT_RECEIVABLES_CAPABILITIES.RELIEFS_POST
      );
      await acquireJournalEntriesLock(client);

      const before = await loadStudentRelief(client, id, false);
      const posted = await postStudentRelief(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });

      if (posted.created) {
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'student_relief.posted',
          entityType: 'student_relief',
          entityId: posted.relief.id,
          oldValues: serializeStudentRelief(before),
          newValues: {
            ...serializeStudentRelief(posted.relief),
            journal_entry_id: posted.relief.journal_entry_id,
          },
          description: `ترحيل تخفيض ${posted.relief.relief_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      }

      return { posted, wasPosted: before.status === 'POSTED' };
    });

    return jsonSuccess({
      data: serializeStudentRelief(result.posted.relief),
      created: result.posted.created,
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
