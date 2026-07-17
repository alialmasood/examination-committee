/** أوامر الشراء — دورة المشتريات 7.A (بدون قيود يومية) */
import {
  acquireAccountingResourceLocks,
  purchaseOrderLock,
  purchaseRequisitionLineLock,
  purchaseRequisitionLock,
  supplierAccountLock,
  supplierLock,
} from './accounting-locks';
import { AccountsHttpError } from './auth';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { normalizeCurrencyCode } from './currency';
import { nextDocumentNumber, pgDateOnly, yearLabelFromDate } from './document-sequences';
import { assertFiscalContextForEntry } from './journal-entries';
import {
  moneyIsPositive,
  moneyIsZero,
  moneyToMillis,
  millisToMoney,
  normalizeMoneyInput,
  sumMoney,
} from './money';
import {
  loadPurchaseRequisition,
  listPurchaseRequisitionLines,
  type PurchaseKind,
  type PurchaseRequisitionLineRow,
  updateRequisitionOrderedQuantities,
} from './purchase-requisitions';
import { loadSupplierAccount } from './supplier-accounts';
import { assertValidExpenseGlAccount } from './supplier-invoice-types';
import { loadSupplier } from './suppliers';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'PARTIALLY_INVOICED'
  | 'INVOICED'
  | 'CLOSED'
  | 'CANCELLED'
  | 'REJECTED';

export type PurchaseOrderLineStatus =
  | 'OPEN'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'PARTIALLY_INVOICED'
  | 'INVOICED'
  | 'CANCELLED'
  | 'CLOSED';

export type PurchaseOrderRow = {
  id: string;
  purchase_order_number: string;
  supplier_id: string;
  supplier_account_id: string;
  requisition_id: string | null;
  fiscal_year_id: string;
  fiscal_period_id: string;
  order_date: Date | string;
  expected_delivery_date: Date | string | null;
  currency_code: string;
  payment_terms_days: number;
  delivery_location: string | null;
  description: string;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  status: PurchaseOrderStatus;
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
  closed_at: Date | string | null;
  closed_by: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  version: number;
};

export type PurchaseOrderLineRow = {
  id: string;
  purchase_order_id: string;
  requisition_line_id: string | null;
  line_number: number;
  purchase_kind: PurchaseKind;
  item_code: string | null;
  description: string;
  unit_of_measure: string;
  ordered_quantity: string;
  unit_price: string;
  discount_amount: string;
  tax_amount: string;
  line_total: string;
  expense_gl_account_id: string;
  cost_center_id: string | null;
  received_quantity: string;
  accepted_quantity: string;
  rejected_quantity: string;
  invoiced_quantity: string;
  cancelled_quantity: string;
  status: PurchaseOrderLineStatus;
  created_at: Date | string;
  updated_at: Date | string;
};

export type PurchaseOrderLineInput = {
  purchase_kind: unknown;
  item_code?: unknown;
  description: unknown;
  unit_of_measure?: unknown;
  ordered_quantity: unknown;
  unit_price?: unknown;
  discount_amount?: unknown;
  tax_amount?: unknown;
  expense_gl_account_id: unknown;
  cost_center_id?: unknown;
  requisition_line_id?: unknown;
};

export type PurchaseOrderFromReqLineInput = {
  requisition_line_id: unknown;
  ordered_quantity: unknown;
  unit_price?: unknown;
  discount_amount?: unknown;
  tax_amount?: unknown;
};

