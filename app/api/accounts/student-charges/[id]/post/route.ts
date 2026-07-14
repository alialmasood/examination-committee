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
  postStudentCharge,
  serializeStudentCharge,
} from '@/src/lib/accounts/student-charges';
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
      await acquireJournalEntriesLock(client);
      const posted = await postStudentCharge(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });
      if (posted.created) {
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'student_charge.posted',
          entityType: 'student_charge',
          entityId: posted.charge.id,
          newValues: {
            ...serializeStudentCharge(posted.charge),
            journal_entry_id: posted.charge.journal_entry_id,
          },
          description: `ترحيل مطالبة مالية ${posted.charge.charge_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      }
      return posted;
    });

    return jsonSuccess({
      data: serializeStudentCharge(result.charge),
      created: result.created,
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
