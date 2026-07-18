import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { listDepreciationRunLines, recalculateDepreciationRun, serializeDepreciationRun } from '@/src/lib/accounts/asset-depreciation';
import { FIXED_ASSETS_CAPABILITIES, assertFixedAssetsCapability } from '@/src/lib/accounts/fixed-assets-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

/**
 * إعادة احتساب دورة إهلاك DRAFT: يحذف سطورها السابقة ويعيد بناءها للأصول المؤهّلة
 * في الفترة، ثم يعيد حساب الإجمالي. يُمنع بعد POST/VOID. صلاحية: asset_depreciation.calculate
 * (تُطبَّق عبر DEP_PREPARE في نموذج الصلاحيات الحالي).
 */
export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request); if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const data = await withTransaction(async (client) => {
      await assertFixedAssetsCapability(client, auth.user.id, FIXED_ASSETS_CAPABILITIES.DEP_PREPARE);
      const { run } = await recalculateDepreciationRun(client, {
        id,
        userId: auth.user.id,
        version: body?.version,
        updated_at: body?.updated_at,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      const lines = await listDepreciationRunLines(client, id);
      return { run, lines };
    });
    return jsonSuccess({ data: { ...serializeDepreciationRun(data.run), lines: data.lines } });
  } catch (error) { return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error); }
}
