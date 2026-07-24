import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { suggestNextReliefTypeCode, getDefaultReliefExpenseGlAccount } from '@/src/lib/accounts/student-relief-types';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const data = await withTransaction(async (client) => {
      await assertStudentReceivablesCapability(
        client,
        auth.user.id,
        STUDENT_RECEIVABLES_CAPABILITIES.RELIEF_TYPES_MANAGE
      );
      const [code, glAccount] = await Promise.all([
        suggestNextReliefTypeCode(client),
        getDefaultReliefExpenseGlAccount(client, auth.user.id),
      ]);
      return { code, gl_account: glAccount };
    });
    return jsonSuccess({ data });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
