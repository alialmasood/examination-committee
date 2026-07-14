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
import { assertCanViewCashBoxOrThrowNotFound } from '@/src/lib/accounts/cash-box-access';
import {
  deleteDraftCashVoucher,
  loadCashVoucher,
  serializeCashVoucher,
  updateCashVoucher,
} from '@/src/lib/accounts/cash-vouchers';
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
    const voucher = await withTransaction(async (client) => {
      const loaded = await loadCashVoucher(client, id);
      await assertCanViewCashBoxOrThrowNotFound(client, {
        cashBoxId: loaded.cash_box_id,
        userId: auth.user.id,
      });
      return loaded;
    });

    const meta = await query(
      `SELECT cb.code AS cash_box_code, cb.name_ar AS cash_box_name_ar,
              cb.account_id AS cash_account_id,
              ca_cash.code AS cash_account_code,
              ca_cash.name_ar AS cash_account_name_ar,
              ca.code AS counter_account_code,
              ca.name_ar AS counter_account_name_ar,
              cc.code AS cost_center_code,
              cc.name_ar AS cost_center_name_ar,
              je.entry_number AS journal_entry_number,
              rje.entry_number AS reversal_journal_entry_number,
              fy.code AS fiscal_year_code,
              fp.code AS fiscal_period_code,
              COALESCE(uc.full_name, uc.username) AS created_by_name,
              COALESCE(up.full_name, up.username) AS posted_by_name,
              COALESCE(uv.full_name, uv.username) AS voided_by_name
       FROM accounts.cash_vouchers v
       JOIN accounts.cash_boxes cb ON cb.id = v.cash_box_id
       JOIN accounts.chart_of_accounts ca ON ca.id = v.counter_account_id
       LEFT JOIN accounts.chart_of_accounts ca_cash ON ca_cash.id = cb.account_id
       LEFT JOIN accounts.cost_centers cc ON cc.id = v.cost_center_id
       LEFT JOIN accounts.journal_entries je ON je.id = v.journal_entry_id
       LEFT JOIN accounts.journal_entries rje ON rje.id = v.reversal_journal_entry_id
       JOIN accounts.fiscal_years fy ON fy.id = v.fiscal_year_id
       JOIN accounts.fiscal_periods fp ON fp.id = v.fiscal_period_id
       LEFT JOIN student_affairs.users uc ON uc.id = v.created_by
       LEFT JOIN student_affairs.users up ON up.id = v.posted_by
       LEFT JOIN student_affairs.users uv ON uv.id = v.voided_by
       WHERE v.id = $1::uuid`,
      [id]
    );

    return jsonSuccess({
      data: {
        ...serializeCashVoucher(voucher),
        ...(meta.rows[0] ?? {}),
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
    const updated = await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const before = await loadCashVoucher(client, id);
      const after = await updateCashVoucher(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        counter_account_id: body.counter_account_id,
        cost_center_id: body.cost_center_id,
        voucher_date: body.voucher_date,
        amount: body.amount,
        party_name: body.party_name,
        party_reference: body.party_reference,
        external_reference: body.external_reference,
        description: body.description,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_voucher.updated',
        entityType: 'cash_voucher',
        entityId: after.id,
        oldValues: serializeCashVoucher(before),
        newValues: serializeCashVoucher(after),
        description: `تعديل السند ${after.voucher_number}`,
      });
      return after;
    });
    return jsonSuccess({ data: serializeCashVoucher(updated) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}

export async function DELETE(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    await withTransaction(async (client) => {
      await acquireCashBoxesLock(client);
      const before = await loadCashVoucher(client, id);
      await deleteDraftCashVoucher(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cash_voucher.deleted',
        entityType: 'cash_voucher',
        entityId: id,
        oldValues: serializeCashVoucher(before),
        description: `حذف مسودة السند ${before.voucher_number}`,
      });
    });
    return jsonSuccess({ data: { id, deleted: true } });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
