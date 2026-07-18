import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { loadAssetDisposal, serializeAssetDisposal } from '@/src/lib/accounts/asset-disposals';
import { FIXED_ASSETS_CAPABILITIES, assertFixedAssetsCapability } from '@/src/lib/accounts/fixed-assets-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

// سجلات الاستبعاد لا تدعم التعديل بعد الإنشاء (لا توجد دالة تحديث في الخدمة) — GET فقط.
export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    await assertFixedAssetsCapability(null, auth.user.id, FIXED_ASSETS_CAPABILITIES.DISPOSAL_VIEW);
    const { id } = await context.params;
    const row = await withTransaction((client) => loadAssetDisposal(client, id));
    return jsonSuccess({ data: serializeAssetDisposal(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
