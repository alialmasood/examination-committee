import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { postAssetDisposal, serializeAssetDisposal } from '@/src/lib/accounts/asset-disposals';
import { FIXED_ASSETS_CAPABILITIES, assertFixedAssetsCapability } from '@/src/lib/accounts/fixed-assets-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const row = await withTransaction(async (client) => {
      await assertFixedAssetsCapability(client, auth.user.id, FIXED_ASSETS_CAPABILITIES.DISPOSAL_POST);
      return postAssetDisposal(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
    });
    return jsonSuccess({ data: serializeAssetDisposal(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
