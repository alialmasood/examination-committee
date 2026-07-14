import { NextRequest } from 'next/server';
import {
  isAuthFailure,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { listEligibleBankGlAccounts } from '@/src/lib/accounts/bank-accounts';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const sp = request.nextUrl.searchParams;
    const bankId = sp.get('bank_id');
    const excludeBankAccountId = sp.get('exclude_bank_account_id');

    const [banks, branches, users, eligibleGl, operationalAccounts] =
      await Promise.all([
        query(
          `SELECT id, code, name_ar, short_name, is_active
           FROM accounts.banks
           WHERE is_active = TRUE
           ORDER BY code ASC`
        ),
        query(
          `SELECT id, bank_id, code, name_ar, city, is_active
           FROM accounts.bank_branches
           WHERE is_active = TRUE
             AND ($1::uuid IS NULL OR bank_id = $1::uuid)
           ORDER BY code ASC`,
          [bankId || null]
        ),
        query(
          `SELECT u.id, u.username, COALESCE(u.full_name, u.username) AS full_name
           FROM student_affairs.users u
           WHERE u.is_active = TRUE
           ORDER BY u.username ASC
           LIMIT 500`
        ),
        withTransaction((client) =>
          listEligibleBankGlAccounts(client, excludeBankAccountId)
        ),
        // للعمليات المالية المستقبلية: ACTIVE فقط (لا SUSPENDED ولا CLOSED)
        query(
          `SELECT ba.id, ba.code, ba.account_name_ar, ba.bank_id, ba.bank_branch_id,
                  ba.currency_code, ba.account_type, ba.gl_account_id,
                  ba.allows_receipts, ba.allows_payments, ba.allows_transfers,
                  ba.allows_cheques, ba.is_primary, ba.status
           FROM accounts.bank_accounts ba
           JOIN accounts.banks b ON b.id = ba.bank_id AND b.is_active = TRUE
           WHERE ba.status = 'ACTIVE'
             AND ($1::uuid IS NULL OR ba.bank_id = $1::uuid)
           ORDER BY ba.code ASC
           LIMIT 500`,
          [bankId || null]
        ),
      ]);

    return jsonSuccess({
      data: {
        banks: banks.rows,
        branches: branches.rows,
        operational_bank_accounts: operationalAccounts.rows,
        eligible_gl_accounts: eligibleGl,
        users: users.rows,
        account_types: [
          { code: 'CURRENT', name_ar: 'جاري' },
          { code: 'SAVINGS', name_ar: 'توفير' },
          { code: 'DEPOSIT', name_ar: 'وديعة' },
          { code: 'ESCROW', name_ar: 'أمانات' },
          { code: 'OTHER', name_ar: 'أخرى' },
        ],
        statuses: [
          { code: 'ACTIVE', name_ar: 'نشط' },
          { code: 'SUSPENDED', name_ar: 'معلّق' },
          { code: 'CLOSED', name_ar: 'مغلق' },
        ],
        currencies: ['IQD', 'USD'],
      },
    });
  } catch (error) {
    return mapPgError(error);
  }
}
