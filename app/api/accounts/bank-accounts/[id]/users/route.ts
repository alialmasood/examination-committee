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
  assignBankAccountUser,
  listBankAccountUsers,
  loadBankAccount,
} from '@/src/lib/accounts/bank-accounts';
import {
  acquireBanksLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

async function enrichUsers(
  assigned: Awaited<ReturnType<typeof listBankAccountUsers>>
) {
  if (!assigned.length) return [];
  const ids = assigned.map((u) => u.user_id);
  const usersRes = await query(
    `SELECT id, username, COALESCE(full_name, username) AS full_name
     FROM student_affairs.users
     WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  const byId = new Map(usersRes.rows.map((u) => [u.id as string, u]));
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
}

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const data = await withTransaction(async (client) => {
      await loadBankAccount(client, id);
      return listBankAccountUsers(client, id);
    });
    return jsonSuccess({ data: await enrichUsers(data) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const result = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const acc = await loadBankAccount(client, id);
      const beforeUsers = await listBankAccountUsers(client, id);
      const assigned = await assignBankAccountUser(client, {
        bank_account_id: id,
        user_id: body.user_id,
        can_view: body.can_view,
        can_prepare: body.can_prepare,
        can_post: body.can_post,
        can_approve: body.can_approve,
        can_reconcile: body.can_reconcile,
        created_by: auth.user.id,
      });
      const previous = beforeUsers.find((u) => u.user_id === assigned.user_id) ?? null;
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_account.user_assigned',
        entityType: 'bank_account_user',
        entityId: assigned.id,
        oldValues: previous,
        newValues: assigned,
        description: `تعيين مستخدم على الحساب المصرفي ${acc.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return {
        assignment: assigned,
        users: await listBankAccountUsers(client, id),
      };
    });

    return jsonSuccess({
      data: {
        assignment: {
          ...result.assignment,
          created_at:
            result.assignment.created_at instanceof Date
              ? result.assignment.created_at.toISOString()
              : String(result.assignment.created_at),
        },
        users: await enrichUsers(result.users),
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
