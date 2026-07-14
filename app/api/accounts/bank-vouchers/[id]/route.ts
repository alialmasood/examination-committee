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
  assertCanViewBankVoucher,
  calculateBankAccountBookBalance,
  deleteDraftBankVoucher,
  loadBankVoucher,
  serializeBankVoucher,
  updateBankVoucher,
} from '@/src/lib/accounts/bank-vouchers';
import {
  acquireBanksLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const { voucher, bookBalance } = await withTransaction(async (client) => {
      const v = await assertCanViewBankVoucher(client, {
        voucherId: id,
        userId: auth.user.id,
      });
      const balance = await calculateBankAccountBookBalance(
        client,
        v.bank_account_id
      );
      return { voucher: v, bookBalance: balance };
    });

    const meta = await query(
      `SELECT ba.code AS bank_account_code,
              ba.account_name_ar AS bank_account_name_ar,
              ba.account_number AS bank_account_number,
              ba.iban AS bank_account_iban,
              ba.iban_normalized AS bank_account_iban_normalized,
              ba.currency_code AS bank_account_currency,
              ba.gl_account_id,
              ba.status AS bank_account_status,
              b.id AS bank_id,
              b.code AS bank_code,
              b.name_ar AS bank_name_ar,
              br.code AS branch_code,
              br.name_ar AS branch_name_ar,
              gl.code AS gl_account_code,
              gl.name_ar AS gl_account_name_ar,
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
       FROM accounts.bank_vouchers v
       JOIN accounts.bank_accounts ba ON ba.id = v.bank_account_id
       JOIN accounts.banks b ON b.id = ba.bank_id
       LEFT JOIN accounts.bank_branches br ON br.id = ba.bank_branch_id
       JOIN accounts.chart_of_accounts gl ON gl.id = ba.gl_account_id
       JOIN accounts.chart_of_accounts ca ON ca.id = v.counter_account_id
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
        ...serializeBankVoucher(voucher),
        ...(meta.rows[0] ?? {}),
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

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();
    const updated = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const before = await loadBankVoucher(client, id);
      const after = await updateBankVoucher(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        voucher_type: body.voucher_type,
        bank_account_id: body.bank_account_id,
        counter_account_id: body.counter_account_id,
        cost_center_id: body.cost_center_id,
        voucher_date: body.voucher_date,
        value_date: body.value_date,
        amount: body.amount,
        party_name: body.party_name,
        party_reference: body.party_reference,
        external_reference: body.external_reference,
        bank_reference: body.bank_reference,
        description: body.description,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_voucher.updated',
        entityType: 'bank_voucher',
        entityId: after.id,
        oldValues: serializeBankVoucher(before),
        newValues: serializeBankVoucher(after),
        description: `تعديل السند المصرفي ${after.voucher_number}`,
      });
      return after;
    });
    return jsonSuccess({ data: serializeBankVoucher(updated) });
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
      await acquireBanksLock(client);
      const before = await loadBankVoucher(client, id);
      await deleteDraftBankVoucher(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_voucher.deleted',
        entityType: 'bank_voucher',
        entityId: id,
        oldValues: serializeBankVoucher(before),
        description: `حذف مسودة السند المصرفي ${before.voucher_number}`,
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
