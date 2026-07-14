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
  deleteBankStatementLine,
  loadBankStatementLine,
  serializeBankStatementLine,
  updateBankStatementLine,
} from '@/src/lib/accounts/bank-statements';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string; lineId: string }> };

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { lineId } = await context.params;
    const body = await request.json();

    const line = await withTransaction(async (client) => {
      const before = await loadBankStatementLine(client, lineId);
      const updated = await updateBankStatementLine(client, {
        ...body,
        lineId,
        userId: auth.user.id,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_statement.line_updated',
        entityType: 'bank_statement_line',
        entityId: updated.id,
        oldValues: serializeBankStatementLine(before),
        newValues: serializeBankStatementLine(updated),
        description: `تعديل سطر #${updated.line_number} من كشف حساب مصرفي`,
      });
      return updated;
    });

    return jsonSuccess({ data: serializeBankStatementLine(line) });
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
    const { lineId } = await context.params;

    await withTransaction(async (client) => {
      const before = await loadBankStatementLine(client, lineId);
      await deleteBankStatementLine(client, { lineId, userId: auth.user.id });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_statement.line_deleted',
        entityType: 'bank_statement_line',
        entityId: lineId,
        oldValues: serializeBankStatementLine(before),
        description: `حذف سطر #${before.line_number} من كشف حساب مصرفي`,
      });
    });

    return jsonSuccess({ data: { id: lineId, deleted: true } });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
