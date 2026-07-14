import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  hasStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { query } from '@/src/lib/db';

async function assertBillingReadAccess(
  client: null,
  userId: string
): Promise<void> {
  const canView =
    (await hasStudentReceivablesCapability(
      client,
      userId,
      STUDENT_RECEIVABLES_CAPABILITIES.VIEW
    )) ||
    (await hasStudentReceivablesCapability(
      client,
      userId,
      STUDENT_RECEIVABLES_CAPABILITIES.BILLING_VIEW
    ));
  if (!canView) {
    throw new AccountsHttpError(
      `ليس لديك صلاحية العملية المطلوبة (${STUDENT_RECEIVABLES_CAPABILITIES.BILLING_VIEW})`,
      403
    );
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertBillingReadAccess(null, auth.user.id);

    const cashBoxId = request.nextUrl.searchParams.get('cash_box_id');

    const [openSessions, bankAccounts, cashBoxes] = await Promise.all([
      query(
        `SELECT s.id, s.cash_box_id, s.session_date::text AS session_date, s.status,
                s.fiscal_year_id, s.fiscal_period_id,
                cb.code AS cash_box_code, cb.name_ar AS cash_box_name_ar
         FROM accounts.cash_box_sessions s
         JOIN accounts.cash_boxes cb ON cb.id = s.cash_box_id
         WHERE s.status = 'OPEN'
           AND cb.status = 'ACTIVE'
           AND ($1::uuid IS NULL OR s.cash_box_id = $1::uuid)
         ORDER BY s.session_date DESC, cb.code ASC`,
        [cashBoxId || null]
      ),
      query(
        `SELECT ba.id, ba.code, ba.account_name_ar, ba.bank_id, ba.bank_branch_id,
                ba.currency_code, ba.allows_receipts, ba.allows_payments,
                ba.is_primary, ba.status,
                b.code AS bank_code, b.name_ar AS bank_name_ar
         FROM accounts.bank_accounts ba
         JOIN accounts.banks b ON b.id = ba.bank_id AND b.is_active = TRUE
         WHERE ba.status = 'ACTIVE'
           AND ba.allows_receipts = TRUE
         ORDER BY ba.code ASC
         LIMIT 500`
      ),
      query(
        `SELECT cb.id, cb.code, cb.name_ar, cb.status, cb.currency_code
         FROM accounts.cash_boxes cb
         WHERE cb.status = 'ACTIVE'
         ORDER BY cb.code ASC`
      ),
    ]);

    return jsonSuccess({
      data: {
        cash_boxes: cashBoxes.rows,
        open_sessions: openSessions.rows,
        bank_accounts: bankAccounts.rows,
        payment_methods: [
          { code: 'CASH', name_ar: 'نقدي' },
          { code: 'BANK', name_ar: 'مصرفي' },
        ],
        collection_statuses: [
          { code: 'DRAFT', name_ar: 'مسودة' },
          { code: 'POSTED', name_ar: 'مرحّل' },
          { code: 'VOID', name_ar: 'ملغى' },
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
