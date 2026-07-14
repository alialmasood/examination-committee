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
  assertCanAccessBankStatement,
  listBankStatementLines,
  loadBankStatement,
  serializeBankStatement,
  serializeBankStatementLine,
  updateBankStatement,
} from '@/src/lib/accounts/bank-statements';
import { withTransaction, type TxClient } from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

/** يحوّل رفض الوصول (403) إلى "غير موجود" (404) لعدم تسريب وجود سجلات لا يملك المستخدم صلاحية عليها */
async function assertCanAccessOrNotFound(
  client: TxClient,
  params: { statementId: string; userId: string }
) {
  try {
    return await assertCanAccessBankStatement(client, params);
  } catch (e) {
    if (e instanceof AccountsHttpError && e.status === 403) {
      throw new AccountsHttpError('كشف الحساب المصرفي غير موجود', 404);
    }
    throw e;
  }
}

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const { statement, lines } = await withTransaction(async (client) => {
      const s = await assertCanAccessOrNotFound(client, {
        statementId: id,
        userId: auth.user.id,
      });
      const l = await listBankStatementLines(client, id);
      return { statement: s, lines: l };
    });

    const meta = await query(
      `SELECT ba.code AS bank_account_code, ba.account_name_ar AS bank_account_name_ar,
              ba.currency_code AS bank_account_currency, ba.gl_account_id,
              gl.code AS gl_account_code, gl.name_ar AS gl_account_name_ar,
              b.code AS bank_code, b.name_ar AS bank_name_ar,
              br.code AS branch_code, br.name_ar AS branch_name_ar,
              COALESCE(uc.full_name, uc.username) AS created_by_name,
              COALESCE(uu.full_name, uu.username) AS updated_by_name,
              COALESCE(us.full_name, us.username) AS started_by_name,
              COALESCE(ur.full_name, ur.username) AS reconciled_by_name,
              COALESCE(ucl.full_name, ucl.username) AS closed_by_name,
              COALESCE(uca.full_name, uca.username) AS cancelled_by_name
       FROM accounts.bank_statements s
       JOIN accounts.bank_accounts ba ON ba.id = s.bank_account_id
       JOIN accounts.banks b ON b.id = ba.bank_id
       LEFT JOIN accounts.bank_branches br ON br.id = ba.bank_branch_id
       JOIN accounts.chart_of_accounts gl ON gl.id = ba.gl_account_id
       LEFT JOIN student_affairs.users uc ON uc.id = s.created_by
       LEFT JOIN student_affairs.users uu ON uu.id = s.updated_by
       LEFT JOIN student_affairs.users us ON us.id = s.started_by
       LEFT JOIN student_affairs.users ur ON ur.id = s.reconciled_by
       LEFT JOIN student_affairs.users ucl ON ucl.id = s.closed_by
       LEFT JOIN student_affairs.users uca ON uca.id = s.cancelled_by
       WHERE s.id = $1::uuid`,
      [id]
    );

    return jsonSuccess({
      data: {
        ...serializeBankStatement(statement),
        ...(meta.rows[0] || {}),
        lines: lines.map(serializeBankStatementLine),
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
    const statement = await withTransaction(async (client) => {
      const before = await loadBankStatement(client, id);
      const updated = await updateBankStatement(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        ...body,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_statement.updated',
        entityType: 'bank_statement',
        entityId: updated.id,
        oldValues: serializeBankStatement(before),
        newValues: serializeBankStatement(updated),
        description: `تعديل كشف الحساب المصرفي ${updated.statement_number}`,
      });
      return updated;
    });
    return jsonSuccess({ data: serializeBankStatement(statement) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
