import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { calculateSessionExpectedBalance } from '@/src/lib/accounts/cash-vouchers';
import { getCashInTransitSettings } from '@/src/lib/accounts/cash-settings';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const sourceBoxId = request.nextUrl.searchParams.get('source_cash_box_id');

    const boxes = await query(
      `SELECT cb.id, cb.code, cb.name_ar, cb.status, cb.account_id, cb.currency_code,
              a.code AS account_code, a.name_ar AS account_name_ar
       FROM accounts.cash_boxes cb
       LEFT JOIN accounts.chart_of_accounts a ON a.id = cb.account_id
       WHERE cb.status = 'ACTIVE'
       ORDER BY cb.code`
    );

    const sessions = await query(
      `SELECT s.id, s.cash_box_id, s.session_date::text AS session_date, s.status,
              s.fiscal_year_id, s.fiscal_period_id,
              s.opening_book_balance::text AS opening_book_balance,
              cb.account_id
       FROM accounts.cash_box_sessions s
       JOIN accounts.cash_boxes cb ON cb.id = s.cash_box_id
       WHERE s.status = 'OPEN'
       ORDER BY s.session_date DESC`
    );

    const expectedBySession: Record<
      string,
      Awaited<ReturnType<typeof calculateSessionExpectedBalance>>
    > = {};
    await withTransaction(async (client) => {
      for (const s of sessions.rows) {
        if (sourceBoxId && s.cash_box_id !== sourceBoxId) continue;
        expectedBySession[s.id as string] = await calculateSessionExpectedBalance(
          client,
          {
            sessionId: s.id as string,
            accountId: (s.account_id as string) || null,
          }
        );
      }
    });

    const cit = await getCashInTransitSettings();
    let citAccount: { id: string; code: string; name_ar: string } | null = null;
    if (cit.cash_in_transit_account_id) {
      const a = await query(
        `SELECT id, code, name_ar FROM accounts.chart_of_accounts WHERE id = $1::uuid`,
        [cit.cash_in_transit_account_id]
      );
      citAccount = a.rows[0] ?? null;
    }

    return jsonSuccess({
      data: {
        cash_boxes: boxes.rows,
        open_sessions: sessions.rows.map((s) => ({
          ...s,
          expected_balance: expectedBySession[s.id as string] ?? null,
        })),
        cash_in_transit_account: citAccount,
        statuses: [
          { code: 'DRAFT', name_ar: 'مسودة' },
          { code: 'DISPATCHED', name_ar: 'قيد النقل' },
          { code: 'RECEIVED', name_ar: 'مُستلم' },
          { code: 'CANCELLED', name_ar: 'ملغى' },
        ],
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
