import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { loadAssetLocation, serializeAssetLocation, toggleAssetLocationStatus, updateAssetLocation } from '@/src/lib/accounts/asset-locations';
import { FIXED_ASSETS_CAPABILITIES, assertFixedAssetsCapability } from '@/src/lib/accounts/fixed-assets-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    await assertFixedAssetsCapability(null, auth.user.id, FIXED_ASSETS_CAPABILITIES.LOCATION_VIEW);
    const { id } = await context.params;
    const row = await withTransaction((client) => loadAssetLocation(client, id));
    return jsonSuccess({ data: serializeAssetLocation(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params; const body = await request.json();
    const isToggle = body.is_active !== undefined && Object.keys(body).every((k) => ['is_active', 'version', 'updated_at'].includes(k));
    const row = await withTransaction(async (client) => {
      await assertFixedAssetsCapability(client, auth.user.id, FIXED_ASSETS_CAPABILITIES.LOCATION_MANAGE);
      const before = await loadAssetLocation(client, id);
      const updated = isToggle
        ? await toggleAssetLocationStatus(client, { id, userId: auth.user.id, version: body.version, updated_at: body.updated_at, is_active: body.is_active })
        : await updateAssetLocation(client, { id, userId: auth.user.id, ...body });
      await writeFinancialAudit(client, { userId: auth.user.id, action: isToggle ? 'ASSET_LOCATION_STATUS_CHANGED' : 'ASSET_LOCATION_UPDATED', entityType: 'asset_location', entityId: id, oldValues: serializeAssetLocation(before), newValues: serializeAssetLocation(updated), description: `تعديل موقع أصل ${updated.code}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return updated;
    });
    return jsonSuccess({ data: serializeAssetLocation(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
