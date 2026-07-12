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
  listBankAccountUsers,
  loadBankAccount,
  serializeBankAccount,
  updateBankAccount,
} from '@/src/lib/accounts/bank-accounts';
import {
  acquireBanksLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const detail = await query(
      `SELECT ba.*,
              b.code AS bank_code,
              b.name_ar AS bank_name_ar,
              b.short_name AS bank_short_name,
              br.code AS branch_code,
              br.name_ar AS branch_name_ar,
              br.city AS branch_city,
              a.code AS gl_account_code,
              a.name_ar AS gl_account_name_ar
       FROM accounts.bank_accounts ba
       JOIN accounts.banks b ON b.id = ba.bank_id
       LEFT JOIN accounts.bank_branches br ON br.id = ba.bank_branch_id
       LEFT JOIN accounts.chart_of_accounts a ON a.id = ba.gl_account_id
       WHERE ba.id = $1::uuid`,
      [id]
    );
    if (!detail.rows[0]) {
      return jsonError('الحساب المصرفي غير موجود', 404);
    }

    const row = detail.rows[0];
    const users = await withTransaction(async (client) => {
      const assigned = await listBankAccountUsers(client, id);
      if (!assigned.length) return [];
      const ids = assigned.map((u) => u.user_id);
      const usersRes = await query(
        `SELECT id, username, COALESCE(full_name, username) AS full_name
         FROM student_affairs.users
         WHERE id = ANY($1::uuid[])`,
        [ids]
      );
      const byId = new Map(
        usersRes.rows.map((u) => [u.id as string, u])
      );
      return assigned.map((a) => {
        const u = byId.get(a.user_id);
        return {
          ...a,
          created_at:
            a.created_at instanceof Date
              ? a.created_at.toISOString()
              : String(a.created_at),
          username: u?.username ?? null,
          full_name: u?.full_name ?? null,
        };
      });
    });

    return jsonSuccess({
      data: {
        ...serializeBankAccount(row as Parameters<typeof serializeBankAccount>[0]),
        bank_code: row.bank_code ?? null,
        bank_name_ar: row.bank_name_ar ?? null,
        bank_short_name: row.bank_short_name ?? null,
        branch_code: row.branch_code ?? null,
        branch_name_ar: row.branch_name_ar ?? null,
        branch_city: row.branch_city ?? null,
        gl_account_code: row.gl_account_code ?? null,
        gl_account_name_ar: row.gl_account_name_ar ?? null,
        users,
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
    const body = await request.json();

    const updated = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const before = await loadBankAccount(client, id);
      const row = await updateBankAccount(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        account_name_ar: body.account_name_ar,
        account_name_en: body.account_name_en,
        bank_branch_id: body.bank_branch_id,
        account_number: body.account_number,
        iban: body.iban,
        account_type: body.account_type,
        opening_balance_reference: body.opening_balance_reference,
        opening_balance_date: body.opening_balance_date,
        is_primary: body.is_primary,
        allows_receipts: body.allows_receipts,
        allows_payments: body.allows_payments,
        allows_transfers: body.allows_transfers,
        allows_cheques: body.allows_cheques,
        cheque_book_enabled: body.cheque_book_enabled,
        notes: body.notes,
        gl_account_id: body.gl_account_id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_account.updated',
        entityType: 'bank_account',
        entityId: row.id,
        oldValues: serializeBankAccount(before),
        newValues: serializeBankAccount(row),
        description: `تعديل حساب مصرفي ${row.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeBankAccount(updated) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
