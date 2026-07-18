import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { activateFixedAsset, serializeFixedAsset } from '@/src/lib/accounts/fixed-assets';
import { FIXED_ASSETS_CAPABILITIES, assertFixedAssetsCapability, hasFixedAssetsCapability } from '@/src/lib/accounts/fixed-assets-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const row = await withTransaction(async (client) => {
      await assertFixedAssetsCapability(client, auth.user.id, FIXED_ASSETS_CAPABILITIES.ASSET_ACTIVATE);
      const hasOverrideCapability = await hasFixedAssetsCapability(client, auth.user.id, FIXED_ASSETS_CAPABILITIES.ASSET_THRESHOLD_OVERRIDE);
      return activateFixedAsset(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        override_capitalization_threshold: Boolean(body.override_capitalization_threshold),
        override_threshold_reason: body.override_threshold_reason,
        hasOverrideCapability,
        opening_equity_gl_account_id: body.opening_equity_gl_account_id,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
    });
    return jsonSuccess({ data: serializeFixedAsset(row) });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
