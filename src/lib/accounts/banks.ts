/**
 * المصارف — المرحلة 4.A
 */
import { AccountsHttpError } from './auth';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';

export type BankRow = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  short_name: string | null;
  swift_code: string | null;
  country_code: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  is_active: boolean;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function normalizeCode(value: unknown): string {
  const s = String(value ?? '').trim().toUpperCase();
  if (!s) throw new AccountsHttpError('رمز المصرف مطلوب', 400);
  if (s.length > 50) throw new AccountsHttpError('رمز المصرف طويل جداً', 400);
  return s;
}

function requireNameAr(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError('اسم المصرف بالعربية مطلوب', 400);
  return s.slice(0, 200);
}

function optText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, max);
  return s || null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export function serializeBank(row: BankRow) {
  return {
    ...row,
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

function assertOptimistic(row: BankRow, version: unknown, updatedAt: unknown) {
  assertCashSessionOptimisticConcurrency({
    currentVersion: row.version,
    currentUpdatedAt: row.updated_at,
    expectedVersion: version,
    expectedUpdatedAt: updatedAt,
  });
}

export async function loadBank(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<BankRow> {
  const r = await txQuery<BankRow>(
    client,
    `SELECT * FROM accounts.banks WHERE id = $1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('المصرف غير موجود', 404);
  return r.rows[0];
}

export async function createBank(
  client: TxClient,
  input: {
    code: unknown;
    name_ar: unknown;
    name_en?: unknown;
    short_name?: unknown;
    swift_code?: unknown;
    country_code?: unknown;
    phone?: unknown;
    email?: unknown;
    website?: unknown;
    notes?: unknown;
    is_active?: unknown;
    created_by: string;
  }
): Promise<BankRow> {
  const code = normalizeCode(input.code);
  const nameAr = requireNameAr(input.name_ar);
  const country = optText(input.country_code, 2);
  if (country && country.length !== 2) {
    throw new AccountsHttpError('رمز الدولة يجب أن يكون حرفين', 400);
  }
  const isActive =
    input.is_active === undefined || input.is_active === null
      ? true
      : Boolean(input.is_active);

  const ins = await txQuery<BankRow>(
    client,
    `INSERT INTO accounts.banks (
       code, name_ar, name_en, short_name, swift_code, country_code,
       phone, email, website, notes, is_active, created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::uuid,$12::uuid
     ) RETURNING *`,
    [
      code,
      nameAr,
      optText(input.name_en, 200),
      optText(input.short_name, 100),
      optText(input.swift_code, 20)?.toUpperCase() ?? null,
      country?.toUpperCase() ?? null,
      optText(input.phone, 40),
      optText(input.email, 200),
      optText(input.website, 300),
      optText(input.notes, 4000),
      isActive,
      input.created_by,
    ]
  );
  return ins.rows[0];
}

export async function updateBank(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    name_ar?: unknown;
    name_en?: unknown;
    short_name?: unknown;
    swift_code?: unknown;
    country_code?: unknown;
    phone?: unknown;
    email?: unknown;
    website?: unknown;
    notes?: unknown;
    is_active?: unknown;
  }
): Promise<BankRow> {
  const bank = await loadBank(client, params.id, true);
  assertOptimistic(bank, params.version, params.updated_at);

  const nameAr =
    params.name_ar !== undefined ? requireNameAr(params.name_ar) : bank.name_ar;
  let country =
    params.country_code !== undefined
      ? optText(params.country_code, 2)
      : bank.country_code;
  if (country && country.length !== 2) {
    throw new AccountsHttpError('رمز الدولة يجب أن يكون حرفين', 400);
  }
  if (country) country = country.toUpperCase();

  const upd = await txQuery<BankRow>(
    client,
    `UPDATE accounts.banks SET
       name_ar = $2,
       name_en = $3,
       short_name = $4,
       swift_code = $5,
       country_code = $6,
       phone = $7,
       email = $8,
       website = $9,
       notes = $10,
       is_active = $11,
       updated_by = $12::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      bank.id,
      nameAr,
      params.name_en !== undefined ? optText(params.name_en, 200) : bank.name_en,
      params.short_name !== undefined
        ? optText(params.short_name, 100)
        : bank.short_name,
      params.swift_code !== undefined
        ? optText(params.swift_code, 20)?.toUpperCase() ?? null
        : bank.swift_code,
      country,
      params.phone !== undefined ? optText(params.phone, 40) : bank.phone,
      params.email !== undefined ? optText(params.email, 200) : bank.email,
      params.website !== undefined ? optText(params.website, 300) : bank.website,
      params.notes !== undefined ? optText(params.notes, 4000) : bank.notes,
      params.is_active !== undefined ? Boolean(params.is_active) : bank.is_active,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function deactivateBank(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<BankRow> {
  const bank = await loadBank(client, params.id, true);
  assertOptimistic(bank, params.version, params.updated_at);
  if (!bank.is_active) return bank;

  const activeAccounts = await txQuery(
    client,
    `SELECT 1 FROM accounts.bank_accounts
     WHERE bank_id = $1::uuid AND status = 'ACTIVE' LIMIT 1`,
    [bank.id]
  );
  if (activeAccounts.rows[0]) {
    throw new AccountsHttpError(
      'لا يمكن تعطيل المصرف لوجود حسابات مصرفية فعّالة مرتبطة به',
      409
    );
  }

  const upd = await txQuery<BankRow>(
    client,
    `UPDATE accounts.banks SET
       is_active = FALSE,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [bank.id, params.userId]
  );
  return upd.rows[0];
}
