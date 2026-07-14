import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { sqlUserCanReconcileBankAccount } from '@/src/lib/accounts/bank-account-access';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const bankAccounts = await query(
      `SELECT ba.id, ba.code, ba.account_name_ar, ba.bank_id, ba.bank_branch_id,
              ba.currency_code, ba.account_type, ba.gl_account_id, ba.status,
              b.code AS bank_code, b.name_ar AS bank_name_ar,
              br.code AS branch_code, br.name_ar AS branch_name_ar,
              gl.code AS gl_account_code, gl.name_ar AS gl_account_name_ar
       FROM accounts.bank_accounts ba
       JOIN accounts.banks b ON b.id = ba.bank_id AND b.is_active = TRUE
       LEFT JOIN accounts.bank_branches br ON br.id = ba.bank_branch_id
       JOIN accounts.chart_of_accounts gl ON gl.id = ba.gl_account_id
       WHERE ba.status = 'ACTIVE'
         AND ${sqlUserCanReconcileBankAccount('$1', 'ba.id')}
       ORDER BY ba.code ASC
       LIMIT 500`,
      [auth.user.id]
    );

    const adjustmentAccounts = await query(
      `SELECT a.id, a.code, a.name_ar, t.code AS account_type_code, a.requires_cost_center
       FROM accounts.chart_of_accounts a
       JOIN accounts.account_types t ON t.id = a.account_type_id
       WHERE NOT a.is_group AND a.allow_posting AND a.is_active
         AND NOT EXISTS (
           SELECT 1 FROM accounts.bank_accounts ba WHERE ba.gl_account_id = a.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM accounts.cash_boxes cb WHERE cb.gl_account_id = a.id
         )
       ORDER BY a.code
       LIMIT 500`
    );

    const costCenters = await query(
      `SELECT id, code, name_ar FROM accounts.cost_centers
       WHERE is_active AND NOT is_group
       ORDER BY code LIMIT 200`
    );

    const banks = await query(
      `SELECT id, code, name_ar, short_name, is_active
       FROM accounts.banks
       WHERE is_active = TRUE
       ORDER BY code ASC`
    );

    return jsonSuccess({
      data: {
        bank_accounts: bankAccounts.rows,
        adjustment_accounts: adjustmentAccounts.rows,
        cost_centers: costCenters.rows,
        banks: banks.rows,
        statuses: [
          { code: 'DRAFT', name_ar: 'مسودة' },
          { code: 'IN_PROGRESS', name_ar: 'قيد المعالجة' },
          { code: 'RECONCILED', name_ar: 'مُسوّى' },
          { code: 'CLOSED', name_ar: 'مغلق' },
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
