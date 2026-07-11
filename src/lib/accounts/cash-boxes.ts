import { AccountsHttpError } from './auth';
import { assertCashBoxAccountEligible } from './cash-box-account';
import { assertCashBoxOptimisticConcurrency } from './cash-box-concurrency';
import { moneyIsPositive, normalizeMoneyInput } from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type CashBoxStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export type CashBoxRow = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  box_type_code: string;
  account_id: string | null;
  closed_account_id: string | null;
  cost_center_id: string | null;
  status: CashBoxStatus;
  ceiling_amount: string | null;
  currency_code: string;
  location_note: string | null;
  description: string | null;
  opened_at: string | Date | null;
  closed_at: string | Date | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function normalizeCode(raw: unknown): string {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (!code) throw new AccountsHttpError('رمز الصندوق مطلوب', 400);
  if (code.length > 50) throw new AccountsHttpError('رمز الصندوق طويل جداً', 400);
  return code;
}

async function assertBoxTypeActive(client: TxClient, code: string): Promise<void> {
  const r = await txQuery(
    client,
    `SELECT code FROM accounts.cash_box_types
     WHERE UPPER(code) = UPPER($1) AND is_active = TRUE`,
    [code]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError(
      'نوع الصندوق غير معروف أو غير فعّال — شغّل seed:cash-box-types:execute',
      400
    );
  }
}

function assertPettyCeiling(boxType: string, ceiling: string | null): void {
  if (boxType.toUpperCase() !== 'PETTY') return;
  if (ceiling == null || !moneyIsPositive(ceiling)) {
    throw new AccountsHttpError('صندوق النثريات يتطلب سقفاً أكبر من صفر', 400);
  }
}

