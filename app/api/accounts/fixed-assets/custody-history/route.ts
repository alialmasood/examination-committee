import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { listAssetCustodyHistory } from '@/src/lib/accounts/asset-movements';
import { FIXED_ASSETS_CAPABILITIES, assertFixedAssetsCapability } from '@/src/lib/accounts/fixed-assets-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertFixedAssetsCapability(null, auth.user.id, FIXED_ASSETS_CAPABILITIES.ASSET_VIEW);
    const assetId = request.nextUrl.searchParams.get('asset_id')?.trim();
    if (!assetId) throw new AccountsHttpError('معرّف الأصل (asset_id) مطلوب', 400);
    const rows = await withTransaction((client) => listAssetCustodyHistory(client, assetId));
    return jsonSuccess({ data: rows });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
