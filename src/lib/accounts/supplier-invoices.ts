/**
 * فواتير الموردين + دفتر فرعي المورد — المرحلة 6.A
 * POST: Dr Expense / Cr Payables · VOID: عكس · الرصيد = Credits − Debits
 */
import {
  acquireAccountingResourceLocks,
  assetCapitalizationSourceLock,
  fixedAssetLock,
  glAccountLock,
  journalSourceLock,
  purchaseOrderLineLock,
  purchaseOrderLock,
  supplierAccountLock,
  supplierInvoiceLock,
  supplierInvoiceMatchLock,
  supplierLedgerLock,
  supplierLock,
} from './accounting-locks';
import { AccountsHttpError } from './auth';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { normalizeCurrencyCode } from './currency';
import {
  nextDocumentNumber,
  pgDateOnly,
  yearLabelFromDate,
} from './document-sequences';
import {
  allocateJournalEntryNumber,
  assertFiscalContextForEntry,
  createReversalEntry,
  loadJournalEntry,
  normalizeAndValidateLines,
  replaceJournalLines,
} from './journal-entries';
import {
  moneyEquals,
  moneyIsPositive,
  moneyIsZero,
  moneyToMillis,
  normalizeMoneyInput,
  normalizeSignedMoneyInput,
} from './money';
import { assertPostingAccount } from './posting-account';
import {
  assertSupplierAccountActiveForInvoices,
  assertValidPayableGlAccount,
  loadSupplierAccount,
} from './supplier-accounts';
import {
  assertValidAssetGlAccount,
  assertValidExpenseGlAccount,
  loadSupplierInvoiceType,
} from './supplier-invoice-types';
import { loadAssetCategory } from './asset-categories';
import {
  assertSupplierActiveForInvoices,
  loadSupplier,
} from './suppliers';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type SupplierInvoiceStatus =
  | 'DRAFT'
  | 'POSTED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'VOID';

export type SupplierInvoiceSource = 'MANUAL' | 'PURCHASE_ORDER';

export type SupplierInvoiceRow = {
  id: string;
  invoice_number: string;
  supplier_invoice_number: string;
  supplier_account_id: string;
  supplier_id: string;
  invoice_type_id: string | null;
  fiscal_year_id: string;
  fiscal_period_id: string;
  invoice_date: Date | string;
  due_date: Date | string | null;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  outstanding_amount: string;
  currency_code: string;
  expense_gl_account_id: string | null;
  cost_center_id: string | null;
  description: string;
  external_reference: string | null;
  invoice_source: SupplierInvoiceSource;
  purchase_order_id: string | null;
  status: SupplierInvoiceStatus;
  journal_entry_id: string | null;
  reversal_journal_entry_id: string | null;
  posted_at: Date | string | null;
  posted_by: string | null;
  voided_at: Date | string | null;
  voided_by: string | null;
  void_reason: string | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type SupplierInvoiceLineRow = {
  id: string;
  supplier_invoice_id: string;
  purchase_order_line_id: string | null;
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
  is_fixed_asset: boolean;
  asset_category_id: string | null;
  created_at: Date | string;
};

export type SupplierInvoiceListRow = SupplierInvoiceRow & {
  supplier_name_ar?: string | null;
  supplier_number?: string | null;
  invoice_type_code?: string | null;
  invoice_type_name_ar?: string | null;
  expense_gl_code?: string | null;
};

export type SupplierLedgerEntryRow = {
  id: string;
  supplier_account_id: string;
  supplier_id: string;
  entry_date: Date | string;
  entry_type: string;
  source_type: string;
  source_id: string;
  description: string;
  debit_amount: string;
  credit_amount: string;
  currency_code: string;
  journal_entry_id: string | null;
  created_by: string;
  created_at: Date | string;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function optText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, max);
  return s || null;
}

function requireDescription(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError('وصف الفاتورة مطلوب', 400);
  return s.slice(0, 2000);
}

function assertIqdOnly(value: unknown): string {
  const code = normalizeCurrencyCode(value, 'IQD');
  if (code !== 'IQD') {
    throw new AccountsHttpError('عملة فاتورة المورد في 6.A هي IQD فقط', 400);
  }
  return code;
}

function assertOptimistic(
  row: SupplierInvoiceRow,
  version: unknown,
  updatedAt: unknown
): void {
  assertCashSessionOptimisticConcurrency({
    currentVersion: row.version,
    currentUpdatedAt: row.updated_at,
    expectedVersion: version,
    expectedUpdatedAt: updatedAt,
  });
}

/** توحيد رقم فاتورة المورد الخارجي — فراغات زائدة + upper */
export function normalizeSupplierInvoiceNumber(value: unknown): string {
  const s = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
  if (!s) {
    throw new AccountsHttpError('رقم فاتورة المورد مطلوب', 400);
  }
  if (s.length > 80) {
    throw new AccountsHttpError('رقم فاتورة المورد طويل جداً', 400);
  }
  return s;
}

/** حساب total عبر millis لتجنب float وللسماح بطرح الخصم */
export function computeInvoiceTotalSafe(params: {
  subtotal: unknown;
  discount?: unknown;
  tax?: unknown;
}): {
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
} {
  let subtotal: string;
  let discount: string;
  let tax: string;
  try {
    subtotal = normalizeMoneyInput(params.subtotal);
    discount = normalizeMoneyInput(params.discount ?? 0);
    tax = normalizeMoneyInput(params.tax ?? 0);
  } catch {
    throw new AccountsHttpError('أحد مبالغ الفاتورة غير صالح', 400);
  }
  if (moneyToMillis(discount) > moneyToMillis(subtotal) + moneyToMillis(tax)) {
    throw new AccountsHttpError(
      'الخصم لا يمكن أن يقع أكبر من المجموع الفرعي والضريبة',
      400
    );
  }
  const totalMillis =
    moneyToMillis(subtotal) - moneyToMillis(discount) + moneyToMillis(tax);
  if (totalMillis <= BigInt(0)) {
    throw new AccountsHttpError('إجمالي الفاتورة يجب أن يكون أكبر من صفر', 400);
  }
  const intPart = totalMillis / BigInt(1000);
  const frac = (totalMillis % BigInt(1000)).toString().padStart(3, '0');
  return {
    subtotal,
    discount,
    tax,
    total: `${intPart}.${frac}`,
  };
}

