import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { createAssetLocation, listAssetLocations, serializeAssetLocation } from '@/src/lib/accounts/asset-locations';
import { FIXED_ASSETS_CAPABILITIES, assertFixedAssetsCapability } from '@/src/lib/accounts/fixed-assets-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertFixedAssetsCapability(null, auth.user.id, FIXED_ASSETS_CAPABILITIES.LOCATION_VIEW);
    const sp = request.nextUrl.searchParams;
    const result = await withTransaction((client) => listAssetLocations(client, {
      q: sp.get('q')?.trim() || '',
      active_only: sp.get('active_only') === 'true',
      page: Math.max(1, Number(sp.get('page') || 1)),
      page_size: Math.min(200, Math.max(1, Number(sp.get('page_size') || 50))),
    }));
    return jsonSuccess({
      data: result.rows.map(serializeAssetLocation),
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
      await assertFixedAssetsCapability(client, auth.user.id, FIXED_ASSETS_CAPABILITIES.LOCATION_MANAGE);
      const location = await createAssetLocation(client, { ...body, created_by: auth.user.id });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'ASSET_LOCATION_CREATED', entityType: 'asset_location', entityId: location.id, newValues: serializeAssetLocation(location), description: `إنشاء موقع أصل ${location.code}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return location;
    });
    return jsonSuccess({ data: serializeAssetLocation(row) }, 201);
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