const KINDS = new Set<PurchaseKind>(['SERVICE', 'NON_STOCK_ITEM', 'FIXED_ASSET_CANDIDATE', 'OTHER']);
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
const iqd = (v: unknown) => {
  const c = normalizeCurrencyCode(v, 'IQD');
  if (c !== 'IQD') throw new AccountsHttpError('عملة أمر الشراء هي IQD فقط', 400);
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

function moneyNonNeg(v: unknown): string {
  try {
    const m = normalizeMoneyInput(v ?? 0);
    if (moneyToMillis(m) < BigInt(0)) throw new Error();
    return m;
  } catch {
    throw new AccountsHttpError('المبلغ يجب أن يكون صفراً أو أكبر', 400);
  }
}

function assertKind(v: unknown): PurchaseKind {
  const k = String(v ?? '').trim().toUpperCase() as PurchaseKind;
  if (!KINDS.has(k)) throw new AccountsHttpError('نوع الشراء غير صالح', 400);
  return k;
}

function lineTotal(qty: string, price: string, disc: string, tax: string) {
  const base = roundProduct(qty, price);
  const totalMillis = moneyToMillis(base) - moneyToMillis(disc) + moneyToMillis(tax);
  if (totalMillis < BigInt(0)) throw new AccountsHttpError('إجمالي السطر لا يمكن أن يكون سالباً', 400);
  return millisToMoney(totalMillis);
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
  if (!r.rows[0]) throw new AccountsHttpError('لا توجد فترة مالية مفتوحة تغطي تاريخ الأمر', 409);
  return r.rows[0];
}

async function cc(c: TxClient, id: string | null) {
  if (!id) return;
  const r = await txQuery(c, `SELECT 1 FROM accounts.cost_centers WHERE id=$1::uuid AND is_active=TRUE`, [id]);
  if (!r.rows[0]) throw new AccountsHttpError('مركز الكلفة غير موجود أو غير فعّال', 400);
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
     SELECT 'PURCHASE_ORDER',$1::uuid,'POR',0,6,TRUE,TRUE
     WHERE NOT EXISTS(SELECT 1 FROM accounts.document_sequences WHERE document_type='PURCHASE_ORDER' AND fiscal_year_id=$1::uuid)`,
    [yearId]
  );
  return (
    await nextDocumentNumber(c, {
      documentType: 'PURCHASE_ORDER',
      fiscalYearId: yearId,
      yearLabel: yearLabelFromDate(y.rows[0].start_date),
    })
  ).formatted;
}

/**
 * يفرض أن المورد وحسابه صالحان لعملية على أمر الشراء (إنشاء أو اعتماد).
 * SUSPENDED/CLOSED/غير ACTIVE على المورد أو الحساب يمنعان العملية — لا يقتصر المنع على الاعتماد فقط.
 */
function assertSupplierUsableForPo(
  supplier: { id: string; status: string },
  account: { supplier_id: string; status: string },
  actionAr: 'إنشاء' | 'اعتماد'
) {
  if (supplier.status === 'CLOSED') throw new AccountsHttpError(`لا يمكن ${actionAr} أمر لمورد مغلق`, 409);
  if (supplier.status === 'SUSPENDED') throw new AccountsHttpError(`لا يمكن ${actionAr} أمر لمورد معلّق`, 409);
  if (supplier.status !== 'ACTIVE') throw new AccountsHttpError('حالة المورد لا تسمح بهذا الإجراء على أمر الشراء', 409);
  if (account.status === 'CLOSED') throw new AccountsHttpError(`لا يمكن ${actionAr} أمر على حساب مورد مغلق`, 409);
  if (account.status === 'SUSPENDED') throw new AccountsHttpError(`لا يمكن ${actionAr} أمر على حساب مورد معلّق`, 409);
  if (account.supplier_id !== supplier.id) throw new AccountsHttpError('حساب المورد لا يطابق المورد', 409);
}

async function assertSupplierForPoCreate(c: TxClient, supplierId: string, accountId: string) {
  const supplier = await loadSupplier(c, supplierId);
  const account = await loadSupplierAccount(c, accountId);
  assertSupplierUsableForPo(supplier, account, 'إنشاء');
  return { supplier, account };
}

async function assertSupplierForPoApprove(c: TxClient, supplierId: string, accountId: string) {
  const supplier = await loadSupplier(c, supplierId, true);
  const account = await loadSupplierAccount(c, accountId, true);
  assertSupplierUsableForPo(supplier, account, 'اعتماد');
  return { supplier, account };
}

/** يتحقق أن عملة حساب المورد IQD (المرحلة 7.A تدعم IQD فقط) — دفاعي إضافةً إلى فرض العملة عند الإنشاء */
function assertAccountIsIqd(account: { currency_code: string }) {
  if (account.currency_code !== 'IQD') {
    throw new AccountsHttpError('حساب المورد ليس بعملة IQD — لا يمكن استخدامه في أمر شراء', 400);
  }
}

export function derivePoLineStatus(line: {
  ordered_quantity: string;
  cancelled_quantity: string;
  received_quantity: string;
  accepted_quantity: string;
  invoiced_quantity: string;
  rejected_quantity?: string;
  status?: PurchaseOrderLineStatus;
}): PurchaseOrderLineStatus {
  if (line.status === 'CLOSED') return 'CLOSED';
  const open = millisToMoney(
    moneyToMillis(normalizeMoneyInput(line.ordered_quantity)) -
      moneyToMillis(normalizeMoneyInput(line.cancelled_quantity))
  );
  if (moneyIsZero(open) || moneyToMillis(open) <= BigInt(0)) return 'CANCELLED';
  const recv = normalizeMoneyInput(line.received_quantity);
  const acc = normalizeMoneyInput(line.accepted_quantity);
  const inv = normalizeMoneyInput(line.invoiced_quantity);
  if (moneyIsZero(recv)) return 'OPEN';
  if (moneyToMillis(recv) < moneyToMillis(open)) return 'PARTIALLY_RECEIVED';
  if (moneyIsZero(inv)) return 'RECEIVED';
  if (moneyToMillis(inv) < moneyToMillis(acc)) return 'PARTIALLY_INVOICED';
  return 'INVOICED';
}

export function derivePoHeaderStatus(
  headerStatus: PurchaseOrderStatus,
  lines: Array<{ status: PurchaseOrderLineStatus }>
): PurchaseOrderStatus {
  if (['DRAFT', 'SUBMITTED', 'REJECTED', 'CANCELLED', 'CLOSED'].includes(headerStatus)) return headerStatus;
  if (!lines.length) return headerStatus;
  const st = lines.map((l) => l.status);
  if (st.every((s) => s === 'CANCELLED')) return headerStatus;
  const active = st.filter((s) => s !== 'CANCELLED');
  if (active.every((s) => s === 'INVOICED' || s === 'CLOSED')) return 'INVOICED';
  if (active.some((s) => s === 'INVOICED' || s === 'PARTIALLY_INVOICED')) return 'PARTIALLY_INVOICED';
  if (active.every((s) => ['RECEIVED', 'INVOICED', 'PARTIALLY_INVOICED', 'CLOSED'].includes(s))) return 'RECEIVED';
  if (active.some((s) => s === 'PARTIALLY_RECEIVED' || s === 'RECEIVED')) return 'PARTIALLY_RECEIVED';
  return 'APPROVED';
}

async function parseDirectLines(c: TxClient, lines: unknown) {
  if (!Array.isArray(lines) || !lines.length) throw new AccountsHttpError('يجب إضافة سطر واحد على الأقل', 400);
  const parsed = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as PurchaseOrderLineInput;
    const kind = assertKind(raw.purchase_kind);
    const desc = txt(raw.description, 2000);
    if (!desc) throw new AccountsHttpError(`وصف السطر ${i + 1} مطلوب`, 400);
    const qty = qtyPositive(raw.ordered_quantity, `كمية السطر ${i + 1}`);
    const price = priceNonNeg(raw.unit_price ?? 0);
    const disc = moneyNonNeg(raw.discount_amount ?? 0);
    const tax = moneyNonNeg(raw.tax_amount ?? 0);
    const glId = txt(raw.expense_gl_account_id, 100);
    if (!glId) throw new AccountsHttpError(`حساب المصروف مطلوب للسطر ${i + 1}`, 400);
    const gl = await assertValidExpenseGlAccount(c, glId);
    const center = txt(raw.cost_center_id, 100);
    await cc(c, center);
    parsed.push({
      line_number: i + 1,
      purchase_kind: kind,
      item_code: txt(raw.item_code, 80),
      description: desc,
      unit_of_measure: txt(raw.unit_of_measure, 40) ?? 'UNIT',
      ordered_quantity: qty,
      unit_price: price,
      discount_amount: disc,
      tax_amount: tax,
      line_total: lineTotal(qty, price, disc, tax),
      expense_gl_account_id: gl.id,
      cost_center_id: center,
      requisition_line_id: txt(raw.requisition_line_id, 100),
    });
  }
  return parsed;
}

async function insertLines(c: TxClient, poId: string, lines: Awaited<ReturnType<typeof parseDirectLines>>) {
  for (const l of lines) {
    await txQuery(
      c,
      `INSERT INTO accounts.purchase_order_lines(
         purchase_order_id,requisition_line_id,line_number,purchase_kind,item_code,description,unit_of_measure,
         ordered_quantity,unit_price,discount_amount,tax_amount,line_total,expense_gl_account_id,cost_center_id,status
       ) VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,$10::numeric,$11::numeric,$12::numeric,$13::uuid,$14::uuid,'OPEN')`,
      [
        poId,
        l.requisition_line_id,
        l.line_number,
        l.purchase_kind,
        l.item_code,
        l.description,
        l.unit_of_measure,
        l.ordered_quantity,
        l.unit_price,
        l.discount_amount,
        l.tax_amount,
        l.line_total,
        l.expense_gl_account_id,
        l.cost_center_id,
      ]
    );
  }
}

/**
 * إجماليات رأس أمر الشراء من السطور:
 * subtotal = Σ roundProduct(qty, price) — قبل الخصم والضريبة.
 * discount = Σ discount_amount · tax = Σ tax_amount · total = Σ line_total.
 * يفرض total > 0 (moneyIsPositive) — يُستدعى من الإنشاء والتعديل؛ الاعتماد يعيد الفرض على الصف المخزَّن.
 */
function headerAmounts(lines: Awaited<ReturnType<typeof parseDirectLines>>) {
  const subtotal = sumMoney(lines.map((l) => roundProduct(l.ordered_quantity, l.unit_price)));
  const discount = sumMoney(lines.map((l) => l.discount_amount));
  const tax = sumMoney(lines.map((l) => l.tax_amount));
  const total = sumMoney(lines.map((l) => l.line_total));
  if (!moneyIsPositive(total)) throw new AccountsHttpError('إجمالي أمر الشراء يجب أن يكون أكبر من صفر', 400);
  return { subtotal, discount, tax, total };
}

async function replacePoLines(c: TxClient, poId: string, lines: Awaited<ReturnType<typeof parseDirectLines>>) {
  await txQuery(c, `DELETE FROM accounts.purchase_order_lines WHERE purchase_order_id=$1::uuid`, [poId]);
  await insertLines(c, poId, lines);
  return headerAmounts(lines);
}

export function serializePurchaseOrder(r: PurchaseOrderRow) {
  return {
    ...r,
    order_date: pgDateOnly(r.order_date),
    expected_delivery_date: r.expected_delivery_date ? pgDateOnly(r.expected_delivery_date) : null,
    subtotal_amount: normalizeMoneyInput(r.subtotal_amount),
    discount_amount: normalizeMoneyInput(r.discount_amount),
    tax_amount: normalizeMoneyInput(r.tax_amount),
    total_amount: normalizeMoneyInput(r.total_amount),
    submitted_at: iso(r.submitted_at),
    approved_at: iso(r.approved_at),
    rejected_at: iso(r.rejected_at),
    cancelled_at: iso(r.cancelled_at),
    closed_at: iso(r.closed_at),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

export function serializePurchaseOrderLine(r: PurchaseOrderLineRow) {
  return {
    ...r,
    ordered_quantity: normalizeMoneyInput(r.ordered_quantity),
    unit_price: normalizeMoneyInput(r.unit_price),
    discount_amount: normalizeMoneyInput(r.discount_amount),
    tax_amount: normalizeMoneyInput(r.tax_amount),
    line_total: normalizeMoneyInput(r.line_total),
    received_quantity: normalizeMoneyInput(r.received_quantity),
    accepted_quantity: normalizeMoneyInput(r.accepted_quantity),
    rejected_quantity: normalizeMoneyInput(r.rejected_quantity),
    invoiced_quantity: normalizeMoneyInput(r.invoiced_quantity),
    cancelled_quantity: normalizeMoneyInput(r.cancelled_quantity),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

export async function allocatePurchaseOrderNumber(c: TxClient, fiscalYearId: string) {
  return seq(c, fiscalYearId);
}

export async function loadPurchaseOrder(c: TxClient, id: string, forUpdate = false) {
  const r = await txQuery<PurchaseOrderRow>(
    c,
    `SELECT * FROM accounts.purchase_orders WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('أمر الشراء غير موجود', 404);
  return r.rows[0];
}

