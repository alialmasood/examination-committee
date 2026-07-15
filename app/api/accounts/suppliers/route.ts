import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { createSupplier, listSuppliers, serializeSupplier } from '@/src/lib/accounts/suppliers';
import { createSupplierAccount, serializeSupplierAccount } from '@/src/lib/accounts/supplier-accounts';
import { SUPPLIER_PAYABLES_CAPABILITIES, assertSupplierPayablesCapability } from '@/src/lib/accounts/supplier-payables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertSupplierPayablesCapability(null, auth.user.id, SUPPLIER_PAYABLES_CAPABILITIES.VIEW);
    const sp = request.nextUrl.searchParams;
    const result = await withTransaction((client) => listSuppliers(client, {
      q: sp.get('q')?.trim() || '',
      status: sp.get('status'), supplier_type: sp.get('supplier_type'),
      has_balance: sp.get('has_balance'), balance_min: sp.get('balance_min'), balance_max: sp.get('balance_max'),
      page: Math.max(1, Number(sp.get('page') || 1)),
      page_size: Math.min(100, Math.max(1, Number(sp.get('page_size') || 20))),
    }));
    return jsonSuccess({
      data: result.rows.map((r) => ({
        ...serializeSupplier(r),
        balance: r.balance ?? '0.000',
        last_entry_date: r.last_entry_date ?? null,
        account_id: r.account_id ?? null,
        account_number: r.account_number ?? null,
        payable_gl_code: r.payable_gl_code ?? null,
      })),
      pagination: {
        page: result.page,
        page_size: result.page_size,
        total: result.total,
        total_pages: Math.ceil(result.total / result.page_size) || 1,
      },
    });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    const body = await request.json();
    const result = await withTransaction(async (client) => {
      await assertSupplierPayablesCapability(client, auth.user.id, SUPPLIER_PAYABLES_CAPABILITIES.MANAGE);
      const supplier = await createSupplier(client, { ...body, created_by: auth.user.id });
      const payableGl = body.payable_gl_account_id ?? body.account?.payable_gl_account_id;
      const account = payableGl ? await createSupplierAccount(client, {
        supplier_id: supplier.id, payable_gl_account_id: payableGl,
        currency_code: body.currency_code, opening_reference: body.account?.opening_reference,
        notes: body.account?.notes, created_by: auth.user.id,
      }) : null;
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'SUPPLIER_CREATED', entityType: 'supplier', entityId: supplier.id, newValues: serializeSupplier(supplier), description: `إنشاء المورد ${supplier.supplier_number}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return { supplier, account };
    });
    return jsonSuccess({ data: serializeSupplier(result.supplier), account: result.account ? serializeSupplierAccount(result.account) : null }, 201);
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
