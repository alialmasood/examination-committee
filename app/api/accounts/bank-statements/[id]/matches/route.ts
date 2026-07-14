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
  createReconciliationMatch,
  serializeBankReconciliationMatch,
} from '@/src/lib/accounts/bank-reconciliation';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const match = await withTransaction((client) =>
      createReconciliationMatch(client, {
        statementId: id,
        lineId: body.line_id,
        journalEntryId: body.journal_entry_id,
        journalEntryLineId: body.journal_entry_line_id || null,
        matchedAmount: body.matched_amount,
        matchType: body.match_type,
        confidence: body.confidence ?? null,
        notes: body.notes,
        userId: auth.user.id,
      })
    );

    return jsonSuccess({ data: serializeBankReconciliationMatch(match) }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
