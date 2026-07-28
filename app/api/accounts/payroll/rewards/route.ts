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
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import {
  createPayrollReward,
  ensurePayrollRewardsTable,
  listPayrollRewards,
  serializePayrollReward,
} from '@/src/lib/accounts/payroll-rewards';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await ensurePayrollRewardsTable();
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW);
    const sp = request.nextUrl.searchParams;
    const result = await withTransaction((client) =>
      listPayrollRewards(client, {
        q: sp.get('q')?.trim() || '',
        page: Math.max(1, Number(sp.get('page') || 1)),
        page_size: Math.min(200, Math.max(1, Number(sp.get('page_size') || 50))),
      })
    );
    return jsonSuccess({
      data: result.rows.map(serializePayrollReward),
      pagination: {
        page: result.page,
        page_size: result.page_size,
        total: result.total,
        total_pages: Math.ceil(result.total / result.page_size) || 1,
      },
    });
  } catch (error) {
    return error instanceof AccountsHttpError
      ? jsonError(error.message, error.status)
      : mapPgError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await ensurePayrollRewardsTable();
    const body = await request.json();
    const row = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.MANAGE_ASSIGNMENTS);
      const reward = await createPayrollReward(client, {
        ...body,
        created_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'payroll_reward.created',
        entityType: 'payroll_reward',
        entityId: reward.id,
        newValues: serializePayrollReward(reward),
        description: `إنشاء مكافئة ${reward.reward_code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return reward;
    });
    return jsonSuccess({ data: serializePayrollReward(row) }, 201);
  } catch (error) {
    return error instanceof AccountsHttpError
      ? jsonError(error.message, error.status)
      : mapPgError(error);
  }
}
