/** مطابقة فواتير الموردين مع أوامر الشراء — دورة المشتريات 7.A */
import {
  acquireAccountingResourceLocks,
  glAccountLock,
  purchaseOrderLineLock,
  purchaseOrderLock,
  supplierAccountLock,
  supplierInvoiceMatchLock,
  supplierLock,
} from './accounting-locks';
import { AccountsHttpError } from './auth';
import { pgDateOnly } from './document-sequences';
import { assertFiscalContextForEntry } from './journal-entries';
import {
  moneyIsPositive,
  moneyToMillis,
  millisToMoney,
  normalizeMoneyInput,
  sumMoney,
} from './money';
import {
  loadPurchaseOrder,
  loadPurchaseOrderLine,
  listPurchaseOrderLines,
  refreshPurchaseOrderQuantitiesStatus,
  type PurchaseOrderLineRow,
  type PurchaseOrderRow,
} from './purchase-orders';
import {
  assertSupplierAccountActiveForInvoices,
  loadSupplierAccount,
} from './supplier-accounts';
import {
  allocateSupplierInvoiceNumber,
  normalizeSupplierInvoiceNumber,
  type SupplierInvoiceLineRow,
  type SupplierInvoiceRow,
} from './supplier-invoices';
import { assertValidExpenseGlAccount } from './supplier-invoice-types';
import {
  assertSupplierActiveForInvoices,
  loadSupplier,
} from './suppliers';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type MatchablePoLineRow = {
  purchase_order_line_id: string;
  line_number: number;
  description: string;
  unit_of_measure: string;
  ordered_quantity: string;
  accepted_quantity: string;
  invoiced_quantity: string;
  available_to_invoice: string;
  unit_price: string;
  expense_gl_account_id: string;
  cost_center_id: string | null;
  purchase_kind: string;
  item_code: string | null;
  status: string;
};

export type CreatePoInvoiceLineInput = {
  purchase_order_line_id: unknown;
  quantity: unknown;
  unit_price: unknown;
  discount_amount?: unknown;
  tax_amount?: unknown;
  purchase_receipt_line_id?: unknown;
};

const INVOICEABLE_PO_STATUSES = new Set([
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'PARTIALLY_INVOICED',
]);

const roundProduct = (a: string, b: string) =>
  millisToMoney((moneyToMillis(a) * moneyToMillis(b) + BigInt(500)) / BigInt(1000));

function lineTotal(qty: string, price: string, disc: string, tax: string) {
  const base = roundProduct(qty, price);
  const totalMillis = moneyToMillis(base) - moneyToMillis(disc) + moneyToMillis(tax);
  if (totalMillis < BigInt(0)) throw new AccountsHttpError('إجمالي السطر لا يمكن أن يكون سالباً', 400);
  return millisToMoney(totalMillis);
}

