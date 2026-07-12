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
  loadCashTransfer,
  serializeCashTransfer,
  updateCashTransfer,
} from '@/src/lib/accounts/cash-transfers';
import {
  acquireCashBoxesLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const transfer = await withTransaction(async (client) =>
      loadCashTransfer(client, id)
    );

    const meta = await query(
      `SELECT
         sb.code AS source_cash_box_code, sb.name_ar AS source_cash_box_name_ar,
         db.code AS destination_cash_box_code, db.name_ar AS destination_cash_box_name_ar,
         fy.code AS fiscal_year_code,
         dje.entry_number AS dispatch_journal_entry_number,
         rje.entry_number AS receipt_journal_entry_number,
         vje.entry_number AS reversal_journal_entry_number,
         COALESCE(cu.full_name, cu.username) AS created_by_name,
         COALESCE(du.full_name, du.username) AS dispatched_by_name,
         COALESCE(ru.full_name, ru.username) AS received_by_name,
         COALESCE(xu.full_name, xu.username) AS cancelled_by_name,
         ss.session_date::text AS source_session_date,
         ds.session_date::text AS destination_session_date
       FROM accounts.cash_transfers t
       JOIN accounts.cash_boxes sb ON sb.id = t.source_cash_box_id
       JOIN accounts.cash_boxes db ON db.id = t.destination_cash_box_id
       JOIN accounts.fiscal_years fy ON fy.id = t.fiscal_year_id
       LEFT JOIN accounts.journal_entries dje ON dje.id = t.dispatch_journal_entry_id
       LEFT JOIN accounts.journal_entries rje ON rje.id = t.receipt_journal_entry_id
       LEFT JOIN accounts.journal_entries vje ON vje.id = t.reversal_journal_entry_id
       LEFT JOIN accounts.cash_box_sessions ss ON ss.id = t.source_session_id
       LEFT JOIN accounts.cash_box_sessions ds ON ds.id = t.destination_session_id
       LEFT JOIN student_affairs.users cu ON cu.id = t.created_by
       LEFT JOIN student_affairs.users du ON du.id = t.dispatched_by
       LEFT JOIN student_affairs.users ru ON ru.id = t.received_by
       LEFT JOIN student_affairs.users xu ON xu.id = t.cancelled_by
       WHERE t.id = $1::uuid`,
      [id]
    );

    return jsonSuccess({
      data: {
        ...serializeCashTransfer(transfer),
        ...(meta.rows[0] ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const updated = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const before = await loadCashTransfer(client, id, true);
      const row = await updateCashTransfer(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        ...body,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_transfer.updated',
        entityType: 'cash_transfer',
        entityId: row.id,
        oldValues: serializeCashTransfer(before),
        newValues: serializeCashTransfer(row),
        description: `تعديل تحويل ${row.transfer_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });
    return jsonSuccess({ data: serializeCashTransfer(updated) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
