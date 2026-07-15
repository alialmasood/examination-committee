/** أنواع المصروفات التشغيلية المباشرة — 6.B */
import { AccountsHttpError } from './auth';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { assertValidExpenseGlAccount } from './supplier-invoice-types';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type DirectExpenseTypeRow = {
  id: string; code: string; name_ar: string; name_en: string | null;
  default_expense_gl_account_id: string | null; default_cost_center_id: string | null;
  requires_cost_center: boolean; is_active: boolean; description: string | null;
  version: number; created_by: string; updated_by: string | null;
  created_at: Date | string; updated_at: Date | string;
};

const iso = (v: Date | string | null | undefined) =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
const text = (v: unknown, n: number) => {
  const s = String(v ?? '').trim().slice(0, n);
  return s || null;
};
function code(v: unknown) {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) throw new AccountsHttpError('رمز نوع المصروف مطلوب', 400);
  if (s.length > 40 || !/^[A-Z0-9_-]+$/.test(s)) {
    throw new AccountsHttpError('رمز نوع المصروف غير صالح', 400);
  }
  return s;
}
function name(v: unknown) {
  const s = String(v ?? '').trim().slice(0, 200);
  if (!s) throw new AccountsHttpError('اسم نوع المصروف بالعربية مطلوب', 400);
  return s;
}
function optimistic(row: DirectExpenseTypeRow, version: unknown, updatedAt: unknown) {
  assertCashSessionOptimisticConcurrency({
    currentVersion: row.version, currentUpdatedAt: row.updated_at,
    expectedVersion: version, expectedUpdatedAt: updatedAt,
  });
}
async function costCenter(client: TxClient, id: string | null): Promise<string | null> {
  if (!id) return null;
  const r = await txQuery(client,
    `SELECT 1 FROM accounts.cost_centers WHERE id=$1::uuid AND is_active=TRUE`, [id]);
  if (!r.rows[0]) throw new AccountsHttpError('مركز الكلفة غير موجود أو غير فعّال', 400);
  return id;
}

export function serializeDirectExpenseType(row: DirectExpenseTypeRow) {
  return { ...row, created_at: iso(row.created_at)!, updated_at: iso(row.updated_at)! };
}
export async function loadDirectExpenseType(client: TxClient, id: string, forUpdate = false) {
  const r = await txQuery<DirectExpenseTypeRow>(client,
    `SELECT * FROM accounts.direct_expense_types WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  if (!r.rows[0]) throw new AccountsHttpError('نوع المصروف المباشر غير موجود', 404);
  return r.rows[0];
}
export async function createDirectExpenseType(client: TxClient, input: {
  code: unknown; name_ar: unknown; name_en?: unknown; default_expense_gl_account_id?: unknown;
  default_cost_center_id?: unknown; requires_cost_center?: unknown; description?: unknown; created_by: string;
}) {
  const c = code(input.code);
  const dup = await txQuery(client, `SELECT 1 FROM accounts.direct_expense_types WHERE code=$1`, [c]);
  if (dup.rows[0]) throw new AccountsHttpError('رمز نوع المصروف مستخدم مسبقاً', 409);
  const glId = text(input.default_expense_gl_account_id, 100);
  if (glId) await assertValidExpenseGlAccount(client, glId);
  const ccId = await costCenter(client, text(input.default_cost_center_id, 100));
  const r = await txQuery<DirectExpenseTypeRow>(client,
    `INSERT INTO accounts.direct_expense_types
     (code,name_ar,name_en,default_expense_gl_account_id,default_cost_center_id,requires_cost_center,description,created_by,updated_by)
     VALUES($1,$2,$3,$4::uuid,$5::uuid,$6,$7,$8::uuid,$8::uuid) RETURNING *`,
    [c, name(input.name_ar), text(input.name_en, 200), glId, ccId,
      Boolean(input.requires_cost_center), text(input.description, 4000), input.created_by]);
  return r.rows[0];
}
export async function updateDirectExpenseType(client: TxClient, p: {
  id: string; userId: string; version: unknown; updated_at: unknown; name_ar?: unknown; name_en?: unknown;
  default_expense_gl_account_id?: unknown; default_cost_center_id?: unknown; requires_cost_center?: unknown; description?: unknown;
}) {
  const row = await loadDirectExpenseType(client, p.id, true); optimistic(row, p.version, p.updated_at);
  let gl = row.default_expense_gl_account_id;
  if (p.default_expense_gl_account_id !== undefined) {
    gl = text(p.default_expense_gl_account_id, 100);
    if (gl) await assertValidExpenseGlAccount(client, gl);
  }
  const cc = p.default_cost_center_id === undefined
    ? row.default_cost_center_id : await costCenter(client, text(p.default_cost_center_id, 100));
  const r = await txQuery<DirectExpenseTypeRow>(client,
    `UPDATE accounts.direct_expense_types SET name_ar=$2,name_en=$3,default_expense_gl_account_id=$4::uuid,
       default_cost_center_id=$5::uuid,requires_cost_center=$6,description=$7,updated_by=$8::uuid,
       updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
    [row.id, p.name_ar === undefined ? row.name_ar : name(p.name_ar),
      p.name_en === undefined ? row.name_en : text(p.name_en, 200), gl, cc,
      p.requires_cost_center === undefined ? row.requires_cost_center : Boolean(p.requires_cost_center),
      p.description === undefined ? row.description : text(p.description, 4000), p.userId]);
  return r.rows[0];
}
export async function deactivateDirectExpenseType(client: TxClient, p: {
  id: string; userId: string; version: unknown; updated_at: unknown;
}) {
  const row = await loadDirectExpenseType(client, p.id, true); optimistic(row, p.version, p.updated_at);
  if (!row.is_active) return row;
  const r = await txQuery<DirectExpenseTypeRow>(client,
    `UPDATE accounts.direct_expense_types SET is_active=FALSE,updated_by=$2::uuid,updated_at=NOW(),
     version=version+1 WHERE id=$1::uuid RETURNING *`, [row.id, p.userId]);
  return r.rows[0];
}
export async function listDirectExpenseTypes(client: TxClient, p: {
  q?: string; active_only?: boolean; page?: number; page_size?: number;
}) {
  const page = Math.max(1, p.page ?? 1), page_size = Math.min(100, Math.max(1, p.page_size ?? 50));
  const q = (p.q ?? '').trim(), values: unknown[] = [p.active_only ?? false, q];
  const where = `WHERE (NOT $1::boolean OR is_active=TRUE) AND ($2='' OR code ILIKE '%'||$2||'%' OR name_ar ILIKE '%'||$2||'%')`;
  const n = await txQuery<{total:number}>(client, `SELECT COUNT(*)::int total FROM accounts.direct_expense_types ${where}`, values);
  const r = await txQuery<DirectExpenseTypeRow>(client,
    `SELECT * FROM accounts.direct_expense_types ${where} ORDER BY code LIMIT $3 OFFSET $4`,
    [...values, page_size, (page - 1) * page_size]);
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
