/** طلبات الشراء — دورة المشتريات 7.A (بدون قيود يومية) */
import { acquireAccountingResourceLocks, purchaseRequisitionLock } from './accounting-locks';
import { AccountsHttpError } from './auth';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { normalizeCurrencyCode } from './currency';
import { nextDocumentNumber, pgDateOnly, yearLabelFromDate } from './document-sequences';
import { assertFiscalContextForEntry } from './journal-entries';
import {
  moneyEquals,
  moneyIsPositive,
  moneyToMillis,
  millisToMoney,
  normalizeMoneyInput,
  normalizeSignedMoneyInput,
  moneyToMillisSigned,
  sumMoney,
} from './money';
import { assertValidExpenseGlAccount } from './supplier-invoice-types';
import { loadSupplier } from './suppliers';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PurchaseRequisitionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PARTIALLY_ORDERED'
  | 'ORDERED'
  | 'CANCELLED';

export type PurchaseRequisitionPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type PurchaseKind =
  | 'SERVICE'
  | 'NON_STOCK_ITEM'
  | 'FIXED_ASSET_CANDIDATE'
  | 'OTHER';

export type PurchaseRequisitionRow = {
  id: string;
  requisition_number: string;
  requisition_date: Date | string;
  requesting_department_id: string | null;
  requested_by: string;
  fiscal_year_id: string;
  fiscal_period_id: string;
  currency_code: string;
  justification: string;
  needed_by_date: Date | string | null;
  priority: PurchaseRequisitionPriority;
  status: PurchaseRequisitionStatus;
  total_estimated_amount: string;
  submitted_at: Date | string | null;
  submitted_by: string | null;
  approved_at: Date | string | null;
  approved_by: string | null;
  rejected_at: Date | string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  cancelled_at: Date | string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  version: number;
};