export async function loadPurchaseOrderLine(c: TxClient, id: string, forUpdate = false) {
  const r = await txQuery<PurchaseOrderLineRow>(
    c,
    `SELECT * FROM accounts.purchase_order_lines WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('سطر أمر الشراء غير موجود', 404);
  return r.rows[0];
}

export async function listPurchaseOrderLines(c: TxClient, purchaseOrderId: string, forUpdate = false) {
  return (
    await txQuery<PurchaseOrderLineRow>(
      c,
      `SELECT * FROM accounts.purchase_order_lines WHERE purchase_order_id=$1::uuid ORDER BY line_number ${forUpdate ? 'FOR UPDATE' : ''}`,
      [purchaseOrderId]
    )
  ).rows;
}

export async function listPurchaseOrders(
  c: TxClient,
  p: {
    q?: string;
    status?: string | null;
    supplier_id?: string | null;
    requisition_id?: string | null;
    page?: number;
    page_size?: number;
  }
) {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(100, Math.max(1, p.page_size ?? 20));
  const v = [(p.q ?? '').trim(), p.status ?? null, p.supplier_id ?? null, p.requisition_id ?? null];
  const where = `WHERE ($1='' OR po.purchase_order_number ILIKE '%'||$1||'%' OR po.description ILIKE '%'||$1||'%')
    AND ($2::text IS NULL OR po.status=$2) AND ($3::uuid IS NULL OR po.supplier_id=$3::uuid)
    AND ($4::uuid IS NULL OR po.requisition_id=$4::uuid)`;
  const n = await txQuery<{ total: number }>(
    c,
    `SELECT COUNT(*)::int total FROM accounts.purchase_orders po ${where}`,
    v
  );
  const r = await txQuery<PurchaseOrderRow>(
    c,
    `SELECT po.* FROM accounts.purchase_orders po ${where}
     ORDER BY po.order_date DESC, po.created_at DESC LIMIT $5 OFFSET $6`,
    [...v, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}

/** يحدّث حالات السطور والرأس بعد استلام/فوترة */
export async function refreshPurchaseOrderQuantitiesStatus(c: TxClient, purchaseOrderId: string) {
  const lines = await listPurchaseOrderLines(c, purchaseOrderId, true);
  const derived: PurchaseOrderLineStatus[] = [];
  for (const l of lines) {
    const st = derivePoLineStatus(l);
    derived.push(st);
    if (st !== l.status) {
      await txQuery(
        c,
        `UPDATE accounts.purchase_order_lines SET status=$2,updated_at=NOW() WHERE id=$1::uuid`,
        [l.id, st]
      );
    }
  }
  const po = await loadPurchaseOrder(c, purchaseOrderId, true);
  const next = derivePoHeaderStatus(po.status, derived.map((status) => ({ status })));
  if (next !== po.status) {
    const u = await txQuery<PurchaseOrderRow>(
      c,
      `UPDATE accounts.purchase_orders SET status=$2,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
      [purchaseOrderId, next]
    );
    return u.rows[0]!;
  }
  return po;
}

