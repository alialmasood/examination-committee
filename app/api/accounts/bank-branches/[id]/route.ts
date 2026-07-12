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
import {
  loadBankBranch,
  serializeBankBranch,
  updateBankBranch,
} from '@/src/lib/accounts/bank-branches';
import {
  acquireBanksLock,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const detail = await query(
      `SELECT br.*,
              b.code AS bank_code,
              b.name_ar AS bank_name_ar
       FROM accounts.bank_branches br
       JOIN accounts.banks b ON b.id = br.bank_id
       WHERE br.id = $1::uuid`,
      [id]
    );
    if (!detail.rows[0]) {
      return jsonError('فرع المصرف غير موجود', 404);
    }
    const row = detail.rows[0];
    return jsonSuccess({
      data: {
        ...serializeBankBranch(row as Parameters<typeof serializeBankBranch>[0]),
        bank_code: row.bank_code ?? null,
        bank_name_ar: row.bank_name_ar ?? null,
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const updated = await withTransaction(async (client) => {
      await acquireBanksLock(client);
      const before = await loadBankBranch(client, id);
      const row = await updateBankBranch(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        name_ar: body.name_ar,
        name_en: body.name_en,
        city: body.city,
        address: body.address,
        phone: body.phone,
        branch_swift_code: body.branch_swift_code,
        notes: body.notes,
        is_active: body.is_active,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank_branch.updated',
        entityType: 'bank_branch',
        entityId: row.id,
        oldValues: serializeBankBranch(before),
        newValues: serializeBankBranch(row),
        description: `تعديل فرع مصرف ${row.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeBankBranch(updated) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
