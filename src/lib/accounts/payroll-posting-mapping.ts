/**
 * حل خرائط GL لترحيل الرواتب 9.C.1 — Hybrid على 094 بلا جدول جديد.
 * المبالغ من Snapshot فقط؛ الحسابات من Component / mappings.
 */
import { AccountsHttpError } from './auth';
import { assertPostingAccount } from './posting-account';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type ResolvedPostingAccounts = {
  expenseAccountId: string | null;
  liabilityAccountId: string | null;
  payableAccountId: string | null;
  roundingAccountId: string | null;
  accountIds: string[];
};

async function activeMapping(
  client: TxClient,
  opts: {
    scope: string;
    componentId?: string | null;
    calendarId?: string | null;
    asOf: string;
  }
) {
  return txQuery<{
    expense_account_id: string | null;
    liability_account_id: string | null;
    payable_account_id: string | null;
    rounding_account_id: string | null;
  }>(
    client,
    `SELECT expense_account_id::text, liability_account_id::text,
            payable_account_id::text, rounding_account_id::text
     FROM accounts.payroll_account_mappings
     WHERE is_active = TRUE
       AND mapping_scope = $1
       AND ($2::uuid IS NULL OR payroll_component_id = $2::uuid)
       AND ($3::uuid IS NULL OR payroll_calendar_id = $3::uuid OR payroll_calendar_id IS NULL)
       AND effective_from <= $4::date
       AND (effective_to IS NULL OR effective_to >= $4::date)
     ORDER BY priority ASC, created_at ASC
     LIMIT 1`,
    [opts.scope, opts.componentId ?? null, opts.calendarId ?? null, opts.asOf]
  );
}

export async function resolveComponentGlAccounts(
  client: TxClient,
  componentId: string,
  calendarId: string | null,
  asOf: string
): Promise<{ expenseId: string | null; liabilityId: string | null }> {
  const comp = await txQuery<{
    expense_account_id: string | null;
    liability_account_id: string | null;
  }>(
    client,
    `SELECT expense_account_id::text, liability_account_id::text
     FROM accounts.payroll_components WHERE id=$1::uuid`,
    [componentId]
  );
  if (!comp.rows[0]) {
    throw new AccountsHttpError('مكوّن الرواتب المرتبط باللقطة غير موجود', 422);
  }
  let expenseId = comp.rows[0].expense_account_id;
  let liabilityId = comp.rows[0].liability_account_id;

  const mapComp = await activeMapping(client, {
    scope: 'COMPONENT',
    componentId,
    calendarId,
    asOf,
  });
  if (mapComp.rows[0]) {
    expenseId = mapComp.rows[0].expense_account_id || expenseId;
    liabilityId = mapComp.rows[0].liability_account_id || liabilityId;
  }

  return { expenseId, liabilityId };
}

export async function resolveDefaultPayableAndRounding(
  client: TxClient,
  calendarId: string | null,
  asOf: string
): Promise<{ payableId: string; roundingId: string | null }> {
  const def = await activeMapping(client, {
    scope: 'DEFAULT',
    calendarId,
    asOf,
  });
  const payableId = def.rows[0]?.payable_account_id ?? null;
  if (!payableId) {
    throw new AccountsHttpError(
      'تعذر ترحيل الرواتب: حساب صافي الرواتب المستحقة (payable) غير معرّف في خريطة DEFAULT',
      422
    );
  }
  await assertPostingAccount(client, payableId, 'حساب صافي الرواتب المستحقة', {
    invalidStatusCode: 422,
  });

  const roundMap = await activeMapping(client, {
    scope: 'ROUNDING',
    calendarId,
    asOf,
  });
  const roundingId =
    roundMap.rows[0]?.rounding_account_id || def.rows[0]?.rounding_account_id || null;
  if (roundingId) {
    await assertPostingAccount(client, roundingId, 'حساب فروقات التقريب', {
      invalidStatusCode: 422,
    });
  }
  return { payableId, roundingId };
}

export async function assertAccountIdsForLocks(
  client: TxClient,
  accountIds: string[]
): Promise<string[]> {
  const unique = [...new Set(accountIds.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  for (const id of unique) {
    await assertPostingAccount(client, id, 'حساب ترحيل الرواتب', {
      invalidStatusCode: 422,
    });
  }
  return unique;
}