async function reverseReqFromPo(c: TxClient, poId: string) {
  const lines = await listPurchaseOrderLines(c, poId);
  const updates: Array<{ requisition_line_id: string; delta: string }> = [];
  for (const l of lines) {
    if (!l.requisition_line_id) continue;
    updates.push({
      requisition_line_id: l.requisition_line_id,
      delta: millisToMoney(-moneyToMillis(normalizeMoneyInput(l.ordered_quantity))),
    });
  }
  if (updates.length) await updateRequisitionOrderedQuantities(c, updates);
}

export async function createPurchaseOrder(
  c: TxClient,
  input: {
    supplier_account_id: unknown;
    order_date?: unknown;
    expected_delivery_date?: unknown;
    payment_terms_days?: unknown;
    delivery_location?: unknown;
    description?: unknown;
    currency_code?: unknown;
    lines: PurchaseOrderLineInput[];
    created_by: string;
  }
) {
  const accountId = String(input.supplier_account_id ?? '').trim();
  if (!accountId) throw new AccountsHttpError('حساب المورد مطلوب', 400);
  const accountPeek = await loadSupplierAccount(c, accountId);
  const { supplier, account } = await assertSupplierForPoCreate(c, accountPeek.supplier_id, accountId);
  assertAccountIsIqd(account);
  const date = input.order_date ? pgDateOnly(String(input.order_date)) : pgDateOnly(new Date());
  const f = await fiscal(c, date);
  await assertFiscalContextForEntry(c, { fiscalYearId: f.year_id, fiscalPeriodId: f.period_id, entryDate: date });
  const parsed = await parseDirectLines(c, input.lines);
  const amt = headerAmounts(parsed);
  const terms = Math.max(0, Number(input.payment_terms_days ?? supplier.payment_terms_days ?? 0) || 0);
  const r = await txQuery<PurchaseOrderRow>(
    c,
    `INSERT INTO accounts.purchase_orders(
       purchase_order_number,supplier_id,supplier_account_id,fiscal_year_id,fiscal_period_id,
       order_date,expected_delivery_date,currency_code,payment_terms_days,delivery_location,description,
       subtotal_amount,discount_amount,tax_amount,total_amount,status,created_by,updated_by
     ) VALUES($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::date,$7::date,$8,$9,$10,$11,$12::numeric,$13::numeric,$14::numeric,$15::numeric,'DRAFT',$16::uuid,$16::uuid)
     RETURNING *`,
    [
      await seq(c, f.year_id),
      account.supplier_id,
      account.id,
      f.year_id,
      f.period_id,
      date,
      input.expected_delivery_date ? pgDateOnly(String(input.expected_delivery_date)) : null,
      iqd(input.currency_code ?? account.currency_code),
      terms,
      txt(input.delivery_location, 500),
      txt(input.description, 4000) ?? 'أمر شراء',
      amt.subtotal,
      amt.discount,
      amt.tax,
      amt.total,
      input.created_by,
    ]
  );
  await insertLines(c, r.rows[0]!.id, parsed);
  return loadPurchaseOrder(c, r.rows[0]!.id);
}

