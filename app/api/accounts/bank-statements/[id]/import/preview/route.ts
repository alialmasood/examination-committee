import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { previewBankStatementCsv } from '@/src/lib/accounts/bank-statement-csv';
import { assertCanAccessBankStatement } from '@/src/lib/accounts/bank-statements';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

/** الحد الأقصى لحجم نص CSV — يُفحص هنا (طبقة الـ route) قبل تمريره لدالة التحليل */
const MAX_CSV_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();
    const csvText = String(body.csv_text ?? '');

    if (!csvText.trim()) {
      return jsonError('محتوى CSV مطلوب', 400);
    }
    if (Buffer.byteLength(csvText, 'utf8') > MAX_CSV_BYTES) {
      return jsonError('حجم ملف CSV يتجاوز الحد الأقصى المسموح به (2 ميجابايت)', 400);
    }

    await withTransaction(async (client) => {
      try {
        await assertCanAccessBankStatement(client, {
          statementId: id,
          userId: auth.user.id,
        });
      } catch (e) {
        if (e instanceof AccountsHttpError && e.status === 403) {
          throw new AccountsHttpError('كشف الحساب المصرفي غير موجود', 404);
        }
        throw e;
      }
    });

    const preview = previewBankStatementCsv(csvText, body.mapping || {});

    return jsonSuccess({ data: preview });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
