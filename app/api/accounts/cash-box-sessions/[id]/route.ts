import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { getAccountBookBalance } from '@/src/lib/accounts/account-book-balance';
import {
  loadCashSession,
  serializeCashCount,
  serializeCashSession,
  listCashCountsForSession,
} from '@/src/lib/accounts/cash-box-sessions';
import {
  calculateSessionExpectedBalance,
  listVouchersForSession,
  serializeCashVoucher,
} from '@/src/lib/accounts/cash-vouchers';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const session = await withTransaction(async (client) => loadCashSession(client, id));

    const meta = await query(
      `SELECT cb.code AS cash_box_code, cb.name_ar AS cash_box_name_ar,
              cb.account_id,
              fy.code AS fiscal_year_code, fp.code AS fiscal_period_code,
              u.username AS primary_custodian_username,
              COALESCE(u.full_name, u.username) AS primary_custodian_name
       FROM accounts.cash_box_sessions s
       JOIN accounts.cash_boxes cb ON cb.id = s.cash_box_id
       JOIN accounts.fiscal_years fy ON fy.id = s.fiscal_year_id
       JOIN accounts.fiscal_periods fp ON fp.id = s.fiscal_period_id
       LEFT JOIN student_affairs.users u ON u.id = s.primary_custodian_user_id
       WHERE s.id = $1::uuid`,
      [id]
    );

    const counts = await withTransaction(async (client) =>
      listCashCountsForSession(client, id)
    );
    const currentCount = session.current_count_id
      ? counts.find((c) => c.id === session.current_count_id) ?? null
      : null;

    let currentBookBalance: string | null = null;
    const accountId = meta.rows[0]?.account_id as string | null | undefined;
    if (accountId) {
      const bal = await getAccountBookBalance(accountId);
      currentBookBalance = bal.balance;
    }

    const { vouchers, expected } = await withTransaction(async (client) => {
      const v = await listVouchersForSession(client, id);
      const exp = await calculateSessionExpectedBalance(client, {
        sessionId: id,
        accountId: accountId ?? null,
      });
      return { vouchers: v, expected: exp };
    });

    return jsonSuccess({
      data: {
        ...serializeCashSession(session),
        ...(meta.rows[0] ?? {}),
        current_book_balance: currentBookBalance,
        current_count: currentCount ? serializeCashCount(currentCount) : null,
        counts: counts.map(serializeCashCount),
        vouchers: vouchers.map(serializeCashVoucher),
        expected_balance: expected,
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
