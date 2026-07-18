import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { createPayrollContract, listPayrollContracts, serializePayrollContract } from '@/src/lib/accounts/payroll-contracts';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW);
    const sp = request.nextUrl.searchParams;
    const result = await withTransaction((client) => listPayrollContracts(client, {
      payroll_person_id: sp.get('payroll_person_id')?.trim() || '',
      status: sp.get('status')?.trim() || '',
      compensation_basis: sp.get('compensation_basis')?.trim() || '',
      q: sp.get('q')?.trim() || '',
      page: Math.max(1, Number(sp.get('page') || 1)),
      page_size: Math.min(200, Math.max(1, Number(sp.get('page_size') || 50))),
    }));
    return jsonSuccess({
      data: result.rows.map(serializePayrollContract),
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
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.MANAGE_CONTRACTS);
      const contract = await createPayrollContract(client, { ...body, created_by: auth.user.id });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_contract.created', entityType: 'payroll_contract', entityId: contract.id, newValues: serializePayrollContract(contract), description: `إنشاء عقد رواتب ${contract.contract_number}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return contract;
    });
    return jsonSuccess({ data: serializePayrollContract(row) }, 201);
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
