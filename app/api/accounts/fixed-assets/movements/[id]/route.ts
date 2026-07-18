import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { loadAssetMovement, serializeAssetMovement } from '@/src/lib/accounts/asset-movements';
import { FIXED_ASSETS_CAPABILITIES, assertFixedAssetsCapability } from '@/src/lib/accounts/fixed-assets-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

// حركات الأصول لا تدعم التعديل بعد الإنشاء (لا توجد دالة تحديث في الخدمة) — GET فقط.
export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    await assertFixedAssetsCapability(null, auth.user.id, FIXED_ASSETS_CAPABILITIES.MOVEMENT_VIEW);
    const { id } = await context.params;
    const row = await withTransaction((client) => loadAssetMovement(client, id));
    return jsonSuccess({ data: serializeAssetMovement(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
