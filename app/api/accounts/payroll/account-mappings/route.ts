import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { createPayrollAccountMapping, listPayrollAccountMappings, serializePayrollAccountMapping } from '@/src/lib/accounts/payroll-account-mappings';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW);
    const sp = request.nextUrl.searchParams;
    const result = await withTransaction((client) => listPayrollAccountMappings(client, {
      q: sp.get('q')?.trim() || '',
      mapping_scope: sp.get('mapping_scope')?.trim() || '',
      active_only: sp.get('active_only') === 'true',
      page: Math.max(1, Number(sp.get('page') || 1)),
      page_size: Math.min(200, Math.max(1, Number(sp.get('page_size') || 50))),
    }));
    return jsonSuccess({
      data: result.rows.map(serializePayrollAccountMapping),
      pagination: { page: result.page, page_size: result.page_size, total: result.total, total_pages: Math.ceil(result.total / result.page_size) || 1 },
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
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.MANAGE_MAPPINGS);
      const item = await createPayrollAccountMapping(client, { ...body, created_by: auth.user.id });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_account_mapping.created', entityType: 'payroll_account_mapping', entityId: item.id, newValues: serializePayrollAccountMapping(item), description: `إنشاء ربط حسابات رواتب ${item.mapping_code}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return item;
    });
    return jsonSuccess({ data: serializePayrollAccountMapping(row) }, 201);
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
