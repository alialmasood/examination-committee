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
  getDefaultFeeRevenueGlAccount,
  listEligibleRevenueGlAccounts,
  suggestNextFeeTypeCode,
  type StudentFeeCategory,
} from '@/src/lib/accounts/student-fee-types';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

const CATEGORIES = new Set<StudentFeeCategory>([
  'TUITION',
  'REGISTRATION',
  'LAB',
  'EXAM',
  'SERVICE',
  'TRANSPORT',
  'ACCOMMODATION',
  'OTHER',
]);

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const categoryRaw = (request.nextUrl.searchParams.get('category') || '')
      .trim()
      .toUpperCase();
    const category = CATEGORIES.has(categoryRaw as StudentFeeCategory)
      ? (categoryRaw as StudentFeeCategory)
      : 'TUITION';

    const data = await withTransaction(async (client) => {
      await assertStudentReceivablesCapability(
        client,
        auth.user.id,
        STUDENT_RECEIVABLES_CAPABILITIES.FEE_TYPES_MANAGE
      );
      const [code, revenue_gl_account, revenue_gl_accounts] = await Promise.all([
        suggestNextFeeTypeCode(client),
        getDefaultFeeRevenueGlAccount(client, auth.user.id, category),
        listEligibleRevenueGlAccounts(client),
      ]);
      return { code, revenue_gl_account, revenue_gl_accounts, category };
    });
    return jsonSuccess({ data });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
