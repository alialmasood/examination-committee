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
  closeSupplierAccount,
  loadSupplierAccount,
  serializeSupplierAccount,
} from '@/src/lib/accounts/supplier-accounts';
import {
  SUPPLIER_PAYABLES_CAPABILITIES,
  assertSupplierPayablesCapability,
} from '@/src/lib/accounts/supplier-payables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    const closed = await withTransaction(async (client) => {
      await assertSupplierPayablesCapability(
        client,
        auth.user.id,
        SUPPLIER_PAYABLES_CAPABILITIES.CLOSE
      );
      const before = await loadSupplierAccount(client, id);
      const row = await closeSupplierAccount(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'SUPPLIER_ACCOUNT_CLOSED',
        entityType: 'supplier_account',
        entityId: row.id,
        oldValues: serializeSupplierAccount(before),
        newValues: serializeSupplierAccount(row),
        description: `إغلاق الحساب المالي للمورد ${row.account_number}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeSupplierAccount(closed) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
