/** محاضر الاستلام — دورة المشتريات 7.A (بدون قيود يومية) */
import {
  acquireAccountingResourceLocks,
  purchaseOrderLineLock,
  purchaseOrderLock,
  purchaseReceiptLock,
} from './accounting-locks';
import { AccountsHttpError } from './auth';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { nextDocumentNumber, pgDateOnly, yearLabelFromDate } from './document-sequences';
import { assertFiscalContextForEntry } from './journal-entries';
import {
  moneyIsPositive,
  moneyIsZero,
  moneyToMillis,
  millisToMoney,
  normalizeMoneyInput,
} from './money';
import {
  derivePoLineStatus,
  loadPurchaseOrder,
  loadPurchaseOrderLine,
  listPurchaseOrderLines,
  refreshPurchaseOrderQuantitiesStatus,
  type PurchaseOrderLineRow,
  type PurchaseOrderRow,
} from './purchase-orders';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PurchaseReceiptStatus = 'DRAFT' | 'POSTED' | 'VOID';

export type PurchaseReceiptRow = {
  id: string;
  receipt_number: string;
  purchase_order_id: string;
  supplier_id: string;
  fiscal_year_id: string;
  fiscal_period_id: string;
  receipt_date: Date | string;
  delivery_reference: string | null;
  received_by: string;
  inspected_by: string | null;
  location: string | null;
  notes: string | null;
  status: PurchaseReceiptStatus;
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

export type PurchaseReceiptLineRow = {
  id: string;
  receipt_id: string;
  purchase_order_line_id: string;
  received_quantity: string;
  accepted_quantity: string;
  rejected_quantity: string;
  rejection_reason: string | null;
  notes: string | null;
  created_at: Date | string;
};

export type PurchaseReceiptLineInput = {
  purchase_order_line_id: unknown;
  received_quantity: unknown;
  accepted_quantity?: unknown;
  rejected_quantity?: unknown;
  rejection_reason?: unknown;
  notes?: unknown;
};

const iso = (v: Date | string | null | undefined) =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
const txt = (v: unknown, n: number) => {
  const s = String(v ?? '').trim().slice(0, n);
  return s || null;
};
const opt = (r: { version: number; updated_at: Date | string }, v: unknown, u: unknown) =>
  assertCashSessionOptimisticConcurrency({
    currentVersion: r.version,
    currentUpdatedAt: r.updated_at,
    expectedVersion: v,
    expectedUpdatedAt: u,
  });

function qtyPositive(v: unknown, label = 'الكمية'): string {
  try {
    const q = normalizeMoneyInput(v);
    if (!moneyIsPositive(q)) throw new Error();
    return q;
  } catch {
    throw new AccountsHttpError(`${label} يجب أن تكون أكبر من صفر`, 400);
  }
}

function qtyNonNeg(v: unknown): string {
  try {
    const q = normalizeMoneyInput(v ?? 0);
    if (moneyToMillis(q) < BigInt(0)) throw new Error();
    return q;
  } catch {
    throw new AccountsHttpError('الكمية يجب أن تكون صفراً أو أكبر', 400);
  }
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
  if (!r.rows[0]) throw new AccountsHttpError('لا توجد فترة مالية مفتوحة تغطي تاريخ الاستلام', 409);
  return r.rows[0];
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
     SELECT 'PURCHASE_RECEIPT',$1::uuid,'PRC',0,6,TRUE,TRUE
     WHERE NOT EXISTS(SELECT 1 FROM accounts.document_sequences WHERE document_type='PURCHASE_RECEIPT' AND fiscal_year_id=$1::uuid)`,
    [yearId]
  );
  return (
    await nextDocumentNumber(c, {
      documentType: 'PURCHASE_RECEIPT',
      fiscalYearId: yearId,
      yearLabel: yearLabelFromDate(y.rows[0].start_date),
    })
  ).formatted;
}

function openQty(line: PurchaseOrderLineRow) {
  return millisToMoney(
    moneyToMillis(normalizeMoneyInput(line.ordered_quantity)) -
      moneyToMillis(normalizeMoneyInput(line.cancelled_quantity)) -
      moneyToMillis(normalizeMoneyInput(line.received_quantity))
  );
}

async function parseReceiptLines(c: TxClient, poId: string, lines: unknown, poLines?: PurchaseOrderLineRow[]) {
  if (!Array.isArray(lines) || !lines.length) throw new AccountsHttpError('يجب إضافة سطر واحد على الأقل', 400);
  const poLineMap = new Map((poLines ?? (await listPurchaseOrderLines(c, poId))).map((l) => [l.id, l]));
  const seen = new Set<string>();
  const parsed = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as PurchaseReceiptLineInput;
    const poLineId = String(raw.purchase_order_line_id ?? '').trim();
    if (!poLineId) throw new AccountsHttpError(`معرّف سطر الأمر مطلوب للسطر ${i + 1}`, 400);
    if (seen.has(poLineId)) throw new AccountsHttpError('سطر أمر مكرر في محضر الاستلام', 400);
    seen.add(poLineId);
    const poLine = poLineMap.get(poLineId);
    if (!poLine || poLine.purchase_order_id !== poId)
      throw new AccountsHttpError(`سطر الأمر ${i + 1} لا ينتمي لهذا الأمر`, 409);
    if (poLine.status === 'CANCELLED' || poLine.status === 'CLOSED')
      throw new AccountsHttpError(`لا يمكن الاستلام على سطر ملغى أو مغلق (سطر الأمر ${poLine.line_number})`, 409);
    const recv = qtyPositive(raw.received_quantity, `الكمية المستلمة للسطر ${i + 1}`);
    const acc = raw.accepted_quantity === undefined ? recv : qtyNonNeg(raw.accepted_quantity);
    const rej = raw.rejected_quantity === undefined ? '0.000' : qtyNonNeg(raw.rejected_quantity);
    if (!moneyIsZero(millisToMoney(moneyToMillis(acc) + moneyToMillis(rej) - moneyToMillis(recv))))
      throw new AccountsHttpError(`المقبول + المرفوض يجب أن يساوي المستلم للسطر ${i + 1}`, 400);
    parsed.push({
      purchase_order_line_id: poLineId,
      received_quantity: recv,
      accepted_quantity: acc,
      rejected_quantity: rej,
      rejection_reason: txt(raw.rejection_reason, 500),
      notes: txt(raw.notes, 2000),
    });
  }
  return parsed;
}

async function replaceReceiptLines(
  c: TxClient,
  receiptId: string,
  lines: Awaited<ReturnType<typeof parseReceiptLines>>
) {
  await txQuery(c, `DELETE FROM accounts.purchase_receipt_lines WHERE receipt_id=$1::uuid`, [receiptId]);
  for (const l of lines) {
    await txQuery(
      c,
      `INSERT INTO accounts.purchase_receipt_lines(
         receipt_id,purchase_order_line_id,received_quantity,accepted_quantity,rejected_quantity,rejection_reason,notes
       ) VALUES($1::uuid,$2::uuid,$3::numeric,$4::numeric,$5::numeric,$6,$7)`,
      [
        receiptId,
        l.purchase_order_line_id,
        l.received_quantity,
        l.accepted_quantity,
        l.rejected_quantity,
        l.rejection_reason,
        l.notes,
      ]
    );
  }
}

/**
 * يسمح بالاستلام طالما الأمر قابل تشغيلياً ولم يُغلق/يُلغَ.
 * يشمل PARTIALLY_INVOICED: سطر واحد قد يُفوتر بينما سطور أخرى ما زالت مفتوحة للاستلام.
 */
function assertPoReceivable(po: PurchaseOrderRow) {
  if (
    !['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'PARTIALLY_INVOICED'].includes(po.status)
  ) {
    throw new AccountsHttpError(
      'لا يمكن الاستلام إلا على أمر معتمد أو قيد الاستلام/الفوترة الجزئية',
      409
    );
  }
}

export function serializePurchaseReceipt(r: PurchaseReceiptRow) {
  return {
    ...r,
    receipt_date: pgDateOnly(r.receipt_date),
    posted_at: iso(r.posted_at),
    voided_at: iso(r.voided_at),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

export function serializePurchaseReceiptLine(r: PurchaseReceiptLineRow) {
  return {
    ...r,
    received_quantity: normalizeMoneyInput(r.received_quantity),
    accepted_quantity: normalizeMoneyInput(r.accepted_quantity),
    rejected_quantity: normalizeMoneyInput(r.rejected_quantity),
    created_at: iso(r.created_at)!,
  };
}

export async function allocatePurchaseReceiptNumber(c: TxClient, fiscalYearId: string) {
  return seq(c, fiscalYearId);
}

export async function loadPurchaseReceipt(c: TxClient, id: string, forUpdate = false) {
  const r = await txQuery<PurchaseReceiptRow>(
    c,
    `SELECT * FROM accounts.purchase_receipts WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('محضر الاستلام غير موجود', 404);
  return r.rows[0];
}

export async function listPurchaseReceiptLines(c: TxClient, receiptId: string) {
  return (
    await txQuery<PurchaseReceiptLineRow>(
      c,
      `SELECT * FROM accounts.purchase_receipt_lines WHERE receipt_id=$1::uuid ORDER BY created_at,id`,
      [receiptId]
    )
  ).rows;
}

export async function listPurchaseReceipts(
  c: TxClient,
  p: {
    q?: string;
    status?: string | null;
    purchase_order_id?: string | null;
    supplier_id?: string | null;
    page?: number;
    page_size?: number;
  }
) {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(100, Math.max(1, p.page_size ?? 20));
  const v = [(p.q ?? '').trim(), p.status ?? null, p.purchase_order_id ?? null, p.supplier_id ?? null];
  const where = `WHERE ($1='' OR pr.receipt_number ILIKE '%'||$1||'%' OR COALESCE(pr.delivery_reference,'') ILIKE '%'||$1||'%')
    AND ($2::text IS NULL OR pr.status=$2) AND ($3::uuid IS NULL OR pr.purchase_order_id=$3::uuid)
    AND ($4::uuid IS NULL OR pr.supplier_id=$4::uuid)`;
  const n = await txQuery<{ total: number }>(
    c,
    `SELECT COUNT(*)::int total FROM accounts.purchase_receipts pr ${where}`,
    v
  );
  const r = await txQuery<PurchaseReceiptRow>(
    c,
    `SELECT pr.* FROM accounts.purchase_receipts pr ${where}
     ORDER BY pr.receipt_date DESC, pr.created_at DESC LIMIT $5 OFFSET $6`,
    [...v, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}

export async function createPurchaseReceipt(
  c: TxClient,
  input: {
    purchase_order_id: unknown;
    receipt_date?: unknown;
    delivery_reference?: unknown;
    received_by: string;
    inspected_by?: unknown;
    location?: unknown;
    notes?: unknown;
    lines: PurchaseReceiptLineInput[];
    created_by: string;
  }
) {
  const poId = String(input.purchase_order_id ?? '').trim();
  if (!poId) throw new AccountsHttpError('أمر الشراء مطلوب', 400);
  const po = await loadPurchaseOrder(c, poId);
  assertPoReceivable(po);
  const date = input.receipt_date ? pgDateOnly(String(input.receipt_date)) : pgDateOnly(new Date());
  const f = await fiscal(c, date);
  await assertFiscalContextForEntry(c, { fiscalYearId: f.year_id, fiscalPeriodId: f.period_id, entryDate: date });
  const parsed = await parseReceiptLines(c, poId, input.lines);
  const r = await txQuery<PurchaseReceiptRow>(
    c,
    `INSERT INTO accounts.purchase_receipts(
       receipt_number,purchase_order_id,supplier_id,fiscal_year_id,fiscal_period_id,receipt_date,
       delivery_reference,received_by,inspected_by,location,notes,status,created_by,updated_by
     ) VALUES($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::date,$7,$8::uuid,$9::uuid,$10,$11,'DRAFT',$12::uuid,$12::uuid)
     RETURNING *`,
    [
      await seq(c, f.year_id),
      poId,
      po.supplier_id,
      f.year_id,
      f.period_id,
      date,
      txt(input.delivery_reference, 100),
      input.received_by,
      txt(input.inspected_by, 100),
      txt(input.location, 500),
      txt(input.notes, 2000),
      input.created_by,
    ]
  );
  await replaceReceiptLines(c, r.rows[0]!.id, parsed);
  return loadPurchaseReceipt(c, r.rows[0]!.id);
}

export async function updatePurchaseReceipt(
  c: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    receipt_date?: unknown;
    delivery_reference?: unknown;
    inspected_by?: unknown;
    location?: unknown;
    notes?: unknown;
    lines?: PurchaseReceiptLineInput[];
  }
) {
  await acquireAccountingResourceLocks(c, [purchaseReceiptLock(p.id)]);
  const row = await loadPurchaseReceipt(c, p.id, true);
  opt(row, p.version, p.updated_at);
  if (row.status !== 'DRAFT') throw new AccountsHttpError('يمكن تعديل مسودات محاضر الاستلام فقط', 409);
  const date = p.receipt_date === undefined ? pgDateOnly(row.receipt_date) : pgDateOnly(String(p.receipt_date));
  const f = await fiscal(c, date);
  await assertFiscalContextForEntry(c, { fiscalYearId: f.year_id, fiscalPeriodId: f.period_id, entryDate: date });
  if (p.lines !== undefined) {
    const parsed = await parseReceiptLines(c, row.purchase_order_id, p.lines);
    await replaceReceiptLines(c, row.id, parsed);
  }
  const u = await txQuery<PurchaseReceiptRow>(
    c,
    `UPDATE accounts.purchase_receipts SET
       receipt_date=$2::date,fiscal_year_id=$3::uuid,fiscal_period_id=$4::uuid,
       delivery_reference=$5,inspected_by=$6::uuid,location=$7,notes=$8,
       updated_by=$9::uuid,updated_at=NOW(),version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [
      row.id,
      date,
      f.year_id,
      f.period_id,
      p.delivery_reference === undefined ? row.delivery_reference : txt(p.delivery_reference, 100),
      p.inspected_by === undefined ? row.inspected_by : txt(p.inspected_by, 100),
      p.location === undefined ? row.location : txt(p.location, 500),
      p.notes === undefined ? row.notes : txt(p.notes, 2000),
      p.userId,
    ]
  );
  return u.rows[0]!;
}

/**
 * سياسة SERVICE في 7.A: نفس معادلات الكمية العشرية لـ NON_STOCK_ITEM
 * (استلام جزئي مسموح مثل 0.500 من 1.000). الوحدة نص حر (SERVICE/MONTH/JOB…).
 * لا نموذج نسبة مئوية.
 */
let __fault: null | 'after_first_po_line' | 'after_po_update' | 'after_receipt_posted' = null;
export const setPurchaseReceiptPostFaultForTests = (v: typeof __fault) => {
  __fault = v;
};

let __voidFault: null | 'after_po_reverse' = null;
export const setPurchaseReceiptVoidFaultForTests = (v: typeof __voidFault) => {
  __voidFault = v;
};

export async function postPurchaseReceipt(
  c: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown }
) {
  const peek = await loadPurchaseReceipt(c, p.id);
  if (peek.status === 'POSTED') return { receipt: peek, created: false };
  const peekLines = await listPurchaseReceiptLines(c, p.id);
  await acquireAccountingResourceLocks(c, [
    purchaseReceiptLock(p.id),
    purchaseOrderLock(peek.purchase_order_id),
    ...peekLines.map((l) => purchaseOrderLineLock(l.purchase_order_line_id)),
  ]);
  const row = await loadPurchaseReceipt(c, p.id, true);
  opt(row, p.version, p.updated_at);
  if (row.status === 'POSTED') return { receipt: row, created: false };
  if (row.status !== 'DRAFT') throw new AccountsHttpError('يمكن ترحيل مسودات محاضر الاستلام فقط', 409);
  const po = await loadPurchaseOrder(c, row.purchase_order_id, true);
  assertPoReceivable(po);
  const lines = await listPurchaseReceiptLines(c, row.id);
  if (!lines.length) throw new AccountsHttpError('لا يمكن ترحيل محضر بلا سطور', 409);
  let lineIndex = 0;
  for (const rl of lines) {
    const poLine = await loadPurchaseOrderLine(c, rl.purchase_order_line_id, true);
    const remaining = openQty(poLine);
    if (moneyToMillis(normalizeMoneyInput(rl.received_quantity)) > moneyToMillis(remaining))
      throw new AccountsHttpError(`الكمية المستلمة تتجاوز المتبقي في سطر الأمر ${poLine.line_number}`, 409);
    const newRecv = millisToMoney(
      moneyToMillis(normalizeMoneyInput(poLine.received_quantity)) +
        moneyToMillis(normalizeMoneyInput(rl.received_quantity))
    );
    const newAcc = millisToMoney(
      moneyToMillis(normalizeMoneyInput(poLine.accepted_quantity)) +
        moneyToMillis(normalizeMoneyInput(rl.accepted_quantity))
    );
    const newRej = millisToMoney(
      moneyToMillis(normalizeMoneyInput(poLine.rejected_quantity)) +
        moneyToMillis(normalizeMoneyInput(rl.rejected_quantity))
    );
    const st = derivePoLineStatus({
      ...poLine,
      received_quantity: newRecv,
      accepted_quantity: newAcc,
      rejected_quantity: newRej,
    });
    await txQuery(
      c,
      `UPDATE accounts.purchase_order_lines SET received_quantity=$2::numeric,accepted_quantity=$3::numeric,
         rejected_quantity=$4::numeric,status=$5,updated_at=NOW() WHERE id=$1::uuid`,
      [poLine.id, newRecv, newAcc, newRej, st]
    );
    lineIndex += 1;
    if (lineIndex === 1 && __fault === 'after_first_po_line') throw new Error('FAULT_AFTER_FIRST_PO_LINE');
  }
  await refreshPurchaseOrderQuantitiesStatus(c, row.purchase_order_id);
  if (__fault === 'after_po_update') throw new Error('FAULT_AFTER_PO_UPDATE');
  const u = await txQuery<PurchaseReceiptRow>(
    c,
    `UPDATE accounts.purchase_receipts SET status='POSTED',posted_by=$2::uuid,posted_at=NOW(),
       updated_by=$2::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
    [row.id, p.userId]
  );
  if (__fault === 'after_receipt_posted') throw new Error('FAULT_AFTER_RECEIPT_POSTED');
  return { receipt: u.rows[0]!, created: true };
}

export async function voidPurchaseReceipt(
  c: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown; reason?: unknown }
) {
  const peek = await loadPurchaseReceipt(c, p.id);
  if (peek.status === 'VOID') return peek;
  if (peek.status === 'DRAFT') {
    const row = await loadPurchaseReceipt(c, p.id, true);
    opt(row, p.version, p.updated_at);
    if (row.status === 'VOID') return row;
    if (row.status !== 'DRAFT') throw new AccountsHttpError('حالة المحضر لا تسمح بالإلغاء', 409);
    const u = await txQuery<PurchaseReceiptRow>(
      c,
      `UPDATE accounts.purchase_receipts SET status='VOID',void_reason=$2,voided_by=$3::uuid,voided_at=NOW(),
         updated_by=$3::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
      [row.id, txt(p.reason, 2000) ?? 'إلغاء مسودة', p.userId]
    );
    return u.rows[0]!;
  }
  if (peek.status !== 'POSTED') throw new AccountsHttpError('حالة المحضر لا تسمح بالإلغاء', 409);
  const reason = txt(p.reason, 2000);
  if (!reason) throw new AccountsHttpError('سبب الإلغاء مطلوب للمحضر المرحّل', 400);
  const peekLines = await listPurchaseReceiptLines(c, p.id);
  await acquireAccountingResourceLocks(c, [
    purchaseReceiptLock(p.id),
    purchaseOrderLock(peek.purchase_order_id),
    ...peekLines.map((l) => purchaseOrderLineLock(l.purchase_order_line_id)),
  ]);
  const row = await loadPurchaseReceipt(c, p.id, true);
  opt(row, p.version, p.updated_at);
  if (row.status === 'VOID') return row;
  if (row.status !== 'POSTED') throw new AccountsHttpError('حالة المحضر لا تسمح بالإلغاء', 409);
  const lines = await listPurchaseReceiptLines(c, row.id);
  for (const rl of lines) {
    const poLine = await loadPurchaseOrderLine(c, rl.purchase_order_line_id, true);
    const newRecv = millisToMoney(
      moneyToMillis(normalizeMoneyInput(poLine.received_quantity)) -
        moneyToMillis(normalizeMoneyInput(rl.received_quantity))
    );
    const newAcc = millisToMoney(
      moneyToMillis(normalizeMoneyInput(poLine.accepted_quantity)) -
        moneyToMillis(normalizeMoneyInput(rl.accepted_quantity))
    );
    const newRej = millisToMoney(
      moneyToMillis(normalizeMoneyInput(poLine.rejected_quantity)) -
        moneyToMillis(normalizeMoneyInput(rl.rejected_quantity))
    );
    if (moneyToMillis(newRecv) < BigInt(0) || moneyToMillis(newAcc) < BigInt(0) || moneyToMillis(newRej) < BigInt(0))
      throw new AccountsHttpError('عكس الاستلام يؤدي لكميات سالبة على أمر الشراء', 409);
    if (moneyToMillis(normalizeMoneyInput(poLine.invoiced_quantity)) > moneyToMillis(newAcc))
      throw new AccountsHttpError(
        'لا يمكن إبطال المحضر: الكمية المفوترة تتجاوز المقبول بعد العكس',
        409
      );
    const st = derivePoLineStatus({
      ...poLine,
      received_quantity: newRecv,
      accepted_quantity: newAcc,
      rejected_quantity: newRej,
    });
    await txQuery(
      c,
      `UPDATE accounts.purchase_order_lines SET received_quantity=$2::numeric,accepted_quantity=$3::numeric,
         rejected_quantity=$4::numeric,status=$5,updated_at=NOW() WHERE id=$1::uuid`,
      [poLine.id, newRecv, newAcc, newRej, st]
    );
  }
  await refreshPurchaseOrderQuantitiesStatus(c, row.purchase_order_id);
  if (__voidFault === 'after_po_reverse') throw new Error('FAULT_AFTER_PO_REVERSE');
  const u = await txQuery<PurchaseReceiptRow>(
    c,
    `UPDATE accounts.purchase_receipts SET status='VOID',void_reason=$2,voided_by=$3::uuid,voided_at=NOW(),
       updated_by=$3::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
    [row.id, reason, p.userId]
  );
  return u.rows[0]!;
}
