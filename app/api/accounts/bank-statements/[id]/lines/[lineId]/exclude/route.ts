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
  excludeBankStatementLine,
  serializeBankStatementLine,
  unexcludeBankStatementLine,
} from '@/src/lib/accounts/bank-statements';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string; lineId: string }> };

/** استبعاد سطر من المطابقة (مثل رسوم بنكية خارجة عن النطاق) */
export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { lineId } = await context.params;
    const body = await request.json().catch(() => ({}));

    const line = await withTransaction(async (client) => {
      const excluded = await excludeBankStatementLine(client, {
        lineId,
        userId: auth.user.id,
        reason: body.reason,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_statement.line_excluded',
        entityType: 'bank_statement_line',
        entityId: excluded.id,
        newValues: { reason: excluded.exclusion_reason },
        description: `استبعاد سطر #${excluded.line_number} من المطابقة`,
      });
      return excluded;
    });

    return jsonSuccess({ data: serializeBankStatementLine(line) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}

/** التراجع عن الاستبعاد وإعادة السطر إلى (غير مطابق) */
export async function DELETE(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { lineId } = await context.params;

    const line = await withTransaction(async (client) => {
      const restored = await unexcludeBankStatementLine(client, {
        lineId,
        userId: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_statement.line_unexcluded',
        entityType: 'bank_statement_line',
        entityId: restored.id,
        description: `التراجع عن استبعاد سطر #${restored.line_number}`,
      });
      return restored;
    });

    return jsonSuccess({ data: serializeBankStatementLine(line) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
