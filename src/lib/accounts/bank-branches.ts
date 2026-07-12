/**
 * فروع المصارف — المرحلة 4.A
 */
import { AccountsHttpError } from './auth';
import { loadBank } from './banks';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type BankBranchRow = {
  id: string;
  bank_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  branch_swift_code: string | null;
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
  if (!s) throw new AccountsHttpError('رمز الفرع مطلوب', 400);
  return s.slice(0, 50);
}

function requireNameAr(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError('اسم الفرع بالعربية مطلوب', 400);
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

export function serializeBankBranch(row: BankBranchRow) {
  return {
    ...row,
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

function assertOptimistic(row: BankBranchRow, version: unknown, updatedAt: unknown) {
  assertCashSessionOptimisticConcurrency({
    currentVersion: row.version,
    currentUpdatedAt: row.updated_at,
    expectedVersion: version,
    expectedUpdatedAt: updatedAt,
  });
}

export async function loadBankBranch(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<BankBranchRow> {
  const r = await txQuery<BankBranchRow>(
    client,
    `SELECT * FROM accounts.bank_branches WHERE id = $1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('فرع المصرف غير موجود', 404);
  return r.rows[0];
}

export async function createBankBranch(
  client: TxClient,
  input: {
    bank_id: unknown;
    code: unknown;
    name_ar: unknown;
    name_en?: unknown;
    city?: unknown;
    address?: unknown;
    phone?: unknown;
    branch_swift_code?: unknown;
    notes?: unknown;
    is_active?: unknown;
    created_by: string;
  }
): Promise<BankBranchRow> {
  const bankId = String(input.bank_id ?? '').trim();
  if (!bankId) throw new AccountsHttpError('المصرف مطلوب', 400);
  const bank = await loadBank(client, bankId, true);
  if (!bank.is_active) {
    throw new AccountsHttpError('لا يمكن إنشاء فرع لمصرف غير فعّال', 409);
  }

  const ins = await txQuery<BankBranchRow>(
    client,
    `INSERT INTO accounts.bank_branches (
       bank_id, code, name_ar, name_en, city, address, phone,
       branch_swift_code, notes, is_active, created_by, updated_by
     ) VALUES (
       $1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$11::uuid
     ) RETURNING *`,
    [
      bankId,
      normalizeCode(input.code),
      requireNameAr(input.name_ar),
      optText(input.name_en, 200),
      optText(input.city, 120),
      optText(input.address, 2000),
      optText(input.phone, 40),
      optText(input.branch_swift_code, 20)?.toUpperCase() ?? null,
      optText(input.notes, 4000),
      input.is_active === undefined || input.is_active === null
        ? true
        : Boolean(input.is_active),
      input.created_by,
    ]
  );
  return ins.rows[0];
}

export async function updateBankBranch(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    name_ar?: unknown;
    name_en?: unknown;
    city?: unknown;
    address?: unknown;
    phone?: unknown;
    branch_swift_code?: unknown;
    notes?: unknown;
    is_active?: unknown;
  }
): Promise<BankBranchRow> {
  const branch = await loadBankBranch(client, params.id, true);
  assertOptimistic(branch, params.version, params.updated_at);

  const upd = await txQuery<BankBranchRow>(
    client,
    `UPDATE accounts.bank_branches SET
       name_ar = $2,
       name_en = $3,
       city = $4,
       address = $5,
       phone = $6,
       branch_swift_code = $7,
       notes = $8,
       is_active = $9,
       updated_by = $10::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      branch.id,
      params.name_ar !== undefined ? requireNameAr(params.name_ar) : branch.name_ar,
      params.name_en !== undefined ? optText(params.name_en, 200) : branch.name_en,
      params.city !== undefined ? optText(params.city, 120) : branch.city,
      params.address !== undefined ? optText(params.address, 2000) : branch.address,
      params.phone !== undefined ? optText(params.phone, 40) : branch.phone,
      params.branch_swift_code !== undefined
        ? optText(params.branch_swift_code, 20)?.toUpperCase() ?? null
        : branch.branch_swift_code,
      params.notes !== undefined ? optText(params.notes, 4000) : branch.notes,
      params.is_active !== undefined ? Boolean(params.is_active) : branch.is_active,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function deactivateBankBranch(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<BankBranchRow> {
  const branch = await loadBankBranch(client, params.id, true);
  assertOptimistic(branch, params.version, params.updated_at);
  if (!branch.is_active) return branch;

  const linked = await txQuery(
    client,
    `SELECT 1 FROM accounts.bank_accounts
     WHERE bank_branch_id = $1::uuid AND status <> 'CLOSED' LIMIT 1`,
    [branch.id]
  );
  if (linked.rows[0]) {
    throw new AccountsHttpError(
      'لا يمكن تعطيل الفرع لوجود حسابات مصرفية غير مغلقة مرتبطة به',
      409
    );
  }

  const upd = await txQuery<BankBranchRow>(
    client,
    `UPDATE accounts.bank_branches SET
       is_active = FALSE,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [branch.id, params.userId]
  );
  return upd.rows[0];
}
