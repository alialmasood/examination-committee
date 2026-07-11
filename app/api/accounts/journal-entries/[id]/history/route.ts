import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { loadJournalEntry } from '@/src/lib/accounts/journal-entries';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    await withTransaction(async (client) => loadJournalEntry(client, id));

    const result = await query(
      `SELECT a.id, a.action, a.description, a.old_values, a.new_values, a.created_at,
              u.username
       FROM accounts.financial_audit_log a
       LEFT JOIN student_affairs.users u ON u.id = a.user_id
       WHERE a.entity_type = 'journal_entry' AND a.entity_id = $1
       ORDER BY a.created_at ASC`,
      [id]
    );

    return jsonSuccess({ data: result.rows });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
