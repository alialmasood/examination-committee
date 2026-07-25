import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { endPayrollAssignment, serializePayrollAssignment } from '@/src/lib/accounts/payroll-assignments';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const row = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.MANAGE_ASSIGNMENTS);
      const ended = await endPayrollAssignment(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'payroll_assignment.ended',
        entityType: 'payroll_assignment',
        entityId: id,
        newValues: serializePayrollAssignment(ended),
        description: `إنهاء تكليف رواتب ${ended.assignment_code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return ended;
    });
    return jsonSuccess({ data: serializePayrollAssignment(row) });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
