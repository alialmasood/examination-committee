import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { createAssetsFromPurchasing, listCapitalizationCandidates } from '@/src/lib/accounts/fixed-assets-from-purchasing';
import { FIXED_ASSETS_CAPABILITIES, assertFixedAssetsCapability } from '@/src/lib/accounts/fixed-assets-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertFixedAssetsCapability(null, auth.user.id, FIXED_ASSETS_CAPABILITIES.ASSET_VIEW);
    const sp = request.nextUrl.searchParams;
    const result = await withTransaction((client) => listCapitalizationCandidates(client, {
      supplier_id: sp.get('supplier_id') || undefined,
      supplier_invoice_id: sp.get('supplier_invoice_id') || undefined,
      asset_category_id: sp.get('asset_category_id') || undefined,
      purchase_order_id: sp.get('purchase_order_id') || undefined,
      page: Math.max(1, Number(sp.get('page') || 1)),
      page_size: Math.min(100, Math.max(1, Number(sp.get('page_size') || 50))),
    }));
    return jsonSuccess({
      data: result.rows,
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
      await assertFixedAssetsCapability(client, auth.user.id, FIXED_ASSETS_CAPABILITIES.ASSET_CAPITALIZE);
      return createAssetsFromPurchasing(client, {
        supplier_invoice_line_id:
          body.supplier_invoice_line_id ?? body.invoice_line_id ?? body.candidate_id,
        quantity: body.quantity ?? body.units,
        category_id: body.category_id,
        name_ar: body.name_ar,
        location_id: body.location_id,
        custodian_user_id: body.custodian_user_id,
        department_id: body.department_id,
        available_for_use_date: body.available_for_use_date,
        useful_life_months: body.useful_life_months,
        created_by: auth.user.id,
        userId: auth.user.id,
      });
    });
    return jsonSuccess({ data: result }, 201);
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
