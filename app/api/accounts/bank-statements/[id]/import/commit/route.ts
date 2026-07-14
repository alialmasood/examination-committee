import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { commitBankStatementCsv } from '@/src/lib/accounts/bank-statement-csv';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const result = await withTransaction((client) =>
      commitBankStatementCsv(client, {
        statementId: id,
        rows: Array.isArray(body.rows) ? body.rows : [],
        userId: auth.user.id,
        fileName: body.file_name || null,
      })
    );

    return jsonSuccess({ data: result });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
