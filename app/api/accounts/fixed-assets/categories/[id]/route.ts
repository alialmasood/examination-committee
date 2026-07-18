import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { loadAssetCategory, serializeAssetCategory, toggleAssetCategoryStatus, updateAssetCategory } from '@/src/lib/accounts/asset-categories';
import { FIXED_ASSETS_CAPABILITIES, assertFixedAssetsCapability } from '@/src/lib/accounts/fixed-assets-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    await assertFixedAssetsCapability(null, auth.user.id, FIXED_ASSETS_CAPABILITIES.CATEGORY_VIEW);
    const { id } = await context.params;
    const row = await withTransaction((client) => loadAssetCategory(client, id));
    return jsonSuccess({ data: serializeAssetCategory(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params; const body = await request.json();
    const isToggle = body.is_active !== undefined && Object.keys(body).every((k) => ['is_active', 'version', 'updated_at'].includes(k));
    const row = await withTransaction(async (client) => {
      await assertFixedAssetsCapability(client, auth.user.id, FIXED_ASSETS_CAPABILITIES.CATEGORY_MANAGE);
      const before = await loadAssetCategory(client, id);
      const updated = isToggle
        ? await toggleAssetCategoryStatus(client, { id, userId: auth.user.id, version: body.version, updated_at: body.updated_at, is_active: body.is_active })
        : await updateAssetCategory(client, { id, userId: auth.user.id, ...body });
      await writeFinancialAudit(client, { userId: auth.user.id, action: isToggle ? 'ASSET_CATEGORY_STATUS_CHANGED' : 'ASSET_CATEGORY_UPDATED', entityType: 'asset_category', entityId: id, oldValues: serializeAssetCategory(before), newValues: serializeAssetCategory(updated), description: `تعديل تصنيف أصل ${updated.code}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return updated;
    });
    return jsonSuccess({ data: serializeAssetCategory(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
