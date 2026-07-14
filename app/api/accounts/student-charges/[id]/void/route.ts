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
  serializeStudentCharge,
  voidStudentCharge,
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

    const voided = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      const row = await voidStudentCharge(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        reason: body.reason ?? body.void_reason,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'student_charge.voided',
        entityType: 'student_charge',
        entityId: row.id,
        newValues: serializeStudentCharge(row),
        description: `إلغاء مطالبة مالية ${row.charge_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeStudentCharge(voided) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