export function serializeSupplierInvoice(row: SupplierInvoiceRow) {
  return {
    ...row,
    invoice_date: pgDateOnly(row.invoice_date),
    due_date: row.due_date ? pgDateOnly(row.due_date) : null,
    subtotal_amount: normalizeMoneyInput(row.subtotal_amount),
    discount_amount: normalizeMoneyInput(row.discount_amount),
    tax_amount: normalizeMoneyInput(row.tax_amount),
    total_amount: normalizeMoneyInput(row.total_amount),
    outstanding_amount: normalizeMoneyInput(row.outstanding_amount),
    posted_at: iso(row.posted_at),
    voided_at: iso(row.voided_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export function serializeSupplierLedgerEntry(row: SupplierLedgerEntryRow) {
  return {
    ...row,
    entry_date: pgDateOnly(row.entry_date),
    debit_amount: normalizeMoneyInput(row.debit_amount),
    credit_amount: normalizeMoneyInput(row.credit_amount),
    created_at: iso(row.created_at)!,
  };
}

async function resolveOpenFiscalForDate(
  client: TxClient,
  invoiceDate: string
): Promise<{ fiscalYearId: string; fiscalPeriodId: string }> {
  const r = await txQuery<{ year_id: string; period_id: string }>(
    client,
    `SELECT y.id AS year_id, p.id AS period_id
     FROM accounts.fiscal_years y
     JOIN accounts.fiscal_periods p ON p.fiscal_year_id = y.id
     WHERE y.status = 'ACTIVE'
       AND p.status = 'OPEN'
       AND p.start_date <= $1::date
       AND p.end_date >= $1::date
     ORDER BY y.is_default DESC, p.start_date
     LIMIT 1`,
    [invoiceDate]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError(
      'لا توجد فترة مالية مفتوحة تغطي تاريخ الفاتورة',
      409
    );
  }
  return {
    fiscalYearId: r.rows[0].year_id,
    fiscalPeriodId: r.rows[0].period_id,
  };
}

export async function allocateSupplierInvoiceNumber(
  client: TxClient,
  fiscalYearId: string
): Promise<string> {
  const year = await txQuery<{ start_date: string }>(
    client,
    `SELECT start_date::text AS start_date FROM accounts.fiscal_years WHERE id = $1`,
    [fiscalYearId]
  );
  if (!year.rows[0]) {
    throw new AccountsHttpError('السنة المالية غير موجودة', 404);
  }
  await txQuery(
    client,
    `INSERT INTO accounts.document_sequences
      (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
     SELECT 'SUPPLIER_INVOICE', $1::uuid, 'SIN', 0, 6, TRUE, TRUE
     WHERE NOT EXISTS (
       SELECT 1 FROM accounts.document_sequences
       WHERE document_type = 'SUPPLIER_INVOICE' AND fiscal_year_id = $1::uuid
     )`,
    [fiscalYearId]
  );
  try {
    const seq = await nextDocumentNumber(client, {
      documentType: 'SUPPLIER_INVOICE',
      fiscalYearId,
      yearLabel: yearLabelFromDate(year.rows[0].start_date),
    });
    return seq.formatted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'تعذر تخصيص رقم فاتورة المورد';
    throw new AccountsHttpError(msg, 409);
  }
}

export async function loadSupplierInvoice(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<SupplierInvoiceRow> {
  const r = await txQuery<SupplierInvoiceRow>(
    client,
    `SELECT * FROM accounts.supplier_invoices WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('فاتورة المورد غير موجودة', 404);
  return r.rows[0];
}

export async function listSupplierInvoiceLines(
  client: TxClient,
  supplierInvoiceId: string
): Promise<SupplierInvoiceLineRow[]> {
  const r = await txQuery<SupplierInvoiceLineRow>(
    client,
    `SELECT * FROM accounts.supplier_invoice_lines
     WHERE supplier_invoice_id = $1::uuid
     ORDER BY line_number`,
    [supplierInvoiceId]
  );
  return r.rows;
}

async function assertCostCenterActive(
  client: TxClient,
  costCenterId: string
): Promise<void> {
  const r = await txQuery(
    client,
    `SELECT id FROM accounts.cost_centers
     WHERE id = $1::uuid AND is_active = TRUE`,
    [costCenterId]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('مركز الكلفة غير موجود أو غير فعّال', 400);
  }
}

async function assertUniqueSupplierInvoiceNumber(
  client: TxClient,
  supplierId: string,
  supplierInvoiceNumber: string,
  excludeId?: string
): Promise<void> {
  const r = await txQuery(
    client,
    `SELECT 1 FROM accounts.supplier_invoices
     WHERE supplier_id = $1::uuid
       AND supplier_invoice_number = $2
       AND ($3::uuid IS NULL OR id <> $3::uuid)
     LIMIT 1`,
    [supplierId, supplierInvoiceNumber, excludeId ?? null]
  );
  if (r.rows[0]) {
    throw new AccountsHttpError(
      'رقم فاتورة المورد مكرر لنفس المورد',
      409
    );
  }
}

/** حقن أعطال للاختبارات — يثبت rollback إن فشل الدفتر بعد إنشاء القيد */
let __supplierInvoicePostFault: null | 'after_journal' | 'after_ledger' =
  null;
export function setSupplierInvoicePostFaultForTests(
  v: typeof __supplierInvoicePostFault
): void {
  __supplierInvoicePostFault = v;
}

export async function writeSupplierLedgerEntry(
  client: TxClient,
  params: {
    accountId: string;
    supplierId: string;
    entryDate: string;
    entryType: 'INVOICE' | 'INVOICE_REVERSAL' | 'PAYMENT' | 'PAYMENT_REVERSAL';
    sourceType: string;
    sourceId: string;
    description: string;
    debit: string;
    credit: string;
    currencyCode: string;
    journalEntryId: string | null;
    userId: string;
  }
): Promise<void> {
  await txQuery(
    client,
    `INSERT INTO accounts.supplier_ledger_entries (
       supplier_account_id, supplier_id, entry_date, entry_type,
       source_type, source_id, description, debit_amount, credit_amount,
       currency_code, journal_entry_id, created_by
     ) VALUES (
       $1::uuid,$2::uuid,$3::date,$4,$5,$6::uuid,$7,
       $8::numeric,$9::numeric,$10,$11::uuid,$12::uuid
     )`,
    [
      params.accountId,
      params.supplierId,
      params.entryDate,
      params.entryType,
      params.sourceType,
      params.sourceId,
      params.description,
      params.debit,
      params.credit,
      params.currencyCode,
      params.journalEntryId,
      params.userId,
    ]
  );
}

export async function createSupplierInvoice(
  client: TxClient,
  input: {
    supplier_id?: unknown;
    supplier_account_id?: unknown;
    supplier_invoice_number: unknown;
    invoice_type_id?: unknown;
    invoice_date?: unknown;
    due_date?: unknown;
    subtotal_amount: unknown;
    discount_amount?: unknown;
    tax_amount?: unknown;
    expense_gl_account_id?: unknown;
    cost_center_id?: unknown;
    description?: unknown;
    external_reference?: unknown;
    fiscal_year_id?: unknown;
    fiscal_period_id?: unknown;
    currency_code?: unknown;
    created_by: string;
  }
): Promise<SupplierInvoiceRow> {
  let accountId = String(input.supplier_account_id ?? '').trim();
  const supplierIdInput = String(input.supplier_id ?? '').trim();

  if (!accountId && supplierIdInput) {
    const found = await txQuery<{ id: string }>(
      client,
      `SELECT id FROM accounts.supplier_accounts
       WHERE supplier_id = $1::uuid AND currency_code = 'IQD' AND status = 'ACTIVE'
       LIMIT 1`,
      [supplierIdInput]
    );
    if (!found.rows[0]) {
      throw new AccountsHttpError(
        'لا يوجد حساب مالي فعّال لهذا المورد — أنشئ الحساب أولاً',
        409
      );
    }
    accountId = found.rows[0].id;
  }
  if (!accountId) {
    throw new AccountsHttpError('الحساب المالي للمورد مطلوب', 400);
  }

  const account = await loadSupplierAccount(client, accountId, true);
  await assertSupplierAccountActiveForInvoices(client, account);
  const supplier = await loadSupplier(client, account.supplier_id, true);
  await assertSupplierActiveForInvoices(client, supplier);

  const supplierInvoiceNumber = normalizeSupplierInvoiceNumber(
    input.supplier_invoice_number
  );
  await assertUniqueSupplierInvoiceNumber(
    client,
    account.supplier_id,
    supplierInvoiceNumber
  );

  let invoiceTypeId: string | null = null;
  let typeRequiresCc = false;
  let defaultExpense: string | null = null;
  let defaultCc: string | null = null;

  if (input.invoice_type_id != null && input.invoice_type_id !== '') {
    invoiceTypeId = String(input.invoice_type_id).trim();
    const invType = await loadSupplierInvoiceType(client, invoiceTypeId, true);
    if (!invType.is_active) {
      throw new AccountsHttpError('نوع الفاتورة غير فعّال', 409);
    }
    typeRequiresCc = invType.requires_cost_center;
    defaultExpense = invType.default_expense_gl_account_id;
    defaultCc = invType.default_cost_center_id;
  }

  const amounts = computeInvoiceTotalSafe({
    subtotal: input.subtotal_amount,
    discount: input.discount_amount,
    tax: input.tax_amount,
  });

  const currency = assertIqdOnly(input.currency_code ?? account.currency_code);
  if (currency !== account.currency_code) {
    throw new AccountsHttpError('عملة الفاتورة لا تطابق عملة الحساب', 409);
  }

  let expenseGlId = String(
    input.expense_gl_account_id ?? defaultExpense ?? ''
  ).trim();
  if (!expenseGlId) {
    throw new AccountsHttpError('حساب المصروف مطلوب', 400);
  }
  const expenseGl = await assertValidExpenseGlAccount(client, expenseGlId);
  expenseGlId = expenseGl.id;

  if (expenseGlId === account.payable_gl_account_id) {
    throw new AccountsHttpError(
      'لا يمكن أن يكون حساب المصروف هو نفسه حساب الذمم الدائنة',
      400
    );
  }

  const costCenterId: string | null =
    input.cost_center_id != null && input.cost_center_id !== ''
      ? String(input.cost_center_id).trim()
      : defaultCc;

  const payableGl = await assertValidPayableGlAccount(
    client,
    account.payable_gl_account_id
  );

  if (
    (typeRequiresCc ||
      expenseGl.requires_cost_center ||
      payableGl.requires_cost_center) &&
    !costCenterId
  ) {
    throw new AccountsHttpError('مركز الكلفة مطلوب لهذه الفاتورة', 400);
  }
  if (costCenterId) await assertCostCenterActive(client, costCenterId);

  const invoiceDate =
    input.invoice_date != null && input.invoice_date !== ''
      ? pgDateOnly(String(input.invoice_date).trim())
      : pgDateOnly(new Date());

  let fiscalYearId =
    input.fiscal_year_id != null && input.fiscal_year_id !== ''
      ? String(input.fiscal_year_id).trim()
      : '';
  let fiscalPeriodId =
    input.fiscal_period_id != null && input.fiscal_period_id !== ''
      ? String(input.fiscal_period_id).trim()
      : '';

  if (!fiscalYearId || !fiscalPeriodId) {
    const resolved = await resolveOpenFiscalForDate(client, invoiceDate);
    fiscalYearId = fiscalYearId || resolved.fiscalYearId;
    fiscalPeriodId = fiscalPeriodId || resolved.fiscalPeriodId;
  }

  await assertFiscalContextForEntry(client, {
    fiscalYearId,
    fiscalPeriodId,
    entryDate: invoiceDate,
  });

  let dueDate: string | null = null;
  if (input.due_date != null && input.due_date !== '') {
    dueDate = pgDateOnly(String(input.due_date).trim());
  } else if (supplier.payment_terms_days > 0) {
    const d = new Date(`${invoiceDate}T12:00:00`);
    d.setDate(d.getDate() + supplier.payment_terms_days);
    dueDate = pgDateOnly(d);
  }

  const description =
    input.description != null && String(input.description).trim()
      ? requireDescription(input.description)
      : `فاتورة مورد ${supplierInvoiceNumber}`;

  const invoiceNumber = await allocateSupplierInvoiceNumber(
    client,
    fiscalYearId
  );

  const ins = await txQuery<SupplierInvoiceRow>(
    client,
    `INSERT INTO accounts.supplier_invoices (
       invoice_number, supplier_invoice_number, supplier_account_id, supplier_id,
       invoice_type_id, fiscal_year_id, fiscal_period_id, invoice_date, due_date,
       subtotal_amount, discount_amount, tax_amount, total_amount, outstanding_amount,
       currency_code, expense_gl_account_id, cost_center_id, description,
       external_reference, status, created_by, updated_by
     ) VALUES (
       $1,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::date,$9::date,
       $10::numeric,$11::numeric,$12::numeric,$13::numeric,0,
       $14,$15::uuid,$16::uuid,$17,$18,'DRAFT',$19::uuid,$19::uuid
     ) RETURNING *`,
    [
      invoiceNumber,
      supplierInvoiceNumber,
      account.id,
      account.supplier_id,
      invoiceTypeId,
      fiscalYearId,
      fiscalPeriodId,
      invoiceDate,
      dueDate,
      amounts.subtotal,
      amounts.discount,
      amounts.tax,
      amounts.total,
      currency,
      expenseGlId,
      costCenterId,
      description,
      optText(input.external_reference, 100),
      input.created_by,
    ]
  );
  return ins.rows[0];
}

export async function updateSupplierInvoice(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    supplier_invoice_number?: unknown;
    invoice_type_id?: unknown;
    invoice_date?: unknown;
    due_date?: unknown;
    subtotal_amount?: unknown;
    discount_amount?: unknown;
    tax_amount?: unknown;
    expense_gl_account_id?: unknown;
    cost_center_id?: unknown;
    description?: unknown;
    external_reference?: unknown;
    fiscal_year_id?: unknown;
    fiscal_period_id?: unknown;
  }
): Promise<SupplierInvoiceRow> {
  const invoice = await loadSupplierInvoice(client, params.id, true);
  assertOptimistic(invoice, params.version, params.updated_at);
  if (invoice.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن تعديل المسودات فقط', 409);
  }

  const account = await loadSupplierAccount(
    client,
    invoice.supplier_account_id,
    true
  );
  await assertSupplierAccountActiveForInvoices(client, account);
  const supplier = await loadSupplier(client, account.supplier_id, true);
  await assertSupplierActiveForInvoices(client, supplier);

  let supplierInvoiceNumber = invoice.supplier_invoice_number;
  if (params.supplier_invoice_number !== undefined) {
    supplierInvoiceNumber = normalizeSupplierInvoiceNumber(
      params.supplier_invoice_number
    );
    await assertUniqueSupplierInvoiceNumber(
      client,
      account.supplier_id,
      supplierInvoiceNumber,
      invoice.id
    );
  }

  let invoiceTypeId = invoice.invoice_type_id;
  let typeRequiresCc = false;
  if (params.invoice_type_id !== undefined) {
    if (params.invoice_type_id === null || params.invoice_type_id === '') {
      invoiceTypeId = null;
    } else {
      invoiceTypeId = String(params.invoice_type_id).trim();
      const invType = await loadSupplierInvoiceType(client, invoiceTypeId, true);
      if (!invType.is_active) {
        throw new AccountsHttpError('نوع الفاتورة غير فعّال', 409);
      }
      typeRequiresCc = invType.requires_cost_center;
    }
  } else if (invoiceTypeId) {
    const invType = await loadSupplierInvoiceType(client, invoiceTypeId, false);
    typeRequiresCc = invType.requires_cost_center;
  }

  const amounts = computeInvoiceTotalSafe({
    subtotal:
      params.subtotal_amount !== undefined
        ? params.subtotal_amount
        : invoice.subtotal_amount,
    discount:
      params.discount_amount !== undefined
        ? params.discount_amount
        : invoice.discount_amount,
    tax:
      params.tax_amount !== undefined
        ? params.tax_amount
        : invoice.tax_amount,
  });

  let expenseGlId = invoice.expense_gl_account_id;
  if (
    params.expense_gl_account_id !== undefined &&
    params.expense_gl_account_id !== ''
  ) {
    const gl = await assertValidExpenseGlAccount(
      client,
      String(params.expense_gl_account_id)
    );
    expenseGlId = gl.id;
  }
  if (!expenseGlId) {
    throw new AccountsHttpError('حساب المصروف مطلوب', 400);
  }
  const expenseGl = await assertValidExpenseGlAccount(client, expenseGlId);
  if (expenseGlId === account.payable_gl_account_id) {
    throw new AccountsHttpError(
      'لا يمكن أن يكون حساب المصروف هو نفسه حساب الذمم الدائنة',
      400
    );
  }

  let costCenterId = invoice.cost_center_id;
  if (params.cost_center_id !== undefined) {
    costCenterId =
      params.cost_center_id === null || params.cost_center_id === ''
        ? null
        : String(params.cost_center_id).trim();
  }

  const payableGl = await assertValidPayableGlAccount(
    client,
    account.payable_gl_account_id
  );
  if (
    (typeRequiresCc ||
      expenseGl.requires_cost_center ||
      payableGl.requires_cost_center) &&
    !costCenterId
  ) {
    throw new AccountsHttpError('مركز الكلفة مطلوب لهذه الفاتورة', 400);
  }
  if (costCenterId) await assertCostCenterActive(client, costCenterId);

  const invoiceDate =
    params.invoice_date !== undefined && params.invoice_date !== ''
      ? pgDateOnly(String(params.invoice_date).trim())
      : pgDateOnly(invoice.invoice_date);

  let fiscalYearId = invoice.fiscal_year_id;
  let fiscalPeriodId = invoice.fiscal_period_id;
  if (params.fiscal_year_id !== undefined && params.fiscal_year_id !== '') {
    fiscalYearId = String(params.fiscal_year_id).trim();
  }
  if (params.fiscal_period_id !== undefined && params.fiscal_period_id !== '') {
    fiscalPeriodId = String(params.fiscal_period_id).trim();
  }
  if (
    params.invoice_date !== undefined ||
    params.fiscal_year_id !== undefined ||
    params.fiscal_period_id !== undefined
  ) {
    if (
      params.fiscal_year_id === undefined &&
      params.fiscal_period_id === undefined
    ) {
      const resolved = await resolveOpenFiscalForDate(client, invoiceDate);
      fiscalYearId = resolved.fiscalYearId;
      fiscalPeriodId = resolved.fiscalPeriodId;
    }
  }
  await assertFiscalContextForEntry(client, {
    fiscalYearId,
    fiscalPeriodId,
    entryDate: invoiceDate,
  });

  let dueDate = invoice.due_date ? pgDateOnly(invoice.due_date) : null;
  if (params.due_date !== undefined) {
    dueDate =
      params.due_date === null || params.due_date === ''
        ? null
        : pgDateOnly(String(params.due_date).trim());
  }

  const upd = await txQuery<SupplierInvoiceRow>(
    client,
    `UPDATE accounts.supplier_invoices SET
       supplier_invoice_number = $2,
       invoice_type_id = $3::uuid,
       fiscal_year_id = $4::uuid,
       fiscal_period_id = $5::uuid,
       invoice_date = $6::date,
       due_date = $7::date,
       subtotal_amount = $8::numeric,
       discount_amount = $9::numeric,
       tax_amount = $10::numeric,
       total_amount = $11::numeric,
       expense_gl_account_id = $12::uuid,
       cost_center_id = $13::uuid,
       description = $14,
       external_reference = $15,
       updated_by = $16::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      invoice.id,
      supplierInvoiceNumber,
      invoiceTypeId,
      fiscalYearId,
      fiscalPeriodId,
      invoiceDate,
      dueDate,
      amounts.subtotal,
      amounts.discount,
      amounts.tax,
      amounts.total,
      expenseGlId,
      costCenterId,
      params.description !== undefined
        ? requireDescription(params.description)
        : invoice.description,
      params.external_reference !== undefined
        ? optText(params.external_reference, 100)
        : invoice.external_reference,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function postSupplierInvoice(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<{ invoice: SupplierInvoiceRow; created: boolean }> {
  const invoice = await loadSupplierInvoice(client, params.id, true);

  if (invoice.status === 'POSTED' && invoice.journal_entry_id) {
    return { invoice, created: false };
  }
  if (invoice.status === 'VOID') {
    throw new AccountsHttpError('لا يمكن ترحيل فاتورة ملغاة', 409);
  }
  if (invoice.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن ترحيل المسودات فقط', 409);
  }
  assertOptimistic(invoice, params.version, params.updated_at);

  const accountPeek = await loadSupplierAccount(
    client,
    invoice.supplier_account_id,
    false
  );

  const invoiceLines = await listSupplierInvoiceLines(client, invoice.id);
  const isPoInvoice = invoice.invoice_source === 'PURCHASE_ORDER';
  const hasLines = invoiceLines.length > 0;

  // توجيه سطور الأصول الثابتة (8.A): السطر المعلَّم is_fixed_asset ولديه تصنيف أصل
  // يُرحَّل Dr حساب الأصل (asset_categories.asset_gl_account_id) بدل Dr المصروف.
  // السطور العادية — وسطور FIXED_ASSET_CANDIDATE بلا تصنيف — تبقى Dr Expense كما في 7.A (بلا تغيير).
  const lineAssetGl = new Map<string, string>();
  for (const l of invoiceLines) {
    if (l.is_fixed_asset && l.asset_category_id) {
      const category = await loadAssetCategory(client, l.asset_category_id);
      lineAssetGl.set(l.id, category.asset_gl_account_id);
    }
  }

  if (isPoInvoice && !hasLines) {
    throw new AccountsHttpError('فاتورة أمر الشراء يجب أن تحتوي على سطور', 409);
  }
  if (!isPoInvoice && !hasLines && !invoice.expense_gl_account_id) {
    throw new AccountsHttpError('حساب المصروف مطلوب', 400);
  }

  const lockResources = [
    supplierInvoiceLock(invoice.id),
    supplierAccountLock(invoice.supplier_account_id),
    supplierLedgerLock(invoice.supplier_account_id),
    supplierLock(invoice.supplier_id),
    glAccountLock(accountPeek.payable_gl_account_id),
    journalSourceLock('SUPPLIER_INVOICE', invoice.id),
  ];
  if (invoice.expense_gl_account_id) {
    lockResources.push(glAccountLock(invoice.expense_gl_account_id));
  }
  if (isPoInvoice && invoice.purchase_order_id) {
    lockResources.push(purchaseOrderLock(invoice.purchase_order_id));
    lockResources.push(supplierInvoiceMatchLock(invoice.purchase_order_id));
    for (const l of invoiceLines) {
      if (l.purchase_order_line_id) {
        lockResources.push(purchaseOrderLineLock(l.purchase_order_line_id));
      }
      lockResources.push(glAccountLock(lineAssetGl.get(l.id) ?? l.expense_gl_account_id));
    }
  } else if (hasLines) {
    for (const l of invoiceLines) {
      lockResources.push(glAccountLock(lineAssetGl.get(l.id) ?? l.expense_gl_account_id));
    }
  }

  await acquireAccountingResourceLocks(client, lockResources);

  const account = await loadSupplierAccount(
    client,
    invoice.supplier_account_id,
    true
  );
  await assertSupplierAccountActiveForInvoices(client, account);
  const supplier = await loadSupplier(client, account.supplier_id, true);
  await assertSupplierActiveForInvoices(client, supplier);

  if (invoice.invoice_type_id) {
    const invType = await loadSupplierInvoiceType(
      client,
      invoice.invoice_type_id,
      true
    );
    if (!invType.is_active) {
      throw new AccountsHttpError('نوع الفاتورة غير فعّال', 409);
    }
  }

  const invoiceDate = pgDateOnly(invoice.invoice_date);
  await assertFiscalContextForEntry(client, {
    fiscalYearId: invoice.fiscal_year_id,
    fiscalPeriodId: invoice.fiscal_period_id,
    entryDate: invoiceDate,
  });

  const payableGl = await assertValidPayableGlAccount(
    client,
    account.payable_gl_account_id
  );

  const amount = normalizeMoneyInput(invoice.total_amount);
  if (!moneyIsPositive(amount)) {
    throw new AccountsHttpError('إجمالي الفاتورة غير صالح', 400);
  }

  let costCenterId = invoice.cost_center_id;
  let typeRequiresCc = false;
  if (invoice.invoice_type_id) {
    const invType = await loadSupplierInvoiceType(
      client,
      invoice.invoice_type_id,
      false
    );
    typeRequiresCc = invType.requires_cost_center;
    if (!costCenterId) costCenterId = invType.default_cost_center_id;
  }

  const linesInput: Array<{
    account_id: string;
    cost_center_id: string | null;
    debit_amount: string;
    credit_amount: string;
    description: string;
  }> = [];

  if (hasLines) {
    for (const line of invoiceLines) {
      const assetGlId = lineAssetGl.get(line.id);
      let postingAccountId: string;
      let requiresCc: boolean;
      if (assetGlId) {
        // سطر أصل ثابت → Dr حساب الأصل (بدل حساب المصروف)؛ الباقي (Cr ذمم دائنة، الإجمالي، الكمية) دون تغيير.
        const assetGl = await assertValidAssetGlAccount(client, assetGlId);
        postingAccountId = assetGl.id;
        requiresCc = assetGl.requires_cost_center;
      } else {
        // سلوك 7.A الأصلي لسطور المصروف — دون أي تغيير.
        const expenseGl = await assertValidExpenseGlAccount(
          client,
          line.expense_gl_account_id
        );
        await assertPostingAccount(
          client,
          line.expense_gl_account_id,
          'حساب المصروف',
          { invalidStatusCode: 400 }
        );
        postingAccountId = line.expense_gl_account_id;
        requiresCc = expenseGl.requires_cost_center;
      }
      const lineCc = line.cost_center_id ?? costCenterId;
      if (
        (typeRequiresCc || requiresCc || payableGl.requires_cost_center) &&
        !lineCc
      ) {
        throw new AccountsHttpError('أحد الحسابات يتطلب مركز كلفة', 409);
      }
      if (lineCc) await assertCostCenterActive(client, lineCc);
      const lineAmount = normalizeMoneyInput(line.line_total);
      linesInput.push({
        account_id: postingAccountId,
        cost_center_id: lineCc,
        debit_amount: lineAmount,
        credit_amount: '0',
        description: line.description,
      });
    }
    linesInput.push({
      account_id: account.payable_gl_account_id,
      cost_center_id: costCenterId,
      debit_amount: '0',
      credit_amount: amount,
      description: `ذمم دائنة — ${invoice.invoice_number}`,
    });
  } else {
    const expenseGl = await assertValidExpenseGlAccount(
      client,
      invoice.expense_gl_account_id!
    );
    await assertPostingAccount(
      client,
      invoice.expense_gl_account_id!,
      'حساب المصروف',
      { invalidStatusCode: 400 }
    );
    if (
      (typeRequiresCc ||
        expenseGl.requires_cost_center ||
        payableGl.requires_cost_center) &&
      !costCenterId
    ) {
      throw new AccountsHttpError('أحد الحسابات يتطلب مركز كلفة', 409);
    }
    if (costCenterId) await assertCostCenterActive(client, costCenterId);
    linesInput.push(
      {
        account_id: invoice.expense_gl_account_id!,
        cost_center_id: costCenterId,
        debit_amount: amount,
        credit_amount: '0',
        description: invoice.description,
      },
      {
        account_id: account.payable_gl_account_id,
        cost_center_id: costCenterId,
        debit_amount: '0',
        credit_amount: amount,
        description: `ذمم دائنة — ${invoice.invoice_number}`,
      }
    );
  }

  const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
    client,
    linesInput,
    'strict'
  );

  const entryNumber = await allocateJournalEntryNumber(
    client,
    invoice.fiscal_year_id
  );

  const jeDesc = [
    'فاتورة مورد',
    invoice.invoice_number,
    invoice.supplier_invoice_number,
    invoice.description,
  ]
    .filter(Boolean)
    .join(' — ');

  const jeIns = await txQuery<{ id: string }>(
    client,
    `INSERT INTO accounts.journal_entries
      (entry_number, fiscal_year_id, fiscal_period_id, entry_date, entry_type,
       source_type, source_id, reference_number, description,
       total_debit, total_credit, status,
       version, created_by, updated_by, posted_by, posted_at)
     VALUES
      ($1, $2::uuid, $3::uuid, $4::date, 'ADJUSTMENT',
       'SUPPLIER_INVOICE', $5::uuid, $6, $7,
       $8::numeric, $9::numeric, 'POSTED',
       1, $10::uuid, $10::uuid, $10::uuid, NOW())
     RETURNING id`,
    [
      entryNumber,
      invoice.fiscal_year_id,
      invoice.fiscal_period_id,
      invoiceDate,
      invoice.id,
      invoice.external_reference || invoice.supplier_invoice_number,
      jeDesc,
      totalDebit,
      totalCredit,
      params.userId,
    ]
  );
  const journalId = jeIns.rows[0].id as string;
  await replaceJournalLines(client, journalId, lines);

  if (__supplierInvoicePostFault === 'after_journal') {
    throw new Error('FAULT_AFTER_JOURNAL');
  }

  await writeSupplierLedgerEntry(client, {
    accountId: account.id,
    supplierId: account.supplier_id,
    entryDate: invoiceDate,
    entryType: 'INVOICE',
    sourceType: 'SUPPLIER_INVOICE',
    sourceId: invoice.id,
    description: jeDesc,
    debit: '0',
    credit: amount,
    currencyCode: invoice.currency_code,
    journalEntryId: journalId,
    userId: params.userId,
  });

  if (__supplierInvoicePostFault === 'after_ledger') {
    throw new Error('FAULT_AFTER_LEDGER');
  }

  if (isPoInvoice) {
    const { applyPurchaseOrderInvoicePostQuantities } = await import(
      './purchase-invoice-matching'
    );
    await applyPurchaseOrderInvoicePostQuantities(client, invoice.id);
  }

  const posted = await txQuery<SupplierInvoiceRow>(
    client,
    `UPDATE accounts.supplier_invoices SET
       status = 'POSTED',
       outstanding_amount = total_amount,
       cost_center_id = COALESCE($4::uuid, cost_center_id),
       journal_entry_id = $2::uuid,
       posted_by = $3::uuid,
       posted_at = NOW(),
       updated_by = $3::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [invoice.id, journalId, params.userId, costCenterId]
  );
  return { invoice: posted.rows[0], created: true };
}

export async function voidSupplierInvoice(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason?: unknown;
  }
): Promise<SupplierInvoiceRow> {
  const invoice = await loadSupplierInvoice(client, params.id, true);
  assertOptimistic(invoice, params.version, params.updated_at);

  if (invoice.status === 'VOID') {
    return invoice;
  }

  if (invoice.status === 'PARTIALLY_PAID' || invoice.status === 'PAID') {
    throw new AccountsHttpError(
      'لا يمكن إلغاء فاتورة مدفوعة جزئياً أو كلياً — استخدم إشعار دائن أو عكس دفعة (6.B)',
      409
    );
  }

  const accountPeek = await loadSupplierAccount(
    client,
    invoice.supplier_account_id,
    false
  );

  const isPoInvoice = invoice.invoice_source === 'PURCHASE_ORDER';
  const voidLocks = [
    supplierInvoiceLock(invoice.id),
    supplierAccountLock(invoice.supplier_account_id),
    supplierLedgerLock(invoice.supplier_account_id),
    supplierLock(invoice.supplier_id),
    glAccountLock(accountPeek.payable_gl_account_id),
    journalSourceLock('SUPPLIER_INVOICE', invoice.id),
    journalSourceLock('SUPPLIER_INVOICE_REVERSAL', invoice.id),
  ];
  if (invoice.expense_gl_account_id) {
    voidLocks.push(glAccountLock(invoice.expense_gl_account_id));
  }
  if (isPoInvoice && invoice.purchase_order_id) {
    voidLocks.push(purchaseOrderLock(invoice.purchase_order_id));
    voidLocks.push(supplierInvoiceMatchLock(invoice.purchase_order_id));
    const invLines = await listSupplierInvoiceLines(client, invoice.id);
    for (const l of invLines) {
      if (l.purchase_order_line_id) {
        voidLocks.push(purchaseOrderLineLock(l.purchase_order_line_id));
      }
      // سطر أصل ثابت رُحِّل Dr حساب الأصل → نقفل حساب الأصل (متماثل مع الترحيل) بدل حساب المصروف.
      if (l.is_fixed_asset && l.asset_category_id) {
        const category = await loadAssetCategory(client, l.asset_category_id);
        voidLocks.push(glAccountLock(category.asset_gl_account_id));
      } else {
        voidLocks.push(glAccountLock(l.expense_gl_account_id));
      }
    }
  }

  // (8.A) رأس مالية: نقفل مصادر الرسملة والأصول الثابتة المرتبطة قبل الفحص
  // لضمان الذرّية ومنع سباق VOID/Capitalization. الترتيب يُطبَّع داخل acquireAccountingResourceLocks.
  const capSourcePeek = await txQuery<{
    id: string;
    fixed_asset_id: string;
  }>(
    client,
    `SELECT id, fixed_asset_id
       FROM accounts.asset_capitalization_sources
      WHERE supplier_invoice_id = $1::uuid`,
    [invoice.id]
  );
  for (const cs of capSourcePeek.rows) {
    voidLocks.push(assetCapitalizationSourceLock(cs.id));
    voidLocks.push(fixedAssetLock(cs.fixed_asset_id));
  }

  await acquireAccountingResourceLocks(client, voidLocks);

  // (8.A) منع إلغاء فاتورة مورد رُسملت منها أصول ثابتة فعّالة.
  // السياسة: يُسمح بالإلغاء فقط إذا لم تبقَ أي أصول مرتبطة غير مُلغاة (CANCELLED)
  // ولا توجد أي حركات/إهلاك/عهدة/استبعاد مرتبطة بأي أصل من هذه الفاتورة.
  if (capSourcePeek.rows.length > 0) {
    const assetGuard = await txQuery<{
      id: string;
      asset_number: string | null;
      status: string;
      has_depreciation: boolean;
      has_movement: boolean;
      has_custody: boolean;
      has_disposal: boolean;
    }>(
      client,
      `SELECT fa.id,
              fa.asset_number,
              fa.status,
              EXISTS (
                SELECT 1 FROM accounts.depreciation_run_lines drl
                 WHERE drl.fixed_asset_id = fa.id
              ) AS has_depreciation,
              EXISTS (
                SELECT 1 FROM accounts.asset_movements am
                 WHERE am.fixed_asset_id = fa.id
              ) AS has_movement,
              EXISTS (
                SELECT 1 FROM accounts.asset_custody_history ach
                 WHERE ach.fixed_asset_id = fa.id
              ) AS has_custody,
              EXISTS (
                SELECT 1 FROM accounts.asset_disposals ad
                 WHERE ad.fixed_asset_id = fa.id
              ) AS has_disposal
         FROM accounts.asset_capitalization_sources acs
         JOIN accounts.fixed_assets fa ON fa.id = acs.fixed_asset_id
        WHERE acs.supplier_invoice_id = $1::uuid`,
      [invoice.id]
    );

    const blocking = assetGuard.rows.some(
      (r) =>
        r.status !== 'CANCELLED' ||
        r.has_depreciation ||
        r.has_movement ||
        r.has_custody ||
        r.has_disposal
    );
    if (blocking) {
      throw new AccountsHttpError(
        'لا يمكن إلغاء فاتورة المورد لأنها مرتبطة بأصول ثابتة. يجب إلغاء الأصول المسودة المرتبطة أولًا، ولا يمكن إلغاء الفاتورة بعد تفعيل الأصل أو وجود حركة أو إهلاك أو استبعاد عليه.',
        409
      );
    }
  }

  const account = await loadSupplierAccount(
    client,
    invoice.supplier_account_id,
    true
  );
  if (account.status === 'CLOSED') {
    throw new AccountsHttpError(
      'لا يمكن إلغاء فاتورة مرتبطة بحساب مالي مغلق',
      409
    );
  }

  if (invoice.status === 'DRAFT') {
    const upd = await txQuery<SupplierInvoiceRow>(
      client,
      `UPDATE accounts.supplier_invoices SET
         status = 'VOID',
         outstanding_amount = 0,
         void_reason = $2,
         voided_by = $3::uuid,
         voided_at = NOW(),
         updated_by = $3::uuid,
         updated_at = NOW(),
         version = version + 1
       WHERE id = $1::uuid
       RETURNING *`,
      [
        invoice.id,
        optText(params.reason, 2000) ?? 'إلغاء مسودة',
        params.userId,
      ]
    );
    return upd.rows[0];
  }

  if (invoice.status !== 'POSTED' || !invoice.journal_entry_id) {
    throw new AccountsHttpError('حالة الفاتورة لا تسمح بالإلغاء', 409);
  }

  const reason = String(params.reason ?? '').trim();
  if (!reason) {
    throw new AccountsHttpError('سبب الإلغاء مطلوب للفواتير المرحّلة', 400);
  }

  const original = await loadJournalEntry(client, invoice.journal_entry_id);
  const reversalDate = pgDateOnly(invoice.invoice_date);
  const reversal = await createReversalEntry(client, {
    original,
    reversalDate,
    reason: `إلغاء فاتورة مورد ${invoice.invoice_number}: ${reason}`,
    userId: params.userId,
  });

  await txQuery(
    client,
    `UPDATE accounts.journal_entries
     SET source_type = 'SUPPLIER_INVOICE_REVERSAL',
         source_id = $2::uuid,
         status = 'POSTED',
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1::uuid`,
    [reversal.id, invoice.id]
  );

  await txQuery(
    client,
    `UPDATE accounts.journal_entries
     SET status = 'POSTED',
         reversal_entry_id = $2::uuid,
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1::uuid`,
    [original.id, reversal.id]
  );

  const amount = normalizeMoneyInput(invoice.total_amount);
  await writeSupplierLedgerEntry(client, {
    accountId: account.id,
    supplierId: account.supplier_id,
    entryDate: reversalDate,
    entryType: 'INVOICE_REVERSAL',
    sourceType: 'SUPPLIER_INVOICE_REVERSAL',
    sourceId: invoice.id,
    description: `عكس فاتورة ${invoice.invoice_number}: ${reason}`,
    debit: amount,
    credit: '0',
    currencyCode: invoice.currency_code,
    journalEntryId: reversal.id,
    userId: params.userId,
  });

  if (isPoInvoice) {
    const { reversePurchaseOrderInvoicePostQuantities } = await import(
      './purchase-invoice-matching'
    );
    await reversePurchaseOrderInvoicePostQuantities(client, invoice.id);
  }

  const upd = await txQuery<SupplierInvoiceRow>(
    client,
    `UPDATE accounts.supplier_invoices SET
       status = 'VOID',
       outstanding_amount = 0,
       reversal_journal_entry_id = $2::uuid,
       void_reason = $3,
       voided_by = $4::uuid,
       voided_at = NOW(),
       updated_by = $4::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [invoice.id, reversal.id, reason.slice(0, 2000), params.userId]
  );
  return upd.rows[0];
}

export async function listSupplierInvoices(
  client: TxClient,
  params: {
    q?: string;
    status?: string | null;
    supplier_id?: string | null;
    supplier_account_id?: string | null;
    page?: number;
    page_size?: number;
  }
): Promise<{
  rows: SupplierInvoiceListRow[];
  total: number;
  page: number;
  page_size: number;
}> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.page_size ?? 20));
  const offset = (page - 1) * pageSize;
  const q = (params.q || '').trim();
  const where: string[] = ['TRUE'];
  const values: unknown[] = [];
  let i = 1;

  if (q) {
    where.push(
      `(si.invoice_number ILIKE $${i} OR si.supplier_invoice_number ILIKE $${i}
        OR si.description ILIKE $${i} OR COALESCE(si.external_reference,'') ILIKE $${i}
        OR s.name_ar ILIKE $${i} OR s.supplier_number ILIKE $${i})`
    );
    values.push(`%${q}%`);
    i += 1;
  }
  if (params.status) {
    where.push(`si.status = $${i}`);
    values.push(params.status);
    i += 1;
  }
  if (params.supplier_id) {
    where.push(`si.supplier_id = $${i}::uuid`);
    values.push(params.supplier_id);
    i += 1;
  }
  if (params.supplier_account_id) {
    where.push(`si.supplier_account_id = $${i}::uuid`);
    values.push(params.supplier_account_id);
    i += 1;
  }

  const whereSql = where.join(' AND ');
  const count = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total
     FROM accounts.supplier_invoices si
     JOIN accounts.suppliers s ON s.id = si.supplier_id
     WHERE ${whereSql}`,
    values
  );
  const list = await txQuery<SupplierInvoiceListRow>(
    client,
    `SELECT si.*,
            s.name_ar AS supplier_name_ar,
            s.supplier_number,
            sit.code AS invoice_type_code,
            sit.name_ar AS invoice_type_name_ar,
            gl.code AS expense_gl_code
     FROM accounts.supplier_invoices si
     JOIN accounts.suppliers s ON s.id = si.supplier_id
     LEFT JOIN accounts.supplier_invoice_types sit ON sit.id = si.invoice_type_id
     LEFT JOIN accounts.chart_of_accounts gl ON gl.id = si.expense_gl_account_id
     WHERE ${whereSql}
     ORDER BY si.invoice_date DESC, si.created_at DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    [...values, pageSize, offset]
  );
  return {
    rows: list.rows,
    total: count.rows[0]?.total ?? 0,
    page,
    page_size: pageSize,
  };
}

export async function getSupplierLedger(
  client: TxClient,
  params: {
    supplierAccountId: string;
    page?: number;
    page_size?: number;
    date_from?: string | null;
    date_to?: string | null;
  }
): Promise<{
  rows: SupplierLedgerEntryRow[];
  total: number;
  page: number;
  page_size: number;
  balance: string;
}> {
  await loadSupplierAccount(client, params.supplierAccountId);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.page_size ?? 50));
  const offset = (page - 1) * pageSize;
  const dateFrom = params.date_from || null;
  const dateTo = params.date_to || null;

  const count = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total
     FROM accounts.supplier_ledger_entries
     WHERE supplier_account_id = $1::uuid
       AND ($2::date IS NULL OR entry_date >= $2::date)
       AND ($3::date IS NULL OR entry_date <= $3::date)`,
    [params.supplierAccountId, dateFrom, dateTo]
  );

  const list = await txQuery<SupplierLedgerEntryRow>(
    client,
    `SELECT * FROM accounts.supplier_ledger_entries
     WHERE supplier_account_id = $1::uuid
       AND ($2::date IS NULL OR entry_date >= $2::date)
       AND ($3::date IS NULL OR entry_date <= $3::date)
     ORDER BY entry_date, created_at, id
     LIMIT $4 OFFSET $5`,
    [params.supplierAccountId, dateFrom, dateTo, pageSize, offset]
  );

  const bal = await txQuery<{ balance: string }>(
    client,
    `SELECT COALESCE(SUM(credit_amount - debit_amount), 0)::text AS balance
     FROM accounts.supplier_ledger_entries
     WHERE supplier_account_id = $1::uuid
       AND entry_type <> 'OPENING_REFERENCE'`,
    [params.supplierAccountId]
  );

  return {
    rows: list.rows,
    total: count.rows[0]?.total ?? 0,
    page,
    page_size: pageSize,
    balance: normalizeSignedMoneyInput(bal.rows[0]?.balance ?? '0'),
  };
}

export async function getSupplierAccountSummary(
  client: TxClient,
  supplierAccountId: string
): Promise<{
  account: Record<string, unknown>;
  supplier: Record<string, unknown>;
  balance: string;
  invoice_counts: Record<string, number>;
  outstanding_total: string;
}> {
  const account = await loadSupplierAccount(client, supplierAccountId);
  const supplier = await loadSupplier(client, account.supplier_id);
  const balance = await getSupplierLedger(client, {
    supplierAccountId,
    page: 1,
    page_size: 1,
  }).then((r) => r.balance);

  const counts = await txQuery<{ status: string; n: number }>(
    client,
    `SELECT status, COUNT(*)::int AS n
     FROM accounts.supplier_invoices
     WHERE supplier_account_id = $1::uuid
     GROUP BY status`,
    [supplierAccountId]
  );
  const outstanding = await txQuery<{ total: string }>(
    client,
    `SELECT COALESCE(SUM(outstanding_amount), 0)::text AS total
     FROM accounts.supplier_invoices
     WHERE supplier_account_id = $1::uuid
       AND status IN ('POSTED', 'PARTIALLY_PAID')`,
    [supplierAccountId]
  );

  const gl = await txQuery<{ code: string; name_ar: string }>(
    client,
    `SELECT code, name_ar FROM accounts.chart_of_accounts WHERE id = $1`,
    [account.payable_gl_account_id]
  );

  return {
    account: {
      ...account,
      payable_gl_code: gl.rows[0]?.code ?? null,
      payable_gl_name_ar: gl.rows[0]?.name_ar ?? null,
    },
    supplier: {
      id: supplier.id,
      supplier_number: supplier.supplier_number,
      name_ar: supplier.name_ar,
      status: supplier.status,
      currency_code: supplier.currency_code,
    },
    balance,
    invoice_counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
    outstanding_total: normalizeMoneyInput(outstanding.rows[0]?.total ?? '0'),
  };
}

/** معاينة قيد الترحيل دون كتابة */
export function previewSupplierInvoiceJournal(params: {
  expense_gl_account_id: string;
  payable_gl_account_id: string;
  total_amount: string;
  description: string;
  invoice_number?: string;
}): Array<{
  side: 'debit' | 'credit';
  account_id: string;
  amount: string;
  description: string;
}> {
  const amount = normalizeMoneyInput(params.total_amount);
  return [
    {
      side: 'debit',
      account_id: params.expense_gl_account_id,
      amount,
      description: params.description,
    },
    {
      side: 'credit',
      account_id: params.payable_gl_account_id,
      amount,
      description: `ذمم دائنة — ${params.invoice_number ?? ''}`.trim(),
    },
  ];
}

export { moneyEquals, moneyIsZero };
