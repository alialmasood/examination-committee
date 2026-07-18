/** تصنيفات الأصول الثابتة — 8.A */
import { AccountsHttpError } from './auth';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import {
  assertAccumulatedDepreciationGlAccount,
  assertAssetGlAccount,
  assertDepreciationExpenseGlAccount,
  assertGainGlAccount,
  assertLossGlAccount,
} from './fixed-assets-gl';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type AssetCategoryRow = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  asset_gl_account_id: string;
  accumulated_depreciation_gl_account_id: string;
  depreciation_expense_gl_account_id: string;
  gain_gl_account_id: string | null;
  loss_gl_account_id: string | null;
  depreciation_method: 'STRAIGHT_LINE' | 'NONE';
  useful_life_months: number | null;
  salvage_value_percent: string;
  capitalization_threshold: string;
  is_active: boolean;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const iso = (v: Date | string | null | undefined) =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
const text = (v: unknown, n: number) => {
  const s = String(v ?? '').trim().slice(0, n);
  return s || null;
};
function code(v: unknown) {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) throw new AccountsHttpError('رمز التصنيف مطلوب', 400);
  if (s.length > 40 || !/^[A-Z0-9_-]+$/.test(s)) {
    throw new AccountsHttpError('رمز التصنيف غير صالح (أحرف/أرقام/شرطة فقط)', 400);
  }
  return s;
}
function name(v: unknown) {
  const s = String(v ?? '').trim().slice(0, 200);
  if (!s) throw new AccountsHttpError('اسم التصنيف بالعربية مطلوب', 400);
  return s;
}
function method(v: unknown, fallback: 'STRAIGHT_LINE' | 'NONE' = 'STRAIGHT_LINE') {
  const s = String(v ?? fallback).trim().toUpperCase();
  if (s !== 'STRAIGHT_LINE' && s !== 'NONE') {
    throw new AccountsHttpError('طريقة الإهلاك غير صالحة', 400);
  }
  return s as 'STRAIGHT_LINE' | 'NONE';
}
function usefulLife(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AccountsHttpError('العمر الإنتاجي يجب أن يكون عدداً صحيحاً موجباً (بالأشهر)', 400);
  }
  return n;
}
function percent(v: unknown): string {
  if (v == null || v === '') return '0';
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new AccountsHttpError('نسبة القيمة المتبقية يجب أن تكون بين 0 و 100', 400);
  }
  return String(n);
}
function threshold(v: unknown): string {
  if (v == null || v === '') return '0';
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new AccountsHttpError('حد الرسملة يجب أن يكون رقماً غير سالب', 400);
  }
  return String(n);
}
function optimistic(row: AssetCategoryRow, version: unknown, updatedAt: unknown) {
  assertCashSessionOptimisticConcurrency({
    currentVersion: row.version,
    currentUpdatedAt: row.updated_at,
    expectedVersion: version,
    expectedUpdatedAt: updatedAt,
  });
}

export function serializeAssetCategory(row: AssetCategoryRow) {
  return { ...row, created_at: iso(row.created_at)!, updated_at: iso(row.updated_at)! };
}