export async function createPurchaseOrderFromRequisition(
  c: TxClient,
  input: {
    requisitionId: string;
    supplier_account_id: unknown;
    lines: PurchaseOrderFromReqLineInput[];
    order_date?: unknown;
    expected_delivery_date?: unknown;
    payment_terms_days?: unknown;
    delivery_location?: unknown;
    description?: unknown;
    userId: string;
  }
) {
  const req = await loadPurchaseRequisition(c, input.requisitionId);
  if (!['APPROVED', 'PARTIALLY_ORDERED'].includes(req.status))
    throw new AccountsHttpError('يمكن إنشاء أمر شراء من طلب معتمد فقط', 409);
  if (!Array.isArray(input.lines) || !input.lines.length)
    throw new AccountsHttpError('يجب تحديد سطور أمر الشراء', 400);
  const accountId = String(input.supplier_account_id ?? '').trim();
  if (!accountId) throw new AccountsHttpError('حساب المورد مطلوب', 400);
  const account = await loadSupplierAccount(c, accountId);
  const supplier = await loadSupplier(c, account.supplier_id);
  const lockRes = [
    purchaseRequisitionLock(input.requisitionId),
    ...input.lines.map((l) => purchaseRequisitionLineLock(String(l.requisition_line_id ?? ''))),
    supplierLock(account.supplier_id),
    supplierAccountLock(account.id),
  ];
  await acquireAccountingResourceLocks(c, lockRes);
  const reqLocked = await loadPurchaseRequisition(c, input.requisitionId, true);
  if (!['APPROVED', 'PARTIALLY_ORDERED'].includes(reqLocked.status))
    throw new AccountsHttpError('يمكن إنشاء أمر شراء من طلب معتمد فقط', 409);
  const supplierLocked = await loadSupplier(c, account.supplier_id, true);
  const accountLocked = await loadSupplierAccount(c, accountId, true);
  assertSupplierUsableForPo(supplierLocked, accountLocked, 'إنشاء');
  assertAccountIsIqd(accountLocked);
  const reqLines = await listPurchaseRequisitionLines(c, input.requisitionId);
  const reqMap = new Map<string, PurchaseRequisitionLineRow>(reqLines.map((l) => [l.id, l]));
  const parsed: Awaited<ReturnType<typeof parseDirectLines>> = [];
  const reqUpdates: Array<{ requisition_line_id: string; delta: string }> = [];
  for (let i = 0; i < input.lines.length; i++) {
    const raw = input.lines[i]!;
    const rlId = String(raw.requisition_line_id ?? '').trim();
    if (!rlId) throw new AccountsHttpError(`معرّف سطر الطلب مطلوب للسطر ${i + 1}`, 400);
    const rl = reqMap.get(rlId);
    if (!rl) throw new AccountsHttpError(`سطر الطلب ${i + 1} غير موجود`, 404);
    const ordQty = qtyPositive(raw.ordered_quantity, `كمية السطر ${i + 1}`);
    const remaining = millisToMoney(
      moneyToMillis(normalizeMoneyInput(rl.requested_quantity)) -
        moneyToMillis(normalizeMoneyInput(rl.ordered_quantity))
    );
    if (moneyToMillis(ordQty) > moneyToMillis(remaining))
      throw new AccountsHttpError(`الكمية تتجاوز المتبقي في سطر الطلب ${rl.line_number}`, 409);
    const price = priceNonNeg(raw.unit_price ?? rl.estimated_unit_price);
    const disc = moneyNonNeg(raw.discount_amount ?? 0);
    const tax = moneyNonNeg(raw.tax_amount ?? 0);
    const glId = rl.expense_gl_account_id;
    if (!glId) throw new AccountsHttpError(`حساب المصروف مطلوب لسطر الطلب ${rl.line_number}`, 400);
    const gl = await assertValidExpenseGlAccount(c, glId);
    await cc(c, rl.cost_center_id);
    parsed.push({
      line_number: i + 1,
      purchase_kind: rl.purchase_kind,
      item_code: rl.item_code,
      description: rl.description,
      unit_of_measure: rl.unit_of_measure,
      ordered_quantity: ordQty,
      unit_price: price,
      discount_amount: disc,
      tax_amount: tax,
      line_total: lineTotal(ordQty, price, disc, tax),
      expense_gl_account_id: gl.id,
      cost_center_id: rl.cost_center_id,
      requisition_line_id: rlId,
    });
    reqUpdates.push({ requisition_line_id: rlId, delta: ordQty });
  }
  const date = input.order_date ? pgDateOnly(String(input.order_date)) : pgDateOnly(new Date());
  const f = await fiscal(c, date);
  await assertFiscalContextForEntry(c, { fiscalYearId: f.year_id, fiscalPeriodId: f.period_id, entryDate: date });
  const amt = headerAmounts(parsed);
  const terms = Math.max(0, Number(input.payment_terms_days ?? supplier.payment_terms_days ?? 0) || 0);
  const r = await txQuery<PurchaseOrderRow>(
    c,
    `INSERT INTO accounts.purchase_orders(
       purchase_order_number,supplier_id,supplier_account_id,requisition_id,fiscal_year_id,fiscal_period_id,
       order_date,expected_delivery_date,currency_code,payment_terms_days,delivery_location,description,
       subtotal_amount,discount_amount,tax_amount,total_amount,status,created_by,updated_by
     ) VALUES($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::date,$8::date,$9,$10,$11,$12,$13::numeric,$14::numeric,$15::numeric,$16::numeric,'DRAFT',$17::uuid,$17::uuid)
     RETURNING *`,
    [
      await seq(c, f.year_id),
      account.supplier_id,
      account.id,
      input.requisitionId,
      f.year_id,
      f.period_id,
      date,
      input.expected_delivery_date ? pgDateOnly(String(input.expected_delivery_date)) : null,
      iqd(account.currency_code),
      terms,
      txt(input.delivery_location, 500),
      txt(input.description, 4000) ?? `أمر شراء من ${reqLocked.requisition_number}`,
      amt.subtotal,
      amt.discount,
      amt.tax,
      amt.total,
      input.userId,
    ]
  );
  await insertLines(c, r.rows[0]!.id, parsed);
  await updateRequisitionOrderedQuantities(c, reqUpdates);
  return loadPurchaseOrder(c, r.rows[0]!.id);
}

