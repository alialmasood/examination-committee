import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { createBankAdjustmentFromStatementLine } from '@/src/lib/accounts/bank-reconciliation';
import { serializeBankStatementLine } from '@/src/lib/accounts/bank-statements';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string; lineId: string }> };

/** إنشاء وترحيل قيد تسوية آلي لسطر كشف لم يُسجَّل بعد في الدفاتر (رسوم/فوائد بنكية) */
export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { lineId } = await context.params;
    const body = await request.json();

    const result = await withTransaction((client) =>
      createBankAdjustmentFromStatementLine(client, {
        lineId,
        counterAccountId: body.counter_account_id,
        costCenterId: body.cost_center_id,
        description: body.description,
        userId: auth.user.id,
      })
    );

    return jsonSuccess(
      {
        data: {
          line: serializeBankStatementLine(result.line),
          journal_entry_id: result.journalEntryId,
          match_id: result.matchId,
          amount: result.amount,
        },
      },
      201
    );
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
