import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { listReliefOptions } from '@/src/lib/accounts/student-reliefs';
import { listEligibleReliefExpenseGlAccounts } from '@/src/lib/accounts/student-relief-types';
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

    const data = await withTransaction(async (client) => {
      const opts = await listReliefOptions(client);
      const expenseGls = await listEligibleReliefExpenseGlAccounts(client);
      return { ...opts, expense_gl_accounts: expenseGls };
    });

    return jsonSuccess({ data });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
