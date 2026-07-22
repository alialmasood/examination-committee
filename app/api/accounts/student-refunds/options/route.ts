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
  assertStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { txQuery, withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertStudentReceivablesCapability(
      null,
      auth.user.id,
      STUDENT_RECEIVABLES_CAPABILITIES.REFUNDS_VIEW
    );

    const data = await withTransaction(async (client) => {
      const [cash, bank] = await Promise.all([
        txQuery<{ id: string; code: string; name_ar: string }>(
          client,
          `SELECT cb.id, cb.code, cb.name_ar
           FROM accounts.cash_boxes cb
           WHERE cb.status = 'ACTIVE'
           ORDER BY cb.code`
        ),
        txQuery<{ id: string; code: string; account_name_ar: string }>(
          client,
          `SELECT ba.id, ba.code, ba.account_name_ar
           FROM accounts.bank_accounts ba
           WHERE ba.status = 'ACTIVE'
           ORDER BY ba.code`
        ),
      ]);

      return {
        payment_methods: [
          { code: 'CASH', name_ar: 'نقداً' },
          { code: 'BANK', name_ar: 'بنكي' },
        ],
        statuses: [
          { code: 'DRAFT', name_ar: 'مسودة' },
          { code: 'PENDING_APPROVAL', name_ar: 'بانتظار الاعتماد' },
          { code: 'APPROVED', name_ar: 'معتمد' },
          { code: 'POSTED', name_ar: 'مرحّل' },
          { code: 'REJECTED', name_ar: 'مرفوض' },
          { code: 'VOID', name_ar: 'ملغى' },
        ],
        cash_boxes: cash.rows,
        bank_accounts: bank.rows,
      };
    });

    return jsonSuccess({ data });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
