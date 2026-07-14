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
  assertCanViewBankTransfer,
  calculateBankTransferImpact,
  deleteDraftBankTransfer,
  serializeBankTransfer,
  updateBankTransfer,
} from '@/src/lib/accounts/bank-transfers';
import { calculateBankAccountBookBalance } from '@/src/lib/accounts/bank-vouchers';
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
    const { transfer, sourceBalance, destBalance } = await withTransaction(
      async (client) => {
        const t = await assertCanViewBankTransfer(client, {
          transferId: id,
          userId: auth.user.id,
        });
        const sb = await calculateBankAccountBookBalance(
          client,
          t.source_bank_account_id
        );
        const db = await calculateBankAccountBookBalance(
          client,
          t.destination_bank_account_id
        );
        return { transfer: t, sourceBalance: sb, destBalance: db };
      }
    );

    const meta = await query(
      `SELECT
         src.code AS source_code, src.account_name_ar AS source_name_ar,
         src.account_number AS source_account_number,
         src.iban AS source_iban, src.iban_normalized AS source_iban_normalized,
         src.currency_code AS source_currency, src.status AS source_status,
         src.gl_account_id AS source_gl_account_id,
         dst.code AS destination_code, dst.account_name_ar AS destination_name_ar,
         dst.account_number AS destination_account_number,
         dst.iban AS destination_iban, dst.iban_normalized AS destination_iban_normalized,
         dst.currency_code AS destination_currency, dst.status AS destination_status,
         dst.gl_account_id AS destination_gl_account_id,
         sb.code AS source_bank_code, sb.name_ar AS source_bank_name_ar,
         sbr.code AS source_branch_code, sbr.name_ar AS source_branch_name_ar,
         db.code AS destination_bank_code, db.name_ar AS destination_bank_name_ar,
         dbr.code AS destination_branch_code, dbr.name_ar AS destination_branch_name_ar,
         sgl.code AS source_gl_code, sgl.name_ar AS source_gl_name_ar,
         dgl.code AS destination_gl_code, dgl.name_ar AS destination_gl_name_ar,
         fee.code AS fee_account_code, fee.name_ar AS fee_account_name_ar,
         cc.code AS cost_center_code, cc.name_ar AS cost_center_name_ar,
         je.entry_number AS journal_entry_number,
         rje.entry_number AS reversal_journal_entry_number,
         fy.code AS fiscal_year_code, fp.code AS fiscal_period_code,
         COALESCE(uc.full_name, uc.username) AS created_by_name,
         COALESCE(up.full_name, up.username) AS posted_by_name,
         COALESCE(uv.full_name, uv.username) AS voided_by_name
       FROM accounts.bank_transfers t
       JOIN accounts.bank_accounts src ON src.id = t.source_bank_account_id
       JOIN accounts.bank_accounts dst ON dst.id = t.destination_bank_account_id
       JOIN accounts.banks sb ON sb.id = src.bank_id
       JOIN accounts.banks db ON db.id = dst.bank_id
       LEFT JOIN accounts.bank_branches sbr ON sbr.id = src.bank_branch_id
       LEFT JOIN accounts.bank_branches dbr ON dbr.id = dst.bank_branch_id
       JOIN accounts.chart_of_accounts sgl ON sgl.id = src.gl_account_id
       JOIN accounts.chart_of_accounts dgl ON dgl.id = dst.gl_account_id
       LEFT JOIN accounts.chart_of_accounts fee ON fee.id = t.fee_expense_account_id
       LEFT JOIN accounts.cost_centers cc ON cc.id = t.cost_center_id
       LEFT JOIN accounts.journal_entries je ON je.id = t.journal_entry_id
       LEFT JOIN accounts.journal_entries rje ON rje.id = t.reversal_journal_entry_id
       JOIN accounts.fiscal_years fy ON fy.id = t.fiscal_year_id
       JOIN accounts.fiscal_periods fp ON fp.id = t.fiscal_period_id
       LEFT JOIN student_affairs.users uc ON uc.id = t.created_by
       LEFT JOIN student_affairs.users up ON up.id = t.posted_by
       LEFT JOIN student_affairs.users uv ON uv.id = t.voided_by
       WHERE t.id = $1::uuid`,
      [id]
    );

    const m = meta.rows[0] || {};
    const impact = calculateBankTransferImpact({
      amount: transfer.amount,
      fee_amount: transfer.fee_amount,
      currency_code: transfer.currency_code,
    });

    return jsonSuccess({
      data: {
        ...serializeBankTransfer(transfer),
        ...m,
        impact,
        source_book_balance: sourceBalance,
        destination_book_balance: destBalance,
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
    const transfer = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const before = await assertCanViewBankTransfer(client, {
        transferId: id,
        userId: auth.user.id,
      });
      const updated = await updateBankTransfer(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        ...body,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_transfer.updated',
        entityType: 'bank_transfer',
        entityId: updated.id,
        oldValues: serializeBankTransfer(before),
        newValues: serializeBankTransfer(updated),
        description: `تعديل تحويل مصرفي ${updated.transfer_number}`,
      });
      return updated;
    });
    return jsonSuccess({ data: serializeBankTransfer(transfer) });
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
      await deleteDraftBankTransfer(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_transfer.deleted',
        entityType: 'bank_transfer',
        entityId: id,
        description: 'حذف مسودة تحويل مصرفي',
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
