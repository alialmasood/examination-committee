/** مواقع الأصول الثابتة — 8.A (مع منع الدورات في الهرمية) */
import { AccountsHttpError } from './auth';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

const LOCATION_TYPES = ['BUILDING', 'FLOOR', 'ROOM', 'WAREHOUSE', 'OFFICE', 'LAB', 'OTHER'] as const;
type LocationType = (typeof LOCATION_TYPES)[number];

export type AssetLocationRow = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  location_type: LocationType;
  parent_location_id: string | null;
  department_id: string | null;
  description: string | null;
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
  if (!s) throw new AccountsHttpError('رمز الموقع مطلوب', 400);
  if (s.length > 40 || !/^[A-Z0-9_-]+$/.test(s)) {
    throw new AccountsHttpError('رمز الموقع غير صالح', 400);
  }
  return s;
}
function name(v: unknown) {
  const s = String(v ?? '').trim().slice(0, 200);
  if (!s) throw new AccountsHttpError('اسم الموقع بالعربية مطلوب', 400);
  return s;
}
function locationType(v: unknown, fallback: LocationType = 'ROOM'): LocationType {
  const s = String(v ?? fallback).trim().toUpperCase();
  if (!LOCATION_TYPES.includes(s as LocationType)) {
    throw new AccountsHttpError('نوع الموقع غير صالح', 400);
  }
  return s as LocationType;
}
function optimistic(row: AssetLocationRow, version: unknown, updatedAt: unknown) {
  assertCashSessionOptimisticConcurrency({
    currentVersion: row.version,
    currentUpdatedAt: row.updated_at,
    expectedVersion: version,
    expectedUpdatedAt: updatedAt,
  });
}

export function serializeAssetLocation(row: AssetLocationRow) {
  return { ...row, created_at: iso(row.created_at)!, updated_at: iso(row.updated_at)! };
}

