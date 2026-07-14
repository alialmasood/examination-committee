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
  loadBankAccount,
  removeBankAccountUser,
} from '@/src/lib/accounts/bank-accounts';
import {
  acquireBanksLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string; userId: string }> };

export async function DELETE(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id, userId } = await context.params;

    await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const acc = await loadBankAccount(client, id);
      const removed = await removeBankAccountUser(client, {
        bank_account_id: id,
        user_id: userId,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_account.user_removed',
        entityType: 'bank_account_user',
        entityId: removed.id,
        oldValues: removed,
        description: `إزالة مستخدم من الحساب المصرفي ${acc.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
    });

    return jsonSuccess({ data: { removed: true } });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
