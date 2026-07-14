import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import {
  loadStudentCollection,
  previewAutoAllocation,
} from '@/src/lib/accounts/student-collections';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const preview = await withTransaction(async (client) => {
      await assertStudentReceivablesCapability(
        client,
        auth.user.id,
        STUDENT_RECEIVABLES_CAPABILITIES.COLLECTIONS_PREPARE
      );
      const collection = await loadStudentCollection(client, id, false);
      const amount =
        body.amount != null && body.amount !== ''
          ? body.amount
          : collection.amount;
      return previewAutoAllocation(
        client,
        collection.student_account_id,
        amount
      );
    });

    return jsonSuccess({ data: preview });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