export async function updatePurchaseOrder(
  c: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    order_date?: unknown;
    expected_delivery_date?: unknown;
    payment_terms_days?: unknown;
    delivery_location?: unknown;
    description?: unknown;
    lines?: PurchaseOrderLineInput[];
  }
) {
  await acquireAccountingResourceLocks(c, [purchaseOrderLock(p.id)]);
  const row = await loadPurchaseOrder(c, p.id, true);
  opt(row, p.version, p.updated_at);
  if (row.status !== 'DRAFT') throw new AccountsHttpError('يمكن تعديل مسودات أوامر الشراء فقط', 409);
  const date = p.order_date === undefined ? pgDateOnly(row.order_date) : pgDateOnly(String(p.order_date));
  const f = await fiscal(c, date);
  await assertFiscalContextForEntry(c, { fiscalYearId: f.year_id, fiscalPeriodId: f.period_id, entryDate: date });
  let subtotal = normalizeMoneyInput(row.subtotal_amount);
  let discount = normalizeMoneyInput(row.discount_amount);
  let tax = normalizeMoneyInput(row.tax_amount);
  let total = normalizeMoneyInput(row.total_amount);
  if (p.lines !== undefined) {
    const parsed = await parseDirectLines(c, p.lines);
    const amt = await replacePoLines(c, row.id, parsed);
    subtotal = amt.subtotal;
    discount = amt.discount;
    tax = amt.tax;
    total = amt.total;
  }
  if (!moneyIsPositive(total)) throw new AccountsHttpError('إجمالي أمر الشراء يجب أن يكون أكبر من صفر', 400);
  const u = await txQuery<PurchaseOrderRow>(
    c,
    `UPDATE accounts.purchase_orders SET
       order_date=$2::date,fiscal_year_id=$3::uuid,fiscal_period_id=$4::uuid,
       expected_delivery_date=$5::date,payment_terms_days=$6,delivery_location=$7,description=$8,
       subtotal_amount=$9::numeric,discount_amount=$10::numeric,tax_amount=$11::numeric,total_amount=$12::numeric,
       updated_by=$13::uuid,updated_at=NOW(),version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [
      row.id,
      date,
      f.year_id,
      f.period_id,
      p.expected_delivery_date === undefined
        ? row.expected_delivery_date
          ? pgDateOnly(row.expected_delivery_date)
          : null
        : p.expected_delivery_date
          ? pgDateOnly(String(p.expected_delivery_date))
          : null,
      p.payment_terms_days === undefined ? row.payment_terms_days : Math.max(0, Number(p.payment_terms_days) || 0),
      p.delivery_location === undefined ? row.delivery_location : txt(p.delivery_location, 500),
      p.description === undefined ? row.description : txt(p.description, 4000) ?? row.description,
      subtotal,
      discount,
      tax,
      total,
      p.userId,
    ]
  );
  return u.rows[0]!;
}

export async function submitPurchaseOrder(
  c: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown }
) {
  await acquireAccountingResourceLocks(c, [purchaseOrderLock(p.id)]);
  const row = await loadPurchaseOrder(c, p.id, true);
  opt(row, p.version, p.updated_at);
  if (row.status !== 'DRAFT') throw new AccountsHttpError('يمكن تقديم مسودات أوامر الشراء فقط', 409);
  const lines = await listPurchaseOrderLines(c, p.id);
  if (!lines.length) throw new AccountsHttpError('لا يمكن تقديم أمر بلا سطور', 409);
  const u = await txQuery<PurchaseOrderRow>(
    c,
    `UPDATE accounts.purchase_orders SET status='SUBMITTED',submitted_by=$2::uuid,submitted_at=NOW(),
       updated_by=$2::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
    [p.id, p.userId]
  );
  return u.rows[0]!;
}

