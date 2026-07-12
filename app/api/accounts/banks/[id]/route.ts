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
  loadBank,
  serializeBank,
  updateBank,
} from '@/src/lib/accounts/banks';
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
      `SELECT b.*,
              (SELECT COUNT(*)::int FROM accounts.bank_branches br WHERE br.bank_id = b.id) AS branches_count,
              (SELECT COUNT(*)::int FROM accounts.bank_accounts ba WHERE ba.bank_id = b.id) AS accounts_count
       FROM accounts.banks b
       WHERE b.id = $1::uuid`,
      [id]
    );
    if (!detail.rows[0]) {
      return jsonError('المصرف غير موجود', 404);
    }
    const row = detail.rows[0];
    return jsonSuccess({
      data: {
        ...serializeBank(row as Parameters<typeof serializeBank>[0]),
        branches_count: row.branches_count ?? 0,
        accounts_count: row.accounts_count ?? 0,
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
      const before = await loadBank(client, id);
      const row = await updateBank(client, {
        id,
        userId: auth.user.id,
        version: body.version,
        updated_at: body.updated_at,
        name_ar: body.name_ar,
        name_en: body.name_en,
        short_name: body.short_name,
        swift_code: body.swift_code,
        country_code: body.country_code,
        phone: body.phone,
        email: body.email,
        website: body.website,
        notes: body.notes,
        is_active: body.is_active,
      });
      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'bank.updated',
        entityType: 'bank',
        entityId: row.id,
        oldValues: serializeBank(before),
        newValues: serializeBank(row),
        description: `تعديل مصرف ${row.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
      return row;
    });

    return jsonSuccess({ data: serializeBank(updated) });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
