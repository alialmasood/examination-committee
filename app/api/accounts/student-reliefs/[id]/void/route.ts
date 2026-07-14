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
  serializeStudentRelief,
  voidStudentRelief,
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

    const updated = await withTransaction(async (client) => {
      await assertStudentReceivablesCapability(
        client,
        auth.user.id,
        STUDENT_RECEIVABLES_CAPABILITIES.RELIEFS_VOID
      );

      const before = await loadStudentRelief(client, id, false);
      if (before.status === 'POSTED') {
        await acquireJournalEntriesLock(client);
      }

      const row = await voidStudentRelief(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        reason: body.reason,
      });

      if (before.status !== 'VOID') {
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'student_relief.voided',
          entityType: 'student_relief',
          entityId: row.id,
          oldValues: serializeStudentRelief(before),
          newValues: serializeStudentRelief(row),
          description: `إلغاء تخفيض ${row.relief_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      }

      return row;
    });

    return jsonSuccess({ data: serializeStudentRelief(updated) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