function qtyPositive(v: unknown, label = 'الكمية'): string {
  try {
    const q = normalizeMoneyInput(v);
    if (!moneyIsPositive(q)) throw new Error();
    return q;
  } catch {
    throw new AccountsHttpError(`${label} يجب أن تكون أكبر من صفر`, 400);
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

/**
 * سياسة الكمية للفوترة (7.A):
 * available_to_invoice = accepted_quantity − invoiced_quantity
 * - يستخدم المقبول فقط (لا received ولا rejected).
 * - invoiced_quantity يحدَّث فقط عند POST فاتورة (وليس DRAFT).
 * - فاتورة DRAFT لا تحجز الكمية؛ POST يعيد التحقق تحت الأقفال.
 */
function availableToInvoice(line: PurchaseOrderLineRow): string {
  const acc = normalizeMoneyInput(line.accepted_quantity);
  const inv = normalizeMoneyInput(line.invoiced_quantity);
  const avail = moneyToMillis(acc) - moneyToMillis(inv);
  if (avail <= BigInt(0)) return '0.000';
  return millisToMoney(avail);
}

function assertPoInvoiceable(po: PurchaseOrderRow): void {
  if (!INVOICEABLE_PO_STATUSES.has(po.status)) {
    throw new AccountsHttpError(
      'لا يمكن إنشاء فاتورة إلا على أمر معتمد أو مستلم أو قيد الفوترة',
      409
    );
  }
}

/**
 * تسامح السعر متماثل: الزيادة والنقصان يخضعان لنفس النسبة.
 * عند tolerance=0 يُقبل التطابق التام فقط.
 */
/**
 * تسامح السعر متماثل (symmetric): يُقاس الفرق المطلق |invoice − po| مقابل po × tolerance%،
 * بصرف النظر عن اتجاه الفرق (سعر الفاتورة أعلى أو أقل من سعر أمر الشراء) — لا معاملة تفضيلية للانخفاض.
 */
export function isPriceWithinTolerance(
  poUnitPrice: string,
  invoiceUnitPrice: string,
  tolerancePercent: number
): boolean {
  const po = normalizeMoneyInput(poUnitPrice);
  const inv = normalizeMoneyInput(invoiceUnitPrice);
  if (moneyEqualsSafe(po, inv)) return true;
  if (tolerancePercent <= 0) return false;
  const poMillis = moneyToMillis(po);
  if (poMillis === BigInt(0)) return moneyEqualsSafe(po, inv);
  const diff = moneyToMillis(inv) >= poMillis
    ? moneyToMillis(inv) - poMillis
    : poMillis - moneyToMillis(inv);
  const allowed = (poMillis * BigInt(Math.round(tolerancePercent * 10000))) / BigInt(1000000);
  return diff <= allowed;
}

function moneyEqualsSafe(a: string, b: string): boolean {
  return moneyToMillis(normalizeMoneyInput(a)) === moneyToMillis(normalizeMoneyInput(b));
}

export async function getPriceTolerancePercent(client: TxClient): Promise<number> {
  const r = await txQuery<{ price_tolerance_percent: string }>(
    client,
    `SELECT price_tolerance_percent::text FROM accounts.purchasing_config ORDER BY updated_at DESC LIMIT 1`
  );
  return Number(r.rows[0]?.price_tolerance_percent ?? 0);
}

export async function listMatchablePoLines(
  client: TxClient,
  purchaseOrderId: string
): Promise<MatchablePoLineRow[]> {
  const po = await loadPurchaseOrder(client, purchaseOrderId);
  assertPoInvoiceable(po);
  const lines = await listPurchaseOrderLines(client, purchaseOrderId);
  return lines
    .map((l) => {
      const avail = availableToInvoice(l);
      return {
        purchase_order_line_id: l.id,
        line_number: l.line_number,
        description: l.description,
        unit_of_measure: l.unit_of_measure,
        ordered_quantity: normalizeMoneyInput(l.ordered_quantity),
        accepted_quantity: normalizeMoneyInput(l.accepted_quantity),
        invoiced_quantity: normalizeMoneyInput(l.invoiced_quantity),
        available_to_invoice: avail,
        unit_price: normalizeMoneyInput(l.unit_price),
        expense_gl_account_id: l.expense_gl_account_id,
        cost_center_id: l.cost_center_id,
        purchase_kind: l.purchase_kind,
        item_code: l.item_code,
        status: l.status,
      };
    })
    .filter((l) => moneyIsPositive(l.available_to_invoice));
}

export function serializeSupplierInvoiceLine(r: SupplierInvoiceLineRow) {
  return {
    ...r,
    quantity: normalizeMoneyInput(r.quantity),
    unit_price: normalizeMoneyInput(r.unit_price),
    discount_amount: normalizeMoneyInput(r.discount_amount),
    tax_amount: normalizeMoneyInput(r.tax_amount),
    line_total: normalizeMoneyInput(r.line_total),
    created_at:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : new Date(String(r.created_at)).toISOString(),
  };
}

let __matchPostFault: null | 'after_first_po_line' | 'after_po_update' = null;
export function setPurchaseInvoiceMatchPostFaultForTests(v: typeof __matchPostFault): void {
  __matchPostFault = v;
}

async function loadPoInvoiceLines(client: TxClient, invoiceId: string): Promise<SupplierInvoiceLineRow[]> {
  const r = await txQuery<SupplierInvoiceLineRow>(
    client,
    `SELECT * FROM accounts.supplier_invoice_lines
     WHERE supplier_invoice_id=$1::uuid ORDER BY line_number`,
    [invoiceId]
  );
  return r.rows;
}

/**
 * سياسة الحجز (reservation policy) — مهم:
 * فواتير DRAFT لا تحجز/تخصم أي كمية من سطر أمر الشراء (invoiced_quantity لا يتغير عند الإنشاء).
 * فقط POSTED (ثم PARTIALLY_PAID/PAID) تُحتسب ضمن invoiced_quantity — عبر هذه الدالة التي
 * تُستدعى فقط من مسار ترحيل الفاتورة (postSupplierInvoice)، وليس من createSupplierInvoiceFromPurchaseOrder.
 * لذلك يمكن إنشاء عدّة فواتير DRAFT على نفس الكمية المتاحة، وعند POST يُعاد فرض التحقق من
 * الكمية المتاحة (available_to_invoice) تحت الأقفال (acquireAccountingResourceLocks) — فينجح أول POST فقط
 * إذا كانت الكمية المجمّعة تتجاوز المتاح.
 */
export async function applyPurchaseOrderInvoicePostQuantities(
  client: TxClient,
  invoiceId: string
): Promise<void> {
  const invoice = await txQuery<{ purchase_order_id: string | null; invoice_source: string }>(
    client,
    `SELECT purchase_order_id, invoice_source FROM accounts.supplier_invoices WHERE id=$1::uuid`,
    [invoiceId]
  );
  const row = invoice.rows[0];
  if (!row || row.invoice_source !== 'PURCHASE_ORDER' || !row.purchase_order_id) return;

  const poId = row.purchase_order_id;
  const lines = await loadPoInvoiceLines(client, invoiceId);
  if (!lines.length) throw new AccountsHttpError('فاتورة أمر الشراء بلا سطور', 409);

  await acquireAccountingResourceLocks(client, [
    purchaseOrderLock(poId),
    supplierInvoiceMatchLock(poId),
    ...lines.map((l) => purchaseOrderLineLock(l.purchase_order_line_id!)),
  ]);

  let lineIndex = 0;
  for (const il of lines) {
    if (!il.purchase_order_line_id) continue;
    const poLine = await loadPurchaseOrderLine(client, il.purchase_order_line_id, true);
    const avail = availableToInvoice(poLine);
    if (moneyToMillis(normalizeMoneyInput(il.quantity)) > moneyToMillis(avail)) {
      throw new AccountsHttpError(
        `الكمية المفوترة تتجاوز المتاح في سطر الأمر ${poLine.line_number}`,
        409
      );
    }
    const newInv = millisToMoney(
      moneyToMillis(normalizeMoneyInput(poLine.invoiced_quantity)) +
        moneyToMillis(normalizeMoneyInput(il.quantity))
    );
    await txQuery(
      client,
      `UPDATE accounts.purchase_order_lines SET invoiced_quantity=$2::numeric, updated_at=NOW() WHERE id=$1::uuid`,
      [poLine.id, newInv]
    );
    lineIndex += 1;
    if (lineIndex === 1 && __matchPostFault === 'after_first_po_line') {
      throw new Error('FAULT_AFTER_FIRST_PO_LINE');
    }
  }

  await refreshPurchaseOrderQuantitiesStatus(client, poId);
  if (__matchPostFault === 'after_po_update') throw new Error('FAULT_AFTER_PO_UPDATE');
}

export async function reversePurchaseOrderInvoicePostQuantities(
  client: TxClient,
  invoiceId: string
): Promise<void> {
  const invoice = await txQuery<{ purchase_order_id: string | null; invoice_source: string }>(
    client,
    `SELECT purchase_order_id, invoice_source FROM accounts.supplier_invoices WHERE id=$1::uuid`,
    [invoiceId]
  );
  const row = invoice.rows[0];
  if (!row || row.invoice_source !== 'PURCHASE_ORDER' || !row.purchase_order_id) return;

  const poId = row.purchase_order_id;
  const lines = await loadPoInvoiceLines(client, invoiceId);
  if (!lines.length) return;

  await acquireAccountingResourceLocks(client, [
    purchaseOrderLock(poId),
    supplierInvoiceMatchLock(poId),
    ...lines.map((l) => purchaseOrderLineLock(l.purchase_order_line_id!)),
  ]);

  for (const il of lines) {
    if (!il.purchase_order_line_id) continue;
    const poLine = await loadPurchaseOrderLine(client, il.purchase_order_line_id, true);
    const newInv = millisToMoney(
      moneyToMillis(normalizeMoneyInput(poLine.invoiced_quantity)) -
        moneyToMillis(normalizeMoneyInput(il.quantity))
    );
    if (moneyToMillis(newInv) < BigInt(0)) {
      throw new AccountsHttpError(
        `لا يمكن عكس كمية مفوترة سالبة في سطر الأمر ${poLine.line_number}`,
        409
      );
    }
    await txQuery(
      client,
      `UPDATE accounts.purchase_order_lines SET invoiced_quantity=$2::numeric, updated_at=NOW() WHERE id=$1::uuid`,
      [poLine.id, newInv]
    );
  }

  await refreshPurchaseOrderQuantitiesStatus(client, poId);
}

export async function createSupplierInvoiceFromPurchaseOrder(
  client: TxClient,
  input: {
    purchase_order_id: unknown;
    supplier_invoice_number: unknown;
    invoice_date?: unknown;
    due_date?: unknown;
    lines: CreatePoInvoiceLineInput[];
    description?: unknown;
    external_reference?: unknown;
    created_by: string;
    override_tolerance?: boolean;
  }
): Promise<{ invoice: SupplierInvoiceRow; lines: SupplierInvoiceLineRow[] }> {
  const poId = String(input.purchase_order_id ?? '').trim();
  if (!poId) throw new AccountsHttpError('أمر الشراء مطلوب', 400);
  if (!Array.isArray(input.lines) || !input.lines.length) {
    throw new AccountsHttpError('يجب إضافة سطر واحد على الأقل', 400);
  }

  const poPeek = await loadPurchaseOrder(client, poId);
  assertPoInvoiceable(poPeek);

  const poLineIds = input.lines.map((l) => String(l.purchase_order_line_id ?? '').trim());
  const poLinesPreview = await listPurchaseOrderLines(client, poId);
  const glIds = new Set(poLinesPreview.map((l) => l.expense_gl_account_id));
  await acquireAccountingResourceLocks(client, [
    purchaseOrderLock(poId),
    supplierInvoiceMatchLock(poId),
    supplierAccountLock(poPeek.supplier_account_id),
    supplierLock(poPeek.supplier_id),
    ...poLineIds.filter(Boolean).map((id) => purchaseOrderLineLock(id)),
    ...[...glIds].map((id) => glAccountLock(id)),
  ]);

  const po = await loadPurchaseOrder(client, poId, true);
  assertPoInvoiceable(po);

  const account = await loadSupplierAccount(client, po.supplier_account_id, true);
  await assertSupplierAccountActiveForInvoices(client, account);
  const supplier = await loadSupplier(client, po.supplier_id, true);
  await assertSupplierActiveForInvoices(client, supplier);

  const supplierInvoiceNumber = normalizeSupplierInvoiceNumber(input.supplier_invoice_number);
  const dup = await txQuery(
    client,
    `SELECT 1 FROM accounts.supplier_invoices
     WHERE supplier_id=$1::uuid AND supplier_invoice_number=$2 LIMIT 1`,
    [po.supplier_id, supplierInvoiceNumber]
  );
  if (dup.rows[0]) {
    throw new AccountsHttpError('رقم فاتورة المورد مكرر لنفس المورد', 409);
  }

  const tolerance = await getPriceTolerancePercent(client);
  const override = input.override_tolerance === true;
  const poLineMap = new Map(
    (await listPurchaseOrderLines(client, poId, true)).map((l) => [l.id, l])
  );
  const seen = new Set<string>();
  const parsedLines: Array<{
    purchase_order_line_id: string;
    purchase_receipt_line_id: string | null;
    line_number: number;
    description: string;
    quantity: string;
    unit_price: string;
    discount_amount: string;
    tax_amount: string;
    line_total: string;
    expense_gl_account_id: string;
    cost_center_id: string | null;
  }> = [];

  for (let i = 0; i < input.lines.length; i++) {
    const raw = input.lines[i]!;
    const poLineId = String(raw.purchase_order_line_id ?? '').trim();
    if (!poLineId) throw new AccountsHttpError(`معرّف سطر الأمر مطلوب للسطر ${i + 1}`, 400);
    if (seen.has(poLineId)) throw new AccountsHttpError('سطر أمر مكرر في الفاتورة', 400);
    seen.add(poLineId);
    const poLine = poLineMap.get(poLineId);
    if (!poLine || poLine.purchase_order_id !== poId) {
      throw new AccountsHttpError(`سطر الأمر ${i + 1} لا ينتمي لهذا الأمر`, 409);
    }
    const qty = qtyPositive(raw.quantity, `كمية السطر ${i + 1}`);
    const avail = availableToInvoice(poLine);
    if (moneyToMillis(qty) > moneyToMillis(avail)) {
      throw new AccountsHttpError(
        `الكمية تتجاوز المتاح للفوترة في سطر الأمر ${poLine.line_number}`,
        409
      );
    }
    const unitPrice = moneyNonNeg(raw.unit_price ?? poLine.unit_price);
    if (!override && !isPriceWithinTolerance(poLine.unit_price, unitPrice, tolerance)) {
      throw new AccountsHttpError(
        `سعر الوحدة خارج نطاق التسامح في سطر الأمر ${poLine.line_number}`,
        409
      );
    }
    const disc = moneyNonNeg(raw.discount_amount ?? 0);
    const tax = moneyNonNeg(raw.tax_amount ?? 0);
    const lt = lineTotal(qty, unitPrice, disc, tax);
    const gl = await assertValidExpenseGlAccount(client, poLine.expense_gl_account_id);
    if (gl.id === account.payable_gl_account_id) {
      throw new AccountsHttpError('حساب المصروف لا يمكن أن يكون حساب الذمم الدائنة', 400);
    }

    let receiptLineId: string | null = null;
    if (raw.purchase_receipt_line_id != null && raw.purchase_receipt_line_id !== '') {
      receiptLineId = String(raw.purchase_receipt_line_id).trim();
      const rl = await txQuery(
        client,
        `SELECT prl.id FROM accounts.purchase_receipt_lines prl
         JOIN accounts.purchase_receipts pr ON pr.id = prl.receipt_id
         WHERE prl.id=$1::uuid AND prl.purchase_order_line_id=$2::uuid
           AND pr.purchase_order_id=$3::uuid AND pr.status='POSTED'`,
        [receiptLineId, poLineId, poId]
      );
      if (!rl.rows[0]) {
        throw new AccountsHttpError(`سطر محضر الاستلام ${i + 1} غير صالح`, 400);
      }
    }

    parsedLines.push({
      purchase_order_line_id: poLineId,
      purchase_receipt_line_id: receiptLineId,
      line_number: i + 1,
      description: poLine.description,
      quantity: qty,
      unit_price: unitPrice,
      discount_amount: disc,
      tax_amount: tax,
      line_total: lt,
      expense_gl_account_id: gl.id,
      cost_center_id: poLine.cost_center_id,
    });
  }

  const subtotal = sumMoney(parsedLines.map((l) => roundProduct(l.quantity, l.unit_price)));
  const discount = sumMoney(parsedLines.map((l) => l.discount_amount));
  const tax = sumMoney(parsedLines.map((l) => l.tax_amount));
  const total = sumMoney(parsedLines.map((l) => l.line_total));
  if (!moneyIsPositive(total)) {
    throw new AccountsHttpError('إجمالي الفاتورة يجب أن يكون أكبر من صفر', 400);
  }

  const headerExpenseGl = parsedLines[0]!.expense_gl_account_id;

  const invoiceDate =
    input.invoice_date != null && input.invoice_date !== ''
      ? pgDateOnly(String(input.invoice_date).trim())
      : pgDateOnly(new Date());

  await assertFiscalContextForEntry(client, {
    fiscalYearId: po.fiscal_year_id,
    fiscalPeriodId: po.fiscal_period_id,
    entryDate: invoiceDate,
  });

  let dueDate: string | null = null;
  if (input.due_date != null && input.due_date !== '') {
    dueDate = pgDateOnly(String(input.due_date).trim());
  } else if (po.payment_terms_days > 0) {
    const d = new Date(`${invoiceDate}T12:00:00`);
    d.setDate(d.getDate() + po.payment_terms_days);
    dueDate = pgDateOnly(d);
  }

  const description =
    input.description != null && String(input.description).trim()
      ? String(input.description).trim().slice(0, 2000)
      : `فاتورة أمر شراء ${po.purchase_order_number}`;

  const extRef =
    input.external_reference != null && input.external_reference !== ''
      ? String(input.external_reference).trim().slice(0, 100)
      : null;

  const invoiceNumber = await allocateSupplierInvoiceNumber(client, po.fiscal_year_id);

  const ins = await txQuery<SupplierInvoiceRow>(
    client,
    `INSERT INTO accounts.supplier_invoices (
       invoice_number, supplier_invoice_number, supplier_account_id, supplier_id,
       invoice_type_id, fiscal_year_id, fiscal_period_id, invoice_date, due_date,
       subtotal_amount, discount_amount, tax_amount, total_amount, outstanding_amount,
       currency_code, expense_gl_account_id, cost_center_id, description,
       external_reference, status, invoice_source, purchase_order_id,
       created_by, updated_by
     ) VALUES (
       $1,$2,$3::uuid,$4::uuid,NULL,$5::uuid,$6::uuid,$7::date,$8::date,
       $9::numeric,$10::numeric,$11::numeric,$12::numeric,0,
       $13,$14::uuid,$15::uuid,$16,$17,'DRAFT','PURCHASE_ORDER',$18::uuid,
       $19::uuid,$19::uuid
     ) RETURNING *`,
    [
      invoiceNumber,
      supplierInvoiceNumber,
      account.id,
      po.supplier_id,
      po.fiscal_year_id,
      po.fiscal_period_id,
      invoiceDate,
      dueDate,
      subtotal,
      discount,
      tax,
      total,
      po.currency_code,
      headerExpenseGl,
      parsedLines[0]?.cost_center_id ?? null,
      description,
      extRef,
      poId,
      input.created_by,
    ]
  );
  const invoice = ins.rows[0]!;

  const insertedLines: SupplierInvoiceLineRow[] = [];
  for (const l of parsedLines) {
    const r = await txQuery<SupplierInvoiceLineRow>(
      client,
      `INSERT INTO accounts.supplier_invoice_lines (
         supplier_invoice_id, purchase_order_line_id, purchase_receipt_line_id,
         line_number, description, quantity, unit_price, discount_amount, tax_amount,
         line_total, expense_gl_account_id, cost_center_id
       ) VALUES (
         $1::uuid,$2::uuid,$3::uuid,$4,$5,$6::numeric,$7::numeric,$8::numeric,$9::numeric,
         $10::numeric,$11::uuid,$12::uuid
       ) RETURNING *`,
      [
        invoice.id,
        l.purchase_order_line_id,
        l.purchase_receipt_line_id,
        l.line_number,
        l.description,
        l.quantity,
        l.unit_price,
        l.discount_amount,
        l.tax_amount,
        l.line_total,
        l.expense_gl_account_id,
        l.cost_center_id,
      ]
    );
    insertedLines.push(r.rows[0]!);
  }

  return { invoice, lines: insertedLines };
}
