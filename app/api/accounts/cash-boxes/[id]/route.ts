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
  loadCashBox,
  serializeCashBox,
  updateCashBox,
} from '@/src/lib/accounts/cash-boxes';
import {
  getActivePrimaryCustodian,
  listCashBoxCustodians,
} from '@/src/lib/accounts/cash-box-custodians';
import {
  acquireCashBoxesLock,
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
      `SELECT cb.*,
              a.code AS account_code,
              a.name_ar AS account_name_ar,
              t.name_ar AS box_type_name_ar
       FROM accounts.cash_boxes cb
       LEFT JOIN accounts.chart_of_accounts a ON a.id = cb.account_id
       LEFT JOIN accounts.cash_box_types t ON t.code = cb.box_type_code
       WHERE cb.id = $1::uuid`,
      [id]
    );
    if (!detail.rows[0]) {
      return jsonError('الصندوق غير موجود', 404);
    }

    const row = detail.rows[0];
    const bookBalance = row.account_id
      ? (await getAccountBookBalance(row.account_id as string)).balance
      : '0.000';

    const custodians = await withTransaction(async (client) =>
      listCashBoxCustodians(client, id, false)
    );
    const primary = await withTransaction(async (client) =>
      getActivePrimaryCustodian(client, id)
    );

    return jsonSuccess({
      data: {
        ...serializeCashBox(row as Parameters<typeof serializeCashBox>[0]),
        account_code: row.account_code ?? null,
        account_name_ar: row.account_name_ar ?? null,
        box_type_name_ar: row.box_type_name_ar ?? null,
        book_balance: bookBalance,
        primary_custodian: primary,
        custodians,
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}

export async function PUT(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const updated = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const before = await loadCashBox(client, id);
      const row = await updateCashBox(client, id, {
        ...body,
        updated_by: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_box.updated',
        entityType: 'cash_box',
        entityId: row.id,
        oldValues: serializeCashBox(before),
        newValues: serializeCashBox(row),
        description: `تعديل صندوق ${row.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    const bookBalance = updated.account_id
      ? (await getAccountBookBalance(updated.account_id)).balance
      : '0.000';

    return jsonSuccess({
      data: {
        ...serializeCashBox(updated),
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
