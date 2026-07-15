import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { loadSupplier, serializeSupplier, updateSupplier } from '@/src/lib/accounts/suppliers';
import { findSupplierAccountBySupplierCurrency, getSupplierAccountBalance, serializeSupplierAccount } from '@/src/lib/accounts/supplier-accounts';
import { listSupplierInvoices, serializeSupplierInvoice } from '@/src/lib/accounts/supplier-invoices';
import { SUPPLIER_PAYABLES_CAPABILITIES, assertSupplierPayablesCapability } from '@/src/lib/accounts/supplier-payables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    await assertSupplierPayablesCapability(null, auth.user.id, SUPPLIER_PAYABLES_CAPABILITIES.VIEW);
    const { id } = await context.params;
    const data = await withTransaction(async (client) => {
      const supplier = await loadSupplier(client, id);
      const account = await findSupplierAccountBySupplierCurrency(client, id, supplier.currency_code);
      const invoices = await listSupplierInvoices(client, { supplier_id: id, page: 1, page_size: 20 });
      return { supplier, account, balance: account ? await getSupplierAccountBalance(client, account.id) : '0.000', invoices };
    });
    return jsonSuccess({ data: { ...serializeSupplier(data.supplier), account: data.account ? serializeSupplierAccount(data.account) : null, balance: data.balance, invoices: data.invoices.rows.map(serializeSupplierInvoice), invoices_pagination: { page: data.invoices.page, page_size: data.invoices.page_size, total: data.invoices.total, total_pages: Math.ceil(data.invoices.total / data.invoices.page_size) || 1 } } });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params; const body = await request.json();
    const row = await withTransaction(async (client) => {
      await assertSupplierPayablesCapability(client, auth.user.id, SUPPLIER_PAYABLES_CAPABILITIES.MANAGE);
      const before = await loadSupplier(client, id);
      const updated = await updateSupplier(client, { id, userId: auth.user.id, ...body });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'SUPPLIER_UPDATED', entityType: 'supplier', entityId: id, oldValues: serializeSupplier(before), newValues: serializeSupplier(updated), description: `تعديل المورد ${updated.supplier_number}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return updated;
    });
    return jsonSuccess({ data: serializeSupplier(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
