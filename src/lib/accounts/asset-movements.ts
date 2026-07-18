/**
 * حركات الأصول الثابتة — نقل الموقع/القسم/العهدة (8.A). لا أثر محاسبي (GL).
 * POST يحدّث الحقول الحالية للأصل ويكتب سجل العهدة. VOID يعيد القيم السابقة.
 */
import { AccountsHttpError } from './auth';
import { writeFinancialAudit } from './audit';
import {
  acquireAccountingResourceLocks,
  assetMovementLock,
  fixedAssetLock,
} from './accounting-locks';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { nextDocumentNumber, pgDateOnly, yearLabelFromDate } from './document-sequences';
import { maybeFault } from './fixed-assets-faults';
import { loadFixedAsset } from './fixed-assets';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

const MOVEMENT_TYPES = ['LOCATION', 'CUSTODY', 'DEPARTMENT', 'MIXED'] as const;
type MovementType = (typeof MOVEMENT_TYPES)[number];

export type AssetMovementRow = {
  id: string;
  movement_number: string;
  fixed_asset_id: string;
  movement_type: MovementType;
  status: 'DRAFT' | 'POSTED' | 'VOIDED';
  movement_date: string;
  from_location_id: string | null;
  to_location_id: string | null;
  from_department_id: string | null;
  to_department_id: string | null;
  from_custodian_user_id: string | null;
  to_custodian_user_id: string | null;
  reason: string | null;
  notes: string | null;
  posted_at: Date | string | null;
  posted_by: string | null;
  voided_at: Date | string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  version: number;
};

const iso = (v: Date | string | null | undefined) =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
const text = (v: unknown, n: number) => {
  const s = String(v ?? '').trim().slice(0, n);
  return s || null;
};
function movementType(v: unknown): MovementType {
  const s = String(v ?? '').trim().toUpperCase();
  if (!MOVEMENT_TYPES.includes(s as MovementType)) {
    throw new AccountsHttpError('نوع الحركة غير صالح', 400);
  }
  return s as MovementType;
}
function optimistic(row: AssetMovementRow, version: unknown, updatedAt: unknown) {
  assertCashSessionOptimisticConcurrency({
    currentVersion: row.version,
    currentUpdatedAt: row.updated_at,
    expectedVersion: version,
    expectedUpdatedAt: updatedAt,
  });
}

