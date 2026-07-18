import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { createFixedAsset, listFixedAssets, serializeFixedAsset } from '@/src/lib/accounts/fixed-assets';
import { FIXED_ASSETS_CAPABILITIES, assertFixedAssetsCapability } from '@/src/lib/accounts/fixed-assets-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertFixedAssetsCapability(null, auth.user.id, FIXED_ASSETS_CAPABILITIES.ASSET_VIEW);
    const sp = request.nextUrl.searchParams;
    const result = await withTransaction((client) => listFixedAssets(client, {
      q: sp.get('q')?.trim() || '',
      status: sp.get('status'),
      category_id: sp.get('category_id'),
      location_id: sp.get('location_id'),
      custodian_user_id: sp.get('custodian_user_id'),
      department_id: sp.get('department_id'),
      page: Math.max(1, Number(sp.get('page') || 1)),
      page_size: Math.min(100, Math.max(1, Number(sp.get('page_size') || 20))),
    }));
    return jsonSuccess({
      data: result.rows.map(serializeFixedAsset),
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
      await assertFixedAssetsCapability(client, auth.user.id, FIXED_ASSETS_CAPABILITIES.ASSET_PREPARE);
      const asset = await createFixedAsset(client, { ...body, created_by: auth.user.id });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'FIXED_ASSET_CREATED', entityType: 'fixed_asset', entityId: asset.id, newValues: serializeFixedAsset(asset), description: `إنشاء أصل ثابت ${asset.asset_number}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return asset;
    });
    return jsonSuccess({ data: serializeFixedAsset(row) }, 201);
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