export async function loadCashBox(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<CashBoxRow> {
  const r = await txQuery<CashBoxRow>(
    client,
    `SELECT * FROM accounts.cash_boxes WHERE id = $1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('الصندوق غير موجود', 404);
  return r.rows[0];
}

export type CreateCashBoxInput = {
  code: unknown;
  name_ar: unknown;
  name_en?: unknown;
  box_type_code: unknown;
  account_id?: unknown;
  cost_center_id?: unknown;
  ceiling_amount?: unknown;
  currency_code?: unknown;
  location_note?: unknown;
  description?: unknown;
  created_by: string;
};

export async function createCashBox(
  client: TxClient,
  input: CreateCashBoxInput
): Promise<CashBoxRow> {
  const code = normalizeCode(input.code);
  const nameAr = String(input.name_ar ?? '').trim();
  if (!nameAr) throw new AccountsHttpError('الاسم العربي للصندوق مطلوب', 400);

  const boxType = String(input.box_type_code ?? '')
    .trim()
    .toUpperCase();
  if (!boxType) throw new AccountsHttpError('نوع الصندوق مطلوب', 400);
  await assertBoxTypeActive(client, boxType);

  let ceiling: string | null = null;
  if (input.ceiling_amount != null && input.ceiling_amount !== '') {
    try {
      ceiling = normalizeMoneyInput(input.ceiling_amount);
    } catch {
      throw new AccountsHttpError('قيمة السقف غير صالحة', 400);
    }
    if (!moneyIsPositive(ceiling)) {
      throw new AccountsHttpError('السقف يجب أن يكون أكبر من صفر', 400);
    }
  }
  assertPettyCeiling(boxType, ceiling);

  let accountId: string | null = null;
  if (input.account_id) {
    accountId = String(input.account_id);
    await assertCashBoxAccountEligible(client, accountId);
  }

  const currency = String(input.currency_code ?? 'IQD').trim() || 'IQD';
  const costCenterId = input.cost_center_id ? String(input.cost_center_id) : null;

  if (costCenterId) {
    const cc = await txQuery(
      client,
      `SELECT id FROM accounts.cost_centers WHERE id = $1::uuid AND is_active = TRUE`,
      [costCenterId]
    );
    if (!cc.rows[0]) throw new AccountsHttpError('مركز الكلفة غير موجود أو غير فعّال', 400);
  }

  const ins = await txQuery<CashBoxRow>(
    client,
    `INSERT INTO accounts.cash_boxes (
       code, name_ar, name_en, box_type_code, account_id, cost_center_id,
       status, ceiling_amount, currency_code, location_note, description,
       version, created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5::uuid,$6::uuid,
       'DRAFT',$7::numeric,$8,$9,$10,
       1,$11::uuid,$11::uuid
     )
     RETURNING *`,
    [
      code,
      nameAr,
      input.name_en != null ? String(input.name_en).trim() || null : null,
      boxType,
      accountId,
      costCenterId,
      ceiling,
      currency,
      input.location_note != null ? String(input.location_note).trim() || null : null,
      input.description != null ? String(input.description).trim() || null : null,
      input.created_by,
    ]
  );

  return ins.rows[0];
}

export type UpdateCashBoxInput = {
  name_ar?: unknown;
  name_en?: unknown;
  box_type_code?: unknown;
  account_id?: unknown;
  cost_center_id?: unknown;
  ceiling_amount?: unknown;
  currency_code?: unknown;
  location_note?: unknown;
  description?: unknown;
  version: unknown;
  updated_at: unknown;
  updated_by: string;
};

export async function updateCashBox(
  client: TxClient,
  id: string,
  input: UpdateCashBoxInput
): Promise<CashBoxRow> {
  const box = await loadCashBox(client, id, true);
  if (box.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن تعديل صندوق مغلق نهائياً', 409);
  }

  assertCashBoxOptimisticConcurrency({
    currentVersion: box.version,
    currentUpdatedAt: box.updated_at,
    expectedVersion: input.version,
    expectedUpdatedAt: input.updated_at,
  });

  let boxType = box.box_type_code;
  if (input.box_type_code != null) {
    boxType = String(input.box_type_code).trim().toUpperCase();
    await assertBoxTypeActive(client, boxType);
  }

  let nameAr = box.name_ar;
  if (input.name_ar != null) {
    nameAr = String(input.name_ar).trim();
    if (!nameAr) throw new AccountsHttpError('الاسم العربي للصندوق مطلوب', 400);
  }

  let accountId = box.account_id;
  if (input.account_id !== undefined) {
    if (box.status !== 'DRAFT') {
      throw new AccountsHttpError('لا يمكن تغيير الحساب إلا والصندوق في حالة مسودة', 409);
    }
    if (input.account_id === null || input.account_id === '') {
      accountId = null;
    } else {
      accountId = String(input.account_id);
      await assertCashBoxAccountEligible(client, accountId, id);
    }
  }

  let ceiling = box.ceiling_amount != null ? normalizeMoneyInput(box.ceiling_amount) : null;
  if (input.ceiling_amount !== undefined) {
    if (input.ceiling_amount === null || input.ceiling_amount === '') {
      ceiling = null;
    } else {
      try {
        ceiling = normalizeMoneyInput(input.ceiling_amount);
      } catch {
        throw new AccountsHttpError('قيمة السقف غير صالحة', 400);
      }
      if (!moneyIsPositive(ceiling)) {
        throw new AccountsHttpError('السقف يجب أن يكون أكبر من صفر', 400);
      }
    }
  }
  assertPettyCeiling(boxType, ceiling);

  let costCenterId = box.cost_center_id;
  if (input.cost_center_id !== undefined) {
    if (input.cost_center_id === null || input.cost_center_id === '') {
      costCenterId = null;
    } else {
      costCenterId = String(input.cost_center_id);
      const cc = await txQuery(
        client,
        `SELECT id FROM accounts.cost_centers WHERE id = $1::uuid AND is_active = TRUE`,
        [costCenterId]
      );
      if (!cc.rows[0]) throw new AccountsHttpError('مركز الكلفة غير موجود أو غير فعّال', 400);
    }
  }

  const upd = await txQuery<CashBoxRow>(
    client,
    `UPDATE accounts.cash_boxes SET
       name_ar = $2,
       name_en = COALESCE($3, name_en),
       box_type_code = $4,
       account_id = $5::uuid,
       cost_center_id = $6::uuid,
       ceiling_amount = $7::numeric,
       currency_code = COALESCE(NULLIF(TRIM($8), ''), currency_code),
       location_note = COALESCE($9, location_note),
       description = COALESCE($10, description),
       version = version + 1,
       updated_by = $11::uuid,
       updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [
      id,
      nameAr,
      input.name_en !== undefined
        ? String(input.name_en ?? '').trim() || null
        : box.name_en,
      boxType,
      accountId,
      costCenterId,
      ceiling,
      input.currency_code != null ? String(input.currency_code) : box.currency_code,
      input.location_note !== undefined
        ? String(input.location_note ?? '').trim() || null
        : box.location_note,
      input.description !== undefined
        ? String(input.description ?? '').trim() || null
        : box.description,
      input.updated_by,
    ]
  );

  return upd.rows[0];
}

export async function activateCashBox(
  client: TxClient,
  id: string,
  params: {
    version: unknown;
    updated_at: unknown;
    activated_by: string;
  }
): Promise<CashBoxRow> {
  const box = await loadCashBox(client, id, true);
  assertCashBoxOptimisticConcurrency({
    currentVersion: box.version,
    currentUpdatedAt: box.updated_at,
    expectedVersion: params.version,
    expectedUpdatedAt: params.updated_at,
  });

  if (box.status === 'ACTIVE') {
    throw new AccountsHttpError('الصندوق مفعّل مسبقاً', 409);
  }
  if (box.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن تفعيل صندوق مغلق نهائياً', 409);
  }
  if (box.status !== 'DRAFT' && box.status !== 'SUSPENDED') {
    throw new AccountsHttpError('لا يمكن تفعيل الصندوق من حالته الحالية', 409);
  }

  if (!box.account_id) {
    throw new AccountsHttpError('عيّن حساباً صالحاً قبل التفعيل', 409);
  }
  await assertCashBoxAccountEligible(client, box.account_id, id);

  const ceiling =
    box.ceiling_amount != null ? normalizeMoneyInput(box.ceiling_amount) : null;
  assertPettyCeiling(box.box_type_code, ceiling);

  const primary = await txQuery(
    client,
    `SELECT id FROM accounts.cash_box_custodians
     WHERE cash_box_id = $1::uuid
       AND is_primary = TRUE
       AND valid_to IS NULL
     LIMIT 1`,
    [id]
  );
  if (!primary.rows[0]) {
    throw new AccountsHttpError('عيّن أميناً أساسياً سارياً قبل التفعيل', 409);
  }

  const upd = await txQuery<CashBoxRow>(
    client,
    `UPDATE accounts.cash_boxes SET
       status = 'ACTIVE',
       opened_at = COALESCE(opened_at, CURRENT_DATE),
       version = version + 1,
       updated_by = $2::uuid,
       updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [id, params.activated_by]
  );

  return upd.rows[0];
}

export function serializeCashBox(row: CashBoxRow) {
  return {
    ...row,
    ceiling_amount:
      row.ceiling_amount != null ? normalizeMoneyInput(row.ceiling_amount) : null,
    opened_at: row.opened_at
      ? String(row.opened_at).slice(0, 10)
      : null,
    closed_at: row.closed_at ? String(row.closed_at).slice(0, 10) : null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}