export function serializeAssetMovement(row: AssetMovementRow) {
  return {
    ...row,
    movement_date: pgDateOnly(row.movement_date as unknown as string),
    posted_at: iso(row.posted_at),
    voided_at: iso(row.voided_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export async function loadAssetMovement(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<AssetMovementRow> {
  const r = await txQuery<AssetMovementRow>(
    client,
    `SELECT * FROM accounts.asset_movements WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('حركة الأصل غير موجودة', 404);
  return r.rows[0];
}

async function allocateMovementNumber(client: TxClient): Promise<string> {
  const y = await txQuery<{ id: string; start_date: string }>(
    client,
    `SELECT id, start_date::text AS start_date FROM accounts.fiscal_years
     WHERE status='ACTIVE' ORDER BY start_date DESC LIMIT 1`
  );
  if (!y.rows[0]) throw new AccountsHttpError('لا توجد سنة مالية نشطة', 409);
  const seq = await nextDocumentNumber(client, {
    documentType: 'ASSET_MOVEMENT',
    fiscalYearId: y.rows[0].id,
    yearLabel: yearLabelFromDate(y.rows[0].start_date),
  });
  return seq.formatted;
}

async function assertLocation(client: TxClient, id: string | null): Promise<string | null> {
  if (!id) return null;
  const r = await txQuery(
    client,
    `SELECT 1 FROM accounts.asset_locations WHERE id=$1::uuid AND is_active=TRUE`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('الموقع الهدف غير موجود أو غير فعّال', 400);
  return id;
}

export async function createAssetMovement(
  client: TxClient,
  input: {
    fixed_asset_id: unknown;
    movement_type: unknown;
    movement_date?: unknown;
    to_location_id?: unknown;
    to_department_id?: unknown;
    to_custodian_user_id?: unknown;
    reason?: unknown;
    notes?: unknown;
    created_by: string;
  }
): Promise<AssetMovementRow> {
  const assetId = String(input.fixed_asset_id ?? '').trim();
  if (!assetId) throw new AccountsHttpError('الأصل مطلوب', 400);
  await acquireAccountingResourceLocks(client, [fixedAssetLock(assetId)]);
  const asset = await loadFixedAsset(client, assetId);
  if (asset.status !== 'ACTIVE' && asset.status !== 'SUSPENDED') {
    throw new AccountsHttpError('لا يمكن إنشاء حركة إلا لأصل نشط أو موقوف', 409);
  }
  const type = movementType(input.movement_type);
  const toLoc = await assertLocation(client, text(input.to_location_id, 100));
  const toDept = text(input.to_department_id, 100);
  const toCustodian = text(input.to_custodian_user_id, 100);
  if (!toLoc && !toDept && !toCustodian) {
    throw new AccountsHttpError('يجب تحديد وجهة واحدة على الأقل (موقع/قسم/عهدة)', 400);
  }
  const movementDate = input.movement_date
    ? pgDateOnly(String(input.movement_date).trim())
    : pgDateOnly(new Date());
  const number = await allocateMovementNumber(client);

  const r = await txQuery<AssetMovementRow>(
    client,
    `INSERT INTO accounts.asset_movements
      (movement_number, fixed_asset_id, movement_type, status, movement_date,
       to_location_id, to_department_id, to_custodian_user_id, reason, notes, created_by, updated_by)
     VALUES ($1,$2::uuid,$3,'DRAFT',$4::date,$5::uuid,$6::uuid,$7::uuid,$8,$9,$10::uuid,$10::uuid)
     RETURNING *`,
    [
      number,
      assetId,
      type,
      movementDate,
      toLoc,
      toDept,
      toCustodian,
      text(input.reason, 2000),
      text(input.notes, 4000),
      input.created_by,
    ]
  );
  await writeFinancialAudit(client, {
    userId: input.created_by,
    action: 'asset_movement.created',
    entityType: 'asset_movement',
    entityId: r.rows[0].id,
    newValues: serializeAssetMovement(r.rows[0]),
    description: `إنشاء حركة أصل ${number}`,
  });
  return r.rows[0];
}

export async function postAssetMovement(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<AssetMovementRow> {
  await acquireAccountingResourceLocks(client, [assetMovementLock(p.id)]);
  const mv = await loadAssetMovement(client, p.id, true);
  optimistic(mv, p.version, p.updated_at);
  if (mv.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن ترحيل الحركات في حالة المسودّة فقط', 409);
  }
  await acquireAccountingResourceLocks(client, [fixedAssetLock(mv.fixed_asset_id)]);
  const asset = await loadFixedAsset(client, mv.fixed_asset_id, true);
  if (asset.status !== 'ACTIVE' && asset.status !== 'SUSPENDED') {
    throw new AccountsHttpError('لا يمكن ترحيل حركة إلا لأصل نشط أو موقوف', 409);
  }

  const fromLoc = asset.location_id;
  const fromDept = asset.department_id;
  const fromCustodian = asset.custodian_user_id;
  const newLoc = mv.to_location_id ?? fromLoc;
  const newDept = mv.to_department_id ?? fromDept;
  const newCustodian = mv.to_custodian_user_id ?? fromCustodian;

  // تحديث حقول الأصل الحالية
  await txQuery(
    client,
    `UPDATE accounts.fixed_assets SET location_id=$2::uuid, department_id=$3::uuid,
       custodian_user_id=$4::uuid, updated_by=$5::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid`,
    [asset.id, newLoc, newDept, newCustodian, p.userId]
  );

  maybeFault('movement_after_location');

  // إغلاق سجل العهدة المفتوح ثم فتح سجل جديد
  await txQuery(
    client,
    `UPDATE accounts.asset_custody_history SET to_date=$2::date
     WHERE fixed_asset_id=$1::uuid AND to_date IS NULL`,
    [asset.id, mv.movement_date]
  );
  await txQuery(
    client,
    `INSERT INTO accounts.asset_custody_history
      (fixed_asset_id, movement_id, custodian_user_id, location_id, department_id,
       from_date, change_type, created_by)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::date,$7,$8::uuid)`,
    [
      asset.id,
      mv.id,
      newCustodian,
      newLoc,
      newDept,
      mv.movement_date,
      mv.movement_type,
      p.userId,
    ]
  );

  const r = await txQuery<AssetMovementRow>(
    client,
    `UPDATE accounts.asset_movements SET status='POSTED',
       from_location_id=$2::uuid, from_department_id=$3::uuid, from_custodian_user_id=$4::uuid,
       posted_at=NOW(), posted_by=$5::uuid, updated_by=$5::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [mv.id, fromLoc, fromDept, fromCustodian, p.userId]
  );

  maybeFault('movement_after_status');

  await writeFinancialAudit(client, {
    userId: p.userId,
    action: 'asset_movement.posted',
    entityType: 'asset_movement',
    entityId: mv.id,
    newValues: { from_location_id: fromLoc, to_location_id: newLoc, to_custodian_user_id: newCustodian },
    description: `ترحيل حركة أصل ${mv.movement_number}`,
    ipAddress: p.ipAddress,
    userAgent: p.userAgent,
  });
  return r.rows[0];
}

export async function voidAssetMovement(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason?: unknown;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<AssetMovementRow> {
  await acquireAccountingResourceLocks(client, [assetMovementLock(p.id)]);
  const mv = await loadAssetMovement(client, p.id, true);
  optimistic(mv, p.version, p.updated_at);
  if (mv.status !== 'POSTED') {
    throw new AccountsHttpError('يمكن إلغاء الحركات المرحّلة فقط', 409);
  }
  await acquireAccountingResourceLocks(client, [fixedAssetLock(mv.fixed_asset_id)]);
  const asset = await loadFixedAsset(client, mv.fixed_asset_id, true);

  // استعادة القيم السابقة
  await txQuery(
    client,
    `UPDATE accounts.fixed_assets SET location_id=$2::uuid, department_id=$3::uuid,
       custodian_user_id=$4::uuid, updated_by=$5::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid`,
    [asset.id, mv.from_location_id, mv.from_department_id, mv.from_custodian_user_id, p.userId]
  );

  // إغلاق سجل العهدة الحالي وفتح سجل يعيد القيم السابقة
  const today = pgDateOnly(new Date());
  await txQuery(
    client,
    `UPDATE accounts.asset_custody_history SET to_date=$2::date
     WHERE fixed_asset_id=$1::uuid AND to_date IS NULL`,
    [asset.id, today]
  );
  await txQuery(
    client,
    `INSERT INTO accounts.asset_custody_history
      (fixed_asset_id, movement_id, custodian_user_id, location_id, department_id,
       from_date, change_type, notes, created_by)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::date,'CUSTODY',$7,$8::uuid)`,
    [
      asset.id,
      mv.id,
      mv.from_custodian_user_id,
      mv.from_location_id,
      mv.from_department_id,
      today,
      `استعادة إثر إلغاء الحركة ${mv.movement_number}`,
      p.userId,
    ]
  );

  const r = await txQuery<AssetMovementRow>(
    client,
    `UPDATE accounts.asset_movements SET status='VOIDED', voided_at=NOW(), voided_by=$2::uuid,
       void_reason=$3, updated_by=$2::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [mv.id, p.userId, text(p.reason, 2000)]
  );
  await writeFinancialAudit(client, {
    userId: p.userId,
    action: 'asset_movement.voided',
    entityType: 'asset_movement',
    entityId: mv.id,
    oldValues: { status: 'POSTED' },
    newValues: { status: 'VOIDED', reason: text(p.reason, 2000) },
    description: `إلغاء حركة أصل ${mv.movement_number}`,
    ipAddress: p.ipAddress,
    userAgent: p.userAgent,
  });
  return r.rows[0];
}

export async function listAssetMovements(
  client: TxClient,
  p: {
    fixed_asset_id?: string | null;
    status?: string | null;
    page?: number;
    page_size?: number;
  }
): Promise<{ rows: AssetMovementRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(100, Math.max(1, p.page_size ?? 20));
  const values: unknown[] = [p.fixed_asset_id ?? null, p.status ?? null];
  const where = `WHERE ($1::uuid IS NULL OR fixed_asset_id=$1::uuid)
     AND ($2::text IS NULL OR status=$2)`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.asset_movements ${where}`,
    values
  );
  const r = await txQuery<AssetMovementRow>(
    client,
    `SELECT * FROM accounts.asset_movements ${where} ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}

export async function listAssetCustodyHistory(
  client: TxClient,
  assetId: string
): Promise<Array<Record<string, unknown>>> {
  const r = await txQuery(
    client,
    `SELECT h.*, COALESCE(u.full_name, u.username) AS custodian_name, l.name_ar AS location_name
     FROM accounts.asset_custody_history h
     LEFT JOIN student_affairs.users u ON u.id = h.custodian_user_id
     LEFT JOIN accounts.asset_locations l ON l.id = h.location_id
     WHERE h.fixed_asset_id=$1::uuid
     ORDER BY h.from_date ASC, h.created_at ASC`,
    [assetId]
  );
  return r.rows;
}
