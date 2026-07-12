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
  loadCashCountAdjustment,
  serializeCashCountAdjustment,
} from '@/src/lib/accounts/cash-count-adjustments';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const adjustment = await withTransaction(async (client) =>
      loadCashCountAdjustment(client, id)
    );

    const je = adjustment.journal_entry_id
      ? await query(
          `SELECT id, entry_number, status, total_debit::text, total_credit::text,
                  posted_at, source_type, source_id
           FROM accounts.journal_entries WHERE id = $1::uuid`,
          [adjustment.journal_entry_id]
        )
      : { rows: [] };

    return jsonSuccess({
      data: {
        ...serializeCashCountAdjustment(adjustment),
        journal_entry: je.rows[0] ?? null,
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
