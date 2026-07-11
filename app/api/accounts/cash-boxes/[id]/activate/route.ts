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
import { getAccountBookBalance } from '@/src/lib/accounts/account-book-balance';
import {
  activateCashBox,
  serializeCashBox,
} from '@/src/lib/accounts/cash-boxes';
import {
  acquireCashBoxesLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const activated = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const row = await activateCashBox(client, id, {
        version: body.version,
        updated_at: body.updated_at,
        activated_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_box.activated',
        entityType: 'cash_box',
        entityId: row.id,
        newValues: serializeCashBox(row),
        description: `تفعيل صندوق ${row.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    const bookBalance = activated.account_id
      ? (await getAccountBookBalance(activated.account_id)).balance
      : '0.000';

    return jsonSuccess({
      data: {
        ...serializeCashBox(activated),
        book_balance: bookBalance,
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