export async function approvePurchaseOrder(
  c: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown }
) {
  const peek = await loadPurchaseOrder(c, p.id);
  await acquireAccountingResourceLocks(c, [
    purchaseOrderLock(p.id),
    supplierLock(peek.supplier_id),
    supplierAccountLock(peek.supplier_account_id),
  ]);
  const row = await loadPurchaseOrder(c, p.id, true);
  opt(row, p.version, p.updated_at);
  if (row.status !== 'SUBMITTED') throw new AccountsHttpError('يمكن اعتماد أوامر الشراء المقدّمة فقط', 409);
  await assertSupplierForPoApprove(c, row.supplier_id, row.supplier_account_id);
  const lines = await listPurchaseOrderLines(c, p.id);
  if (!lines.length) throw new AccountsHttpError('لا يمكن اعتماد أمر بلا سطور', 409);
  if (!moneyIsPositive(normalizeMoneyInput(row.total_amount)))
    throw new AccountsHttpError('لا يمكن اعتماد أمر بإجمالي غير موجب', 409);
  const u = await txQuery<PurchaseOrderRow>(
    c,
    `UPDATE accounts.purchase_orders SET status='APPROVED',approved_by=$2::uuid,approved_at=NOW(),
       updated_by=$2::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
    [p.id, p.userId]
  );
  return u.rows[0]!;
}

export async function rejectPurchaseOrder(
  c: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown; reason?: unknown }
) {
  await acquireAccountingResourceLocks(c, [purchaseOrderLock(p.id)]);
  const row = await loadPurchaseOrder(c, p.id, true);
  opt(row, p.version, p.updated_at);
  if (row.status !== 'SUBMITTED') throw new AccountsHttpError('يمكن رفض أوامر الشراء المقدّمة فقط', 409);
  const reason = txt(p.reason, 2000);
  if (!reason) throw new AccountsHttpError('سبب الرفض مطلوب', 400);
  const u = await txQuery<PurchaseOrderRow>(
    c,
    `UPDATE accounts.purchase_orders SET status='REJECTED',rejected_by=$2::uuid,rejected_at=NOW(),
       rejection_reason=$3,updated_by=$2::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
    [p.id, p.userId, reason]
  );
  if (row.requisition_id) await reverseReqFromPo(c, row.id);
  return u.rows[0]!;
}

