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
  deactivateBankBranch,
  serializeBankBranch,
} from '@/src/lib/accounts/bank-branches';
import {
  acquireBanksLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const deactivated = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const row = await deactivateBankBranch(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_branch.deactivated',
        entityType: 'bank_branch',
        entityId: row.id,
        newValues: serializeBankBranch(row),
        description: `تعطيل فرع مصرف ${row.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeBankBranch(deactivated) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