export async function loadAssetLocation(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<AssetLocationRow> {
  const r = await txQuery<AssetLocationRow>(
    client,
    `SELECT * FROM accounts.asset_locations WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('موقع الأصل غير موجود', 404);
  return r.rows[0];
}

async function assertParent(
  client: TxClient,
  parentId: string | null,
  selfId: string | null
): Promise<string | null> {
  if (!parentId) return null;
  if (selfId && parentId === selfId) {
    throw new AccountsHttpError('لا يمكن أن يكون الموقع أباً لنفسه', 400);
  }
  const parent = await txQuery<{ id: string; is_active: boolean }>(
    client,
    `SELECT id, is_active FROM accounts.asset_locations WHERE id=$1::uuid`,
    [parentId]
  );
  if (!parent.rows[0]) throw new AccountsHttpError('الموقع الأب غير موجود', 400);
  // منع الدورات: تتبّع سلسلة الآباء صعوداً — إن وصلنا selfId فهذه دورة
  if (selfId) {
    let cursor: string | null = parentId;
    const guard = new Set<string>();
    while (cursor) {
      if (cursor === selfId) {
        throw new AccountsHttpError('لا يمكن إنشاء دورة في هرمية المواقع', 400);
      }
      if (guard.has(cursor)) break;
      guard.add(cursor);
      const up: { rows: Array<{ parent_location_id: string | null }> } = await txQuery(
        client,
        `SELECT parent_location_id FROM accounts.asset_locations WHERE id=$1::uuid`,
        [cursor]
      );
      cursor = up.rows[0]?.parent_location_id ?? null;
    }
  }
  return parentId;
}

async function assertDepartment(client: TxClient, id: string | null): Promise<string | null> {
  if (!id) return null;
  const r = await txQuery(
    client,
    `SELECT 1 FROM student_affairs.departments WHERE id=$1::uuid`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('القسم غير موجود', 400);
  return id;
}

export async function createAssetLocation(
  client: TxClient,
  input: {
    code: unknown;
    name_ar: unknown;
    name_en?: unknown;
    location_type?: unknown;
    parent_location_id?: unknown;
    department_id?: unknown;
    description?: unknown;
    created_by: string;
  }
): Promise<AssetLocationRow> {
  const c = code(input.code);
  const dup = await txQuery(
    client,
    `SELECT 1 FROM accounts.asset_locations WHERE UPPER(code)=UPPER($1)`,
    [c]
  );
  if (dup.rows[0]) throw new AccountsHttpError('رمز الموقع مستخدم مسبقاً', 409);
  const parentId = await assertParent(client, text(input.parent_location_id, 100), null);
  const deptId = await assertDepartment(client, text(input.department_id, 100));
  const r = await txQuery<AssetLocationRow>(
    client,
    `INSERT INTO accounts.asset_locations
      (code, name_ar, name_en, location_type, parent_location_id, department_id, description, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,$8::uuid,$8::uuid) RETURNING *`,
    [
      c,
      name(input.name_ar),
      text(input.name_en, 200),
      locationType(input.location_type),
      parentId,
      deptId,
      text(input.description, 4000),
      input.created_by,
    ]
  );
  return r.rows[0];
}

export async function updateAssetLocation(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    name_ar?: unknown;
    name_en?: unknown;
    location_type?: unknown;
    parent_location_id?: unknown;
    department_id?: unknown;
    description?: unknown;
  }
): Promise<AssetLocationRow> {
  const row = await loadAssetLocation(client, p.id, true);
  optimistic(row, p.version, p.updated_at);
  const parentId =
    p.parent_location_id === undefined
      ? row.parent_location_id
      : await assertParent(client, text(p.parent_location_id, 100), row.id);
  const deptId =
    p.department_id === undefined
      ? row.department_id
      : await assertDepartment(client, text(p.department_id, 100));
  const r = await txQuery<AssetLocationRow>(
    client,
    `UPDATE accounts.asset_locations SET
       name_ar=$2, name_en=$3, location_type=$4, parent_location_id=$5::uuid,
       department_id=$6::uuid, description=$7, updated_by=$8::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [
      row.id,
      p.name_ar === undefined ? row.name_ar : name(p.name_ar),
      p.name_en === undefined ? row.name_en : text(p.name_en, 200),
      p.location_type === undefined ? row.location_type : locationType(p.location_type),
      parentId,
      deptId,
      p.description === undefined ? row.description : text(p.description, 4000),
      p.userId,
    ]
  );
  return r.rows[0];
}

export async function toggleAssetLocationStatus(
  client: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown; is_active?: unknown }
): Promise<AssetLocationRow> {
  const row = await loadAssetLocation(client, p.id, true);
  optimistic(row, p.version, p.updated_at);
  const target = p.is_active === undefined ? !row.is_active : Boolean(p.is_active);
  if (target === row.is_active) return row;
  const r = await txQuery<AssetLocationRow>(
    client,
    `UPDATE accounts.asset_locations SET is_active=$2, updated_by=$3::uuid,
       updated_at=NOW(), version=version+1 WHERE id=$1::uuid RETURNING *`,
    [row.id, target, p.userId]
  );
  return r.rows[0];
}

export async function listAssetLocations(
  client: TxClient,
  p: { q?: string; active_only?: boolean; page?: number; page_size?: number }
): Promise<{ rows: AssetLocationRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(200, Math.max(1, p.page_size ?? 50));
  const q = (p.q ?? '').trim();
  const values: unknown[] = [p.active_only ?? false, q];
  const where = `WHERE (NOT $1::boolean OR is_active=TRUE)
     AND ($2='' OR code ILIKE '%'||$2||'%' OR name_ar ILIKE '%'||$2||'%')`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.asset_locations ${where}`,
    values
  );
  const r = await txQuery<AssetLocationRow>(
    client,
    `SELECT * FROM accounts.asset_locations ${where} ORDER BY code LIMIT $3 OFFSET $4`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