export async function loadAssetCategory(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<AssetCategoryRow> {
  const r = await txQuery<AssetCategoryRow>(
    client,
    `SELECT * FROM accounts.asset_categories WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('تصنيف الأصل غير موجود', 404);
  return r.rows[0];
}

async function assertCategoryGls(
  client: TxClient,
  gls: {
    asset_gl_account_id: string;
    accumulated_depreciation_gl_account_id: string;
    depreciation_expense_gl_account_id: string;
    gain_gl_account_id: string | null;
    loss_gl_account_id: string | null;
  }
) {
  await assertAssetGlAccount(client, gls.asset_gl_account_id);
  await assertAccumulatedDepreciationGlAccount(
    client,
    gls.accumulated_depreciation_gl_account_id
  );
  await assertDepreciationExpenseGlAccount(client, gls.depreciation_expense_gl_account_id);
  if (gls.gain_gl_account_id) await assertGainGlAccount(client, gls.gain_gl_account_id);
  if (gls.loss_gl_account_id) await assertLossGlAccount(client, gls.loss_gl_account_id);
}

export async function createAssetCategory(
  client: TxClient,
  input: {
    code: unknown;
    name_ar: unknown;
    name_en?: unknown;
    description?: unknown;
    asset_gl_account_id: unknown;
    accumulated_depreciation_gl_account_id: unknown;
    depreciation_expense_gl_account_id: unknown;
    gain_gl_account_id?: unknown;
    loss_gl_account_id?: unknown;
    depreciation_method?: unknown;
    useful_life_months?: unknown;
    salvage_value_percent?: unknown;
    capitalization_threshold?: unknown;
    created_by: string;
  }
): Promise<AssetCategoryRow> {
  const c = code(input.code);
  const dup = await txQuery(
    client,
    `SELECT 1 FROM accounts.asset_categories WHERE UPPER(code)=UPPER($1)`,
    [c]
  );
  if (dup.rows[0]) throw new AccountsHttpError('رمز التصنيف مستخدم مسبقاً', 409);

  const assetGl = String(input.asset_gl_account_id ?? '').trim();
  const accumGl = String(input.accumulated_depreciation_gl_account_id ?? '').trim();
  const expGl = String(input.depreciation_expense_gl_account_id ?? '').trim();
  const gainGl = text(input.gain_gl_account_id, 100);
  const lossGl = text(input.loss_gl_account_id, 100);
  const m = method(input.depreciation_method);
  await assertCategoryGls(client, {
    asset_gl_account_id: assetGl,
    accumulated_depreciation_gl_account_id: accumGl,
    depreciation_expense_gl_account_id: expGl,
    gain_gl_account_id: gainGl,
    loss_gl_account_id: lossGl,
  });

  const r = await txQuery<AssetCategoryRow>(
    client,
    `INSERT INTO accounts.asset_categories
      (code, name_ar, name_en, description, asset_gl_account_id,
       accumulated_depreciation_gl_account_id, depreciation_expense_gl_account_id,
       gain_gl_account_id, loss_gl_account_id, depreciation_method, useful_life_months,
       salvage_value_percent, capitalization_threshold, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9::uuid,$10,$11,$12::numeric,$13::numeric,$14::uuid,$14::uuid)
     RETURNING *`,
    [
      c,
      name(input.name_ar),
      text(input.name_en, 200),
      text(input.description, 4000),
      assetGl,
      accumGl,
      expGl,
      gainGl,
      lossGl,
      m,
      usefulLife(input.useful_life_months),
      percent(input.salvage_value_percent),
      threshold(input.capitalization_threshold),
      input.created_by,
    ]
  );
  return r.rows[0];
}

export async function updateAssetCategory(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    name_ar?: unknown;
    name_en?: unknown;
    description?: unknown;
    asset_gl_account_id?: unknown;
    accumulated_depreciation_gl_account_id?: unknown;
    depreciation_expense_gl_account_id?: unknown;
    gain_gl_account_id?: unknown;
    loss_gl_account_id?: unknown;
    depreciation_method?: unknown;
    useful_life_months?: unknown;
    salvage_value_percent?: unknown;
    capitalization_threshold?: unknown;
  }
): Promise<AssetCategoryRow> {
  const row = await loadAssetCategory(client, p.id, true);
  optimistic(row, p.version, p.updated_at);

  const assetGl =
    p.asset_gl_account_id === undefined
      ? row.asset_gl_account_id
      : String(p.asset_gl_account_id ?? '').trim();
  const accumGl =
    p.accumulated_depreciation_gl_account_id === undefined
      ? row.accumulated_depreciation_gl_account_id
      : String(p.accumulated_depreciation_gl_account_id ?? '').trim();
  const expGl =
    p.depreciation_expense_gl_account_id === undefined
      ? row.depreciation_expense_gl_account_id
      : String(p.depreciation_expense_gl_account_id ?? '').trim();
  const gainGl =
    p.gain_gl_account_id === undefined
      ? row.gain_gl_account_id
      : text(p.gain_gl_account_id, 100);
  const lossGl =
    p.loss_gl_account_id === undefined
      ? row.loss_gl_account_id
      : text(p.loss_gl_account_id, 100);
  const m =
    p.depreciation_method === undefined
      ? row.depreciation_method
      : method(p.depreciation_method);

  await assertCategoryGls(client, {
    asset_gl_account_id: assetGl,
    accumulated_depreciation_gl_account_id: accumGl,
    depreciation_expense_gl_account_id: expGl,
    gain_gl_account_id: gainGl,
    loss_gl_account_id: lossGl,
  });

  const r = await txQuery<AssetCategoryRow>(
    client,
    `UPDATE accounts.asset_categories SET
       name_ar=$2, name_en=$3, description=$4, asset_gl_account_id=$5::uuid,
       accumulated_depreciation_gl_account_id=$6::uuid, depreciation_expense_gl_account_id=$7::uuid,
       gain_gl_account_id=$8::uuid, loss_gl_account_id=$9::uuid, depreciation_method=$10,
       useful_life_months=$11, salvage_value_percent=$12::numeric, capitalization_threshold=$13::numeric,
       updated_by=$14::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [
      row.id,
      p.name_ar === undefined ? row.name_ar : name(p.name_ar),
      p.name_en === undefined ? row.name_en : text(p.name_en, 200),
      p.description === undefined ? row.description : text(p.description, 4000),
      assetGl,
      accumGl,
      expGl,
      gainGl,
      lossGl,
      m,
      p.useful_life_months === undefined
        ? row.useful_life_months
        : usefulLife(p.useful_life_months),
      p.salvage_value_percent === undefined
        ? row.salvage_value_percent
        : percent(p.salvage_value_percent),
      p.capitalization_threshold === undefined
        ? row.capitalization_threshold
        : threshold(p.capitalization_threshold),
      p.userId,
    ]
  );
  return r.rows[0];
}

export async function toggleAssetCategoryStatus(
  client: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown; is_active?: unknown }
): Promise<AssetCategoryRow> {
  const row = await loadAssetCategory(client, p.id, true);
  optimistic(row, p.version, p.updated_at);
  const target = p.is_active === undefined ? !row.is_active : Boolean(p.is_active);
  if (target === row.is_active) return row;
  const r = await txQuery<AssetCategoryRow>(
    client,
    `UPDATE accounts.asset_categories SET is_active=$2, updated_by=$3::uuid,
       updated_at=NOW(), version=version+1 WHERE id=$1::uuid RETURNING *`,
    [row.id, target, p.userId]
  );
  return r.rows[0];
}

export async function listAssetCategories(
  client: TxClient,
  p: { q?: string; active_only?: boolean; page?: number; page_size?: number }
): Promise<{ rows: AssetCategoryRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(200, Math.max(1, p.page_size ?? 50));
  const q = (p.q ?? '').trim();
  const values: unknown[] = [p.active_only ?? false, q];
  const where = `WHERE (NOT $1::boolean OR is_active=TRUE)
     AND ($2='' OR code ILIKE '%'||$2||'%' OR name_ar ILIKE '%'||$2||'%')`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.asset_categories ${where}`,
    values
  );
  const r = await txQuery<AssetCategoryRow>(
    client,
    `SELECT * FROM accounts.asset_categories ${where} ORDER BY code LIMIT $3 OFFSET $4`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