export type PurchaseRequisitionLineRow = {
  id: string;
  requisition_id: string;
  line_number: number;
  purchase_kind: PurchaseKind;
  item_code: string | null;
  description: string;
  unit_of_measure: string;
  requested_quantity: string;
  estimated_unit_price: string;
  estimated_total: string;
  suggested_supplier_id: string | null;
  expense_gl_account_id: string | null;
  cost_center_id: string | null;
  ordered_quantity: string;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type PurchaseRequisitionLineInput = {
  purchase_kind: unknown;
  item_code?: unknown;
  description: unknown;
  unit_of_measure?: unknown;
  requested_quantity: unknown;
  estimated_unit_price?: unknown;
  suggested_supplier_id?: unknown;
  expense_gl_account_id?: unknown;
  cost_center_id?: unknown;
  notes?: unknown;
};

const KINDS = new Set<PurchaseKind>([
  'SERVICE',
  'NON_STOCK_ITEM',
  'FIXED_ASSET_CANDIDATE',
  'OTHER',
]);
const PRIORITIES = new Set<PurchaseRequisitionPriority>([
  'LOW',
  'NORMAL',
  'HIGH',
  'URGENT',
]);

const iso = (v: Date | string | null | undefined) =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
const txt = (v: unknown, n: number) => {
  const s = String(v ?? '').trim().slice(0, n);
  return s || null;
};
const opt = (r: PurchaseRequisitionRow, v: unknown, u: unknown) =>
  assertCashSessionOptimisticConcurrency({
    currentVersion: r.version,
    currentUpdatedAt: r.updated_at,
    expectedVersion: v,
    expectedUpdatedAt: u,
  });
const iqd = (v: unknown) => {
  const c = normalizeCurrencyCode(v, 'IQD');
  if (c !== 'IQD') throw new AccountsHttpError('عملة طلب الشراء هي IQD فقط', 400);
  return c;
};
const roundProduct = (a: string, b: string) =>
  millisToMoney((moneyToMillis(a) * moneyToMillis(b) + BigInt(500)) / BigInt(1000));

function qtyPositive(v: unknown, label = 'الكمية'): string {
  try {
    const q = normalizeMoneyInput(v);
    if (!moneyIsPositive(q)) throw new Error();
    return q;
  } catch {
    throw new AccountsHttpError(`${label} يجب أن تكون أكبر من صفر`, 400);
  }
}

function priceNonNeg(v: unknown): string {
  try {
    const p = normalizeMoneyInput(v ?? 0);
    if (moneyToMillis(p) < BigInt(0)) throw new Error();
    return p;
  } catch {
    throw new AccountsHttpError('سعر الوحدة يجب أن يكون صفراً أو أكبر', 400);
  }
}

function assertKind(v: unknown): PurchaseKind {
  const k = String(v ?? '').trim().toUpperCase() as PurchaseKind;
  if (!KINDS.has(k)) throw new AccountsHttpError('نوع الشراء غير صالح', 400);
  return k;
}

function assertPriority(v: unknown): PurchaseRequisitionPriority {
  const p = String(v ?? 'NORMAL').trim().toUpperCase() as PurchaseRequisitionPriority;
  if (!PRIORITIES.has(p)) throw new AccountsHttpError('أولوية الطلب غير صالحة', 400);
  return p;
}

async function fiscal(c: TxClient, d: string) {
  const r = await txQuery<{ year_id: string; period_id: string }>(
    c,
    `SELECT y.id year_id,p.id period_id FROM accounts.fiscal_years y
     JOIN accounts.fiscal_periods p ON p.fiscal_year_id=y.id
     WHERE y.status='ACTIVE' AND p.status='OPEN'
       AND p.start_date<=$1::date AND p.end_date>=$1::date
     ORDER BY y.is_default DESC,p.start_date LIMIT 1`,
    [d]
  );
  if (!r.rows[0]) throw new AccountsHttpError('لا توجد فترة مالية مفتوحة تغطي تاريخ الطلب', 409);
  return r.rows[0];
}

async function cc(c: TxClient, id: string | null) {
  if (!id) return;
  const r = await txQuery(c, `SELECT 1 FROM accounts.cost_centers WHERE id=$1::uuid AND is_active=TRUE`, [id]);
  if (!r.rows[0]) throw new AccountsHttpError('مركز الكلفة غير موجود أو غير فعّال', 400);
}

async function validateLine(c: TxClient, line: PurchaseRequisitionLineInput, n: number) {
  const kind = assertKind(line.purchase_kind);
  const desc = txt(line.description, 2000);
  if (!desc) throw new AccountsHttpError(`وصف السطر ${n} مطلوب`, 400);
  const qty = qtyPositive(line.requested_quantity, `كمية السطر ${n}`);
  const price = priceNonNeg(line.estimated_unit_price ?? 0);
  const total = roundProduct(qty, price);
  const gl = txt(line.expense_gl_account_id, 100);
  if (gl) await assertValidExpenseGlAccount(c, gl);
  const supplier = txt(line.suggested_supplier_id, 100);
  if (supplier) await loadSupplier(c, supplier);
  const center = txt(line.cost_center_id, 100);
  await cc(c, center);
  return {
    line_number: n,
    purchase_kind: kind,
    item_code: txt(line.item_code, 80),
    description: desc,
    unit_of_measure: txt(line.unit_of_measure, 40) ?? 'UNIT',
    requested_quantity: qty,
    estimated_unit_price: price,
    estimated_total: total,
    suggested_supplier_id: supplier,
    expense_gl_account_id: gl,
    cost_center_id: center,
    notes: txt(line.notes, 2000),
  };
}

async function parseLines(c: TxClient, lines: unknown) {
  if (!Array.isArray(lines) || !lines.length)
    throw new AccountsHttpError('يجب إضافة سطر واحد على الأقل', 400);
  const parsed = [];
  for (let i = 0; i < lines.length; i++) parsed.push(await validateLine(c, lines[i] as PurchaseRequisitionLineInput, i + 1));
  return parsed;
}

async function replaceLines(
  c: TxClient,
  reqId: string,
  lines: Awaited<ReturnType<typeof parseLines>>
) {
  await txQuery(c, `DELETE FROM accounts.purchase_requisition_lines WHERE requisition_id=$1::uuid`, [reqId]);
  for (const l of lines) {
    await txQuery(
      c,
      `INSERT INTO accounts.purchase_requisition_lines(
         requisition_id,line_number,purchase_kind,item_code,description,unit_of_measure,
         requested_quantity,estimated_unit_price,estimated_total,suggested_supplier_id,
         expense_gl_account_id,cost_center_id,notes
       ) VALUES($1::uuid,$2,$3,$4,$5,$6,$7::numeric,$8::numeric,$9::numeric,$10::uuid,$11::uuid,$12::uuid,$13)`,
      [
        reqId,
        l.line_number,
        l.purchase_kind,
        l.item_code,
        l.description,
        l.unit_of_measure,
        l.requested_quantity,
        l.estimated_unit_price,
        l.estimated_total,
        l.suggested_supplier_id,
        l.expense_gl_account_id,
        l.cost_center_id,
        l.notes,
      ]
    );
  }
  return sumMoney(lines.map((x) => x.estimated_total));
}

async function seq(c: TxClient, yearId: string) {
  const y = await txQuery<{ start_date: string }>(
    c,
    `SELECT start_date::text start_date FROM accounts.fiscal_years WHERE id=$1::uuid`,
    [yearId]
  );
  if (!y.rows[0]) throw new AccountsHttpError('السنة المالية غير موجودة', 404);
  await txQuery(
    c,
    `INSERT INTO accounts.document_sequences(document_type,fiscal_year_id,prefix,current_number,padding_length,reset_yearly,is_active)
     SELECT 'PURCHASE_REQUISITION',$1::uuid,'PRQ',0,6,TRUE,TRUE
     WHERE NOT EXISTS(SELECT 1 FROM accounts.document_sequences WHERE document_type='PURCHASE_REQUISITION' AND fiscal_year_id=$1::uuid)`,
    [yearId]
  );
  return (
    await nextDocumentNumber(c, {
      documentType: 'PURCHASE_REQUISITION',
      fiscalYearId: yearId,
      yearLabel: yearLabelFromDate(y.rows[0].start_date),
    })
  ).formatted;
}

export function serializePurchaseRequisition(r: PurchaseRequisitionRow) {
  return {
    ...r,
    requisition_date: pgDateOnly(r.requisition_date),
    needed_by_date: r.needed_by_date ? pgDateOnly(r.needed_by_date) : null,
    total_estimated_amount: normalizeMoneyInput(r.total_estimated_amount),
    submitted_at: iso(r.submitted_at),
    approved_at: iso(r.approved_at),
    rejected_at: iso(r.rejected_at),
    cancelled_at: iso(r.cancelled_at),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

export function serializePurchaseRequisitionLine(r: PurchaseRequisitionLineRow) {
  return {
    ...r,
    requested_quantity: normalizeMoneyInput(r.requested_quantity),
    estimated_unit_price: normalizeMoneyInput(r.estimated_unit_price),
    estimated_total: normalizeMoneyInput(r.estimated_total),
    ordered_quantity: normalizeMoneyInput(r.ordered_quantity),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

export async function allocatePurchaseRequisitionNumber(c: TxClient, fiscalYearId: string) {
  return seq(c, fiscalYearId);
}

export async function loadPurchaseRequisition(c: TxClient, id: string, forUpdate = false) {
  const r = await txQuery<PurchaseRequisitionRow>(
    c,
    `SELECT * FROM accounts.purchase_requisitions WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('طلب الشراء غير موجود', 404);
  return r.rows[0];
}

export async function listPurchaseRequisitionLines(c: TxClient, requisitionId: string) {
  return (
    await txQuery<PurchaseRequisitionLineRow>(
      c,
      `SELECT * FROM accounts.purchase_requisition_lines WHERE requisition_id=$1::uuid ORDER BY line_number`,
      [requisitionId]
    )
  ).rows;
}

export async function listPurchaseRequisitions(
  c: TxClient,
  p: {
    q?: string;
    status?: string | null;
    requested_by?: string | null;
    page?: number;
    page_size?: number;
  }
) {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(100, Math.max(1, p.page_size ?? 20));
  const v = [(p.q ?? '').trim(), p.status ?? null, p.requested_by ?? null];
  const where = `WHERE ($1='' OR pr.requisition_number ILIKE '%'||$1||'%' OR pr.justification ILIKE '%'||$1||'%')
    AND ($2::text IS NULL OR pr.status=$2) AND ($3::uuid IS NULL OR pr.requested_by=$3::uuid)`;
  const n = await txQuery<{ total: number }>(
    c,
    `SELECT COUNT(*)::int total FROM accounts.purchase_requisitions pr ${where}`,
    v
  );
  const r = await txQuery<PurchaseRequisitionRow>(
    c,
    `SELECT pr.* FROM accounts.purchase_requisitions pr ${where}
     ORDER BY pr.requisition_date DESC, pr.created_at DESC LIMIT $4 OFFSET $5`,
    [...v, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}

/** يشتق حالة الطلب من كميات الأمر (APPROVED → PARTIALLY_ORDERED / ORDERED) */
export async function recalculateRequisitionStatus(c: TxClient, requisitionId: string) {
  const req = await loadPurchaseRequisition(c, requisitionId, true);
  if (!['APPROVED', 'PARTIALLY_ORDERED', 'ORDERED'].includes(req.status)) return req;
  const lines = await listPurchaseRequisitionLines(c, requisitionId);
  if (!lines.length) return req;
  let anyOrdered = false;
  let allFullyOrdered = true;
  for (const l of lines) {
    const ord = normalizeMoneyInput(l.ordered_quantity);
    const reqQty = normalizeMoneyInput(l.requested_quantity);
    if (moneyIsPositive(ord)) anyOrdered = true;
    if (!moneyEquals(ord, reqQty)) allFullyOrdered = false;
  }
  let next: PurchaseRequisitionStatus = 'APPROVED';
  if (anyOrdered && allFullyOrdered) next = 'ORDERED';
  else if (anyOrdered) next = 'PARTIALLY_ORDERED';
  if (next === req.status) return req;
  const u = await txQuery<PurchaseRequisitionRow>(
    c,
    `UPDATE accounts.purchase_requisitions SET status=$2,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
    [requisitionId, next]
  );
  return u.rows[0]!;
}

/** يزيد ordered_quantity على سطر الطلب ويعيد حساب الحالة — للاستخدام من أمر الشراء */
export async function updateRequisitionOrderedQuantities(
  c: TxClient,
  updates: Array<{ requisition_line_id: string; delta: string }>
) {
  if (!updates.length) return;
  const reqIds = new Set<string>();
  for (const u of updates) {
    const delta = normalizeSignedMoneyInput(u.delta);
    if (moneyToMillisSigned(delta) === BigInt(0)) continue;
    const line = await txQuery<PurchaseRequisitionLineRow>(
      c,
      `SELECT * FROM accounts.purchase_requisition_lines WHERE id=$1::uuid FOR UPDATE`,
      [u.requisition_line_id]
    );
    if (!line.rows[0]) throw new AccountsHttpError('سطر طلب الشراء غير موجود', 404);
    const row = line.rows[0];
    reqIds.add(row.requisition_id);
    const newOrd = millisToMoney(
      moneyToMillis(normalizeMoneyInput(row.ordered_quantity)) + moneyToMillisSigned(delta)
    );
    const max = normalizeMoneyInput(row.requested_quantity);
    if (moneyToMillis(newOrd) > moneyToMillis(max))
      throw new AccountsHttpError('الكمية المطلوبة في أمر الشراء تتجاوز المتبقي في طلب الشراء', 409);
    if (moneyToMillis(newOrd) < BigInt(0))
      throw new AccountsHttpError('لا يمكن أن تصبح الكمية المطلوبة سالبة', 409);
    await txQuery(
      c,
      `UPDATE accounts.purchase_requisition_lines SET ordered_quantity=$2::numeric,updated_at=NOW() WHERE id=$1::uuid`,
      [row.id, newOrd]
    );
  }
  for (const id of reqIds) await recalculateRequisitionStatus(c, id);
}

export async function createPurchaseRequisition(
  c: TxClient,
  input: {
    requisition_date?: unknown;
    requesting_department_id?: unknown;
    requested_by: string;
    justification: unknown;
    needed_by_date?: unknown;
    priority?: unknown;
    currency_code?: unknown;
    lines: PurchaseRequisitionLineInput[];
    created_by: string;
  }
) {
  const justification = txt(input.justification, 4000);
  if (!justification) throw new AccountsHttpError('مبرر الطلب مطلوب', 400);
  const date = input.requisition_date ? pgDateOnly(String(input.requisition_date)) : pgDateOnly(new Date());
  const f = await fiscal(c, date);
  await assertFiscalContextForEntry(c, { fiscalYearId: f.year_id, fiscalPeriodId: f.period_id, entryDate: date });
  const parsed = await parseLines(c, input.lines);
  const total = sumMoney(parsed.map((x) => x.estimated_total));
  const r = await txQuery<PurchaseRequisitionRow>(
    c,
    `INSERT INTO accounts.purchase_requisitions(
       requisition_number,requisition_date,requesting_department_id,requested_by,
       fiscal_year_id,fiscal_period_id,currency_code,justification,needed_by_date,priority,
       total_estimated_amount,status,created_by,updated_by
     ) VALUES($1,$2::date,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9::date,$10,$11::numeric,'DRAFT',$12::uuid,$12::uuid)
     RETURNING *`,
    [
      await seq(c, f.year_id),
      date,
      txt(input.requesting_department_id, 100),
      input.requested_by,
      f.year_id,
      f.period_id,
      iqd(input.currency_code),
      justification,
      input.needed_by_date ? pgDateOnly(String(input.needed_by_date)) : null,
      assertPriority(input.priority),
      total,
      input.created_by,
    ]
  );
  await replaceLines(c, r.rows[0]!.id, parsed);
  return loadPurchaseRequisition(c, r.rows[0]!.id);
}

export async function updatePurchaseRequisition(
  c: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    requisition_date?: unknown;
    requesting_department_id?: unknown;
    justification?: unknown;
    needed_by_date?: unknown;
    priority?: unknown;
    lines?: PurchaseRequisitionLineInput[];
  }
) {
  await acquireAccountingResourceLocks(c, [purchaseRequisitionLock(p.id)]);
  const row = await loadPurchaseRequisition(c, p.id, true);
  opt(row, p.version, p.updated_at);
  if (row.status !== 'DRAFT') throw new AccountsHttpError('يمكن تعديل مسودات طلبات الشراء فقط', 409);
  const date = p.requisition_date === undefined ? pgDateOnly(row.requisition_date) : pgDateOnly(String(p.requisition_date));
  const f = await fiscal(c, date);
  await assertFiscalContextForEntry(c, { fiscalYearId: f.year_id, fiscalPeriodId: f.period_id, entryDate: date });
  let total = normalizeMoneyInput(row.total_estimated_amount);
  if (p.lines !== undefined) {
    const parsed = await parseLines(c, p.lines);
    total = await replaceLines(c, row.id, parsed);
  }
  const justification =
    p.justification === undefined ? row.justification : txt(p.justification, 4000) ?? row.justification;
  if (!justification) throw new AccountsHttpError('مبرر الطلب مطلوب', 400);
  const u = await txQuery<PurchaseRequisitionRow>(
    c,
    `UPDATE accounts.purchase_requisitions SET
       requisition_date=$2::date,fiscal_year_id=$3::uuid,fiscal_period_id=$4::uuid,
       requesting_department_id=$5::uuid,justification=$6,needed_by_date=$7::date,priority=$8,
       total_estimated_amount=$9::numeric,updated_by=$10::uuid,updated_at=NOW(),version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [
      row.id,
      date,
      f.year_id,
      f.period_id,
      p.requesting_department_id === undefined
        ? row.requesting_department_id
        : txt(p.requesting_department_id, 100),
      justification,
      p.needed_by_date === undefined
        ? row.needed_by_date
          ? pgDateOnly(row.needed_by_date)
          : null
        : p.needed_by_date
          ? pgDateOnly(String(p.needed_by_date))
          : null,
      p.priority === undefined ? row.priority : assertPriority(p.priority),
      total,
      p.userId,
    ]
  );
  return u.rows[0]!;
}

export async function submitPurchaseRequisition(
  c: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown }
) {
  await acquireAccountingResourceLocks(c, [purchaseRequisitionLock(p.id)]);
  const row = await loadPurchaseRequisition(c, p.id, true);
  opt(row, p.version, p.updated_at);
  if (row.status !== 'DRAFT') throw new AccountsHttpError('يمكن تقديم مسودات طلبات الشراء فقط', 409);
  const lines = await listPurchaseRequisitionLines(c, p.id);
  if (!lines.length) throw new AccountsHttpError('لا يمكن تقديم طلب بلا سطور', 409);
  const u = await txQuery<PurchaseRequisitionRow>(
    c,
    `UPDATE accounts.purchase_requisitions SET status='SUBMITTED',submitted_by=$2::uuid,submitted_at=NOW(),
       updated_by=$2::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
    [p.id, p.userId]
  );
  return u.rows[0]!;
}

export async function approvePurchaseRequisition(
  c: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown }
) {
  await acquireAccountingResourceLocks(c, [purchaseRequisitionLock(p.id)]);
  const row = await loadPurchaseRequisition(c, p.id, true);
  opt(row, p.version, p.updated_at);
  if (row.status !== 'SUBMITTED') throw new AccountsHttpError('يمكن اعتماد طلبات الشراء المقدّمة فقط', 409);
  const u = await txQuery<PurchaseRequisitionRow>(
    c,
    `UPDATE accounts.purchase_requisitions SET status='APPROVED',approved_by=$2::uuid,approved_at=NOW(),
       updated_by=$2::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
    [p.id, p.userId]
  );
  return u.rows[0]!;
}

export async function rejectPurchaseRequisition(
  c: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown; reason?: unknown }
) {
  await acquireAccountingResourceLocks(c, [purchaseRequisitionLock(p.id)]);
  const row = await loadPurchaseRequisition(c, p.id, true);
  opt(row, p.version, p.updated_at);
  if (row.status !== 'SUBMITTED') throw new AccountsHttpError('يمكن رفض طلبات الشراء المقدّمة فقط', 409);
  const reason = txt(p.reason, 2000);
  if (!reason) throw new AccountsHttpError('سبب الرفض مطلوب', 400);
  const u = await txQuery<PurchaseRequisitionRow>(
    c,
    `UPDATE accounts.purchase_requisitions SET status='REJECTED',rejected_by=$2::uuid,rejected_at=NOW(),
       rejection_reason=$3,updated_by=$2::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
    [p.id, p.userId, reason]
  );
  return u.rows[0]!;
}

export async function cancelPurchaseRequisition(
  c: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown; reason?: unknown }
) {
  await acquireAccountingResourceLocks(c, [purchaseRequisitionLock(p.id)]);
  const row = await loadPurchaseRequisition(c, p.id, true);
  opt(row, p.version, p.updated_at);
  if (!['DRAFT', 'SUBMITTED', 'APPROVED'].includes(row.status))
    throw new AccountsHttpError('حالة الطلب لا تسمح بالإلغاء', 409);
  if (row.status === 'APPROVED') {
    const lines = await listPurchaseRequisitionLines(c, p.id);
    for (const l of lines) {
      if (moneyIsPositive(normalizeMoneyInput(l.ordered_quantity)))
        throw new AccountsHttpError('لا يمكن إلغاء طلب مرتبط بأوامر شراء', 409);
    }
  }
  const u = await txQuery<PurchaseRequisitionRow>(
    c,
    `UPDATE accounts.purchase_requisitions SET status='CANCELLED',cancelled_by=$2::uuid,cancelled_at=NOW(),
       cancellation_reason=$3,updated_by=$2::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
    [p.id, p.userId, txt(p.reason, 2000) ?? 'إلغاء طلب شراء']
  );
  return u.rows[0]!;
}