export async function cancelPurchaseOrder(
  c: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown; reason?: unknown }
) {
  await acquireAccountingResourceLocks(c, [purchaseOrderLock(p.id)]);
  const row = await loadPurchaseOrder(c, p.id, true);
  opt(row, p.version, p.updated_at);
  if (!['DRAFT', 'SUBMITTED', 'APPROVED'].includes(row.status))
    throw new AccountsHttpError('حالة الأمر لا تسمح بالإلغاء', 409);
  const lines = await listPurchaseOrderLines(c, p.id);
  for (const l of lines) {
    if (moneyIsPositive(normalizeMoneyInput(l.received_quantity)))
      throw new AccountsHttpError('لا يمكن إلغاء أمر له استلامات', 409);
  }
  const u = await txQuery<PurchaseOrderRow>(
    c,
    `UPDATE accounts.purchase_orders SET status='CANCELLED',cancelled_by=$2::uuid,cancelled_at=NOW(),
       cancellation_reason=$3,updated_by=$2::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
    [p.id, p.userId, txt(p.reason, 2000) ?? 'إلغاء أمر شراء']
  );
  if (row.requisition_id) await reverseReqFromPo(c, row.id);
  return u.rows[0]!;
}

/**
 * إغلاق يدوي لرأس الأمر فقط (حل B في 7.A):
 * - لا يكتب cancelled_quantity ولا يحدّث سطور الأمر إلى CLOSED/CANCELLED.
 * - حالات السطر CANCELLED/CLOSED تمهيدية لمرحلة لاحقة (إلغاء سطر جزئي).
 * - رأس CLOSED يمنع الاستلام/الفوترة عبر بوابات الحالة حتى لو بقيت حالات السطور تاريخية.
 * open_receive = ordered − cancelled − received يجب أن يكون 0 لكل سطر نشط قبل الإغلاق.
 */
export async function closePurchaseOrder(
  c: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown }
) {
  await acquireAccountingResourceLocks(c, [purchaseOrderLock(p.id)]);
  const row = await loadPurchaseOrder(c, p.id, true);
  opt(row, p.version, p.updated_at);
  if (!['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'PARTIALLY_INVOICED', 'INVOICED'].includes(row.status))
    throw new AccountsHttpError('حالة الأمر لا تسمح بالإغلاق', 409);
  const lines = await listPurchaseOrderLines(c, p.id);
  for (const l of lines) {
    if (l.status === 'CANCELLED' || l.status === 'CLOSED') continue;
    const openRecv =
      moneyToMillis(normalizeMoneyInput(l.ordered_quantity)) -
      moneyToMillis(normalizeMoneyInput(l.cancelled_quantity)) -
      moneyToMillis(normalizeMoneyInput(l.received_quantity));
    if (openRecv > BigInt(0)) {
      throw new AccountsHttpError(
        'لا يمكن إغلاق أمر له كميات مفتوحة للاستلام — أكمل الاستلام أو ألغِ الأمر',
        409
      );
    }
  }
  const u = await txQuery<PurchaseOrderRow>(
    c,
    `UPDATE accounts.purchase_orders SET status='CLOSED',closed_by=$2::uuid,closed_at=NOW(),
       updated_by=$2::uuid,updated_at=NOW(),version=version+1 WHERE id=$1::uuid RETURNING *`,
    [p.id, p.userId]
  );
  return u.rows[0]!;
}
