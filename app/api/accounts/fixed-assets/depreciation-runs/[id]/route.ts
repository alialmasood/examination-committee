import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { listDepreciationRunLines, loadDepreciationRun, serializeDepreciationRun } from '@/src/lib/accounts/asset-depreciation';
import { FIXED_ASSETS_CAPABILITIES, assertFixedAssetsCapability } from '@/src/lib/accounts/fixed-assets-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    await assertFixedAssetsCapability(null, auth.user.id, FIXED_ASSETS_CAPABILITIES.DEP_VIEW);
    const { id } = await context.params;
    const data = await withTransaction(async (client) => {
      const run = await loadDepreciationRun(client, id);
      const lines = await listDepreciationRunLines(client, id);
      return { run, lines };
    });
    return jsonSuccess({ data: { ...serializeDepreciationRun(data.run), lines: data.lines } });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
