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
  getCashVarianceSettings,
  setCashVarianceSettings,
} from '@/src/lib/accounts/cash-settings';
import {
  acquireCashBoxesLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const data = await getCashVarianceSettings();
    return jsonSuccess({ data });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const body = await request.json();
    const before = await getCashVarianceSettings();
    const data = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const updated = await setCashVarianceSettings(client, {
        cash_variance_gain_account_id: body.cash_variance_gain_account_id,
        cash_variance_loss_account_id: body.cash_variance_loss_account_id,
        userId: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_box.variance_settings_updated',
        entityType: 'system_settings',
        entityId: 'cash_variance_accounts',
        oldValues: before,
        newValues: updated,
        description: 'تحديث حسابات فروقات جرد الصناديق',
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return updated;
    });

    return jsonSuccess({ data });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
