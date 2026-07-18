import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { createAssetDisposal, listAssetDisposals, serializeAssetDisposal } from '@/src/lib/accounts/asset-disposals';
import { FIXED_ASSETS_CAPABILITIES, assertFixedAssetsCapability } from '@/src/lib/accounts/fixed-assets-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertFixedAssetsCapability(null, auth.user.id, FIXED_ASSETS_CAPABILITIES.DISPOSAL_VIEW);
    const sp = request.nextUrl.searchParams;
    const result = await withTransaction((client) => listAssetDisposals(client, {
      fixed_asset_id: sp.get('fixed_asset_id'),
      status: sp.get('status'),
      page: Math.max(1, Number(sp.get('page') || 1)),
      page_size: Math.min(100, Math.max(1, Number(sp.get('page_size') || 20))),
    }));
    return jsonSuccess({
      data: result.rows.map(serializeAssetDisposal),
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
    const row = await withTransaction(async (client) => {
      await assertFixedAssetsCapability(client, auth.user.id, FIXED_ASSETS_CAPABILITIES.DISPOSAL_PREPARE);
      return createAssetDisposal(client, { ...body, created_by: auth.user.id });
    });
    return jsonSuccess({ data: serializeAssetDisposal(row) }, 201);
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
