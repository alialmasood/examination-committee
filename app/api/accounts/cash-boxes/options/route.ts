import { NextRequest } from 'next/server';
import {
  isAuthFailure,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { listEligibleCashAccounts } from '@/src/lib/accounts/cash-box-account';
import { CASH_BOX_TYPE_SEED } from '@/src/lib/accounts/cash-box-type-seed-data';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    // ضمان وجود الأنواع الثابتة في قاعدة البيانات
    for (const t of CASH_BOX_TYPE_SEED) {
      await query(
        `INSERT INTO accounts.cash_box_types
           (code, name_ar, name_en, description, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (code) DO UPDATE SET
           name_ar = EXCLUDED.name_ar,
           name_en = EXCLUDED.name_en,
           description = EXCLUDED.description,
           sort_order = EXCLUDED.sort_order,
           is_active = TRUE,
           updated_at = NOW()`,
        [t.code, t.name_ar, t.name_en, t.description, t.sort_order]
      );
    }

    const [types, accounts, users, statuses, postingAccounts] = await Promise.all([
      query(
        `SELECT code, name_ar, name_en, description, sort_order, is_active
         FROM accounts.cash_box_types
         WHERE is_active = TRUE
           AND code = ANY($1::text[])
         ORDER BY sort_order ASC, code ASC`,
        [CASH_BOX_TYPE_SEED.map((t) => t.code)]
      ),
      listEligibleCashAccounts(),
      query(
        `SELECT u.id, u.username, COALESCE(u.full_name, u.username) AS full_name
         FROM student_affairs.users u
         WHERE u.is_active = TRUE
         ORDER BY u.username ASC
         LIMIT 500`
      ),
      Promise.resolve([
        { code: 'DRAFT', name_ar: 'مسودة' },
        { code: 'ACTIVE', name_ar: 'نشط' },
        { code: 'SUSPENDED', name_ar: 'معلّق' },
        { code: 'CLOSED', name_ar: 'مغلق' },
      ]),
      query(
        `SELECT a.id, a.code, a.name_ar, t.code AS account_type_code
         FROM accounts.chart_of_accounts a
         JOIN accounts.account_types t ON t.id = a.account_type_id
         WHERE a.is_group = FALSE
           AND a.allow_posting = TRUE
           AND a.is_active = TRUE
         ORDER BY a.code ASC
         LIMIT 1000`
      ),
    ]);

    return jsonSuccess({
      data: {
        box_types: types.rows,
        eligible_accounts: accounts,
        posting_accounts: postingAccounts.rows,
        users: users.rows,
        statuses,
        custodian_roles: [
          { code: 'CUSTODIAN', name_ar: 'أمين صندوق' },
          { code: 'SUPERVISOR', name_ar: 'مراقب' },
        ],
      },
    });
  } catch (error) {
    return mapPgError(error);
  }
}
