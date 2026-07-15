/**
 * الموردون — المرحلة 6.A
 */
import {
  acquireAccountingResourceLocks,
  supplierLock,
} from './accounting-locks';
import { AccountsHttpError } from './auth';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { normalizeCurrencyCode } from './currency';
import {
  nextDocumentNumber,
  yearLabelFromDate,
} from './document-sequences';
import {
  moneyEquals,
  moneyIsZero,
  normalizeSignedMoneyInput,
} from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type SupplierStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type SupplierType =
  | 'LOCAL'
  | 'INTERNATIONAL'
  | 'GOVERNMENT'
  | 'INDIVIDUAL'
  | 'SERVICE_PROVIDER'
  | 'OTHER';

export type SupplierRow = {
  id: string;
  supplier_number: string;
  code: string | null;
  name_ar: string;
  name_en: string | null;
  supplier_type: SupplierType;
  legal_name: string | null;
  tax_number: string | null;
  registration_number: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  country_code: string | null;
  city: string | null;
  address: string | null;
  contact_person: string | null;
  payment_terms_days: number;
  currency_code: string;
  status: SupplierStatus;
  notes: string | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  suspended_at: Date | string | null;
  suspended_by: string | null;
  closed_at: Date | string | null;
  closed_by: string | null;
};

export type SupplierListRow = SupplierRow & {
  balance?: string;
  last_entry_date?: string | null;
  account_id?: string | null;
  account_number?: string | null;
  payable_gl_code?: string | null;
};

const SUPPLIER_TYPES = new Set<SupplierType>([
  'LOCAL',
  'INTERNATIONAL',
  'GOVERNMENT',
  'INDIVIDUAL',
  'SERVICE_PROVIDER',
  'OTHER',
]);

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

function requireNameAr(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError('الاسم العربي للمورد مطلوب', 400);
  return s.slice(0, 200);
}

function parseSupplierType(value: unknown): SupplierType {
  const t = String(value ?? 'LOCAL').trim().toUpperCase() as SupplierType;
  if (!SUPPLIER_TYPES.has(t)) {
    throw new AccountsHttpError('نوع المورد غير صالح', 400);
  }
  return t;
}

function assertIqdOnly(value: unknown): string {
  const code = normalizeCurrencyCode(value, 'IQD');
  if (code !== 'IQD') {
    throw new AccountsHttpError('عملة المورد في المرحلة 6.A هي IQD فقط', 400);
  }
  return code;
}

function normalizeSupplierCode(value: unknown): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim().toUpperCase();
  if (!s) return null;
  if (s.length > 40) throw new AccountsHttpError('رمز المورد طويل جداً', 400);
  if (!/^[A-Z0-9_\-]+$/.test(s)) {
    throw new AccountsHttpError('رمز المورد يحتوي محارف غير مسموحة', 400);
  }
  return s;
}

function assertOptimistic(
  row: SupplierRow,
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

export function serializeSupplier(row: SupplierRow) {
  return {
    ...row,
    suspended_at: iso(row.suspended_at),
    closed_at: iso(row.closed_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

async function getDefaultActiveFiscalYear(
  client: TxClient
): Promise<{ id: string; start_date: string }> {
  const r = await txQuery<{ id: string; start_date: string }>(
    client,
    `SELECT id, start_date::text AS start_date
     FROM accounts.fiscal_years
     WHERE status = 'ACTIVE'
     ORDER BY is_default DESC, start_date DESC
     LIMIT 1`
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('لا توجد سنة مالية نشطة', 409);
  }
  return r.rows[0];
}

export async function allocateSupplierNumber(client: TxClient): Promise<string> {
  const year = await getDefaultActiveFiscalYear(client);
  await txQuery(
    client,
    `INSERT INTO accounts.document_sequences
      (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
     SELECT 'SUPPLIER', $1::uuid, 'SUP', 0, 6, TRUE, TRUE
     WHERE NOT EXISTS (
       SELECT 1 FROM accounts.document_sequences
       WHERE document_type = 'SUPPLIER' AND fiscal_year_id = $1::uuid
     )`,
    [year.id]
  );
  try {
    const seq = await nextDocumentNumber(client, {
      documentType: 'SUPPLIER',
      fiscalYearId: year.id,
      yearLabel: yearLabelFromDate(year.start_date),
    });
    return seq.formatted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'تعذر تخصيص رقم المورد';
    throw new AccountsHttpError(msg, 409);
  }
}

export async function loadSupplier(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<SupplierRow> {
  const r = await txQuery<SupplierRow>(
    client,
    `SELECT * FROM accounts.suppliers WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('المورد غير موجود', 404);
  return r.rows[0];
}

/** رصيد المورد = Σ credits − Σ debits (مستحق للمورد) — بدون OPENING_REFERENCE */
export async function getSupplierBalanceBySupplierId(
  client: TxClient,
  supplierId: string
): Promise<string> {
  const r = await txQuery<{ balance: string }>(
    client,
    `SELECT COALESCE(SUM(credit_amount - debit_amount), 0)::text AS balance
     FROM accounts.supplier_ledger_entries
     WHERE supplier_id = $1::uuid
       AND entry_type <> 'OPENING_REFERENCE'`,
    [supplierId]
  );
  return normalizeSignedMoneyInput(r.rows[0]?.balance ?? '0');
}

export async function supplierHasFinancialActivity(
  client: TxClient,
  supplierId: string
): Promise<boolean> {
  const r = await txQuery(
    client,
    `SELECT 1 FROM accounts.supplier_invoices
     WHERE supplier_id = $1::uuid
     LIMIT 1`,
    [supplierId]
  );
  if (r.rows[0]) return true;
  const led = await txQuery(
    client,
    `SELECT 1 FROM accounts.supplier_ledger_entries
     WHERE supplier_id = $1::uuid
     LIMIT 1`,
    [supplierId]
  );
  return Boolean(led.rows[0]);
}

export async function assertSupplierActiveForInvoices(
  client: TxClient,
  supplier: SupplierRow
): Promise<void> {
  if (supplier.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن إنشاء فاتورة لمورد مغلق', 409);
  }
  if (supplier.status === 'SUSPENDED') {
    throw new AccountsHttpError(
      'لا يمكن إنشاء فاتورة لمورد معلّق',
      409
    );
  }
  if (supplier.status !== 'ACTIVE') {
    throw new AccountsHttpError('حالة المورد لا تسمح بفواتير جديدة', 409);
  }
}

export async function createSupplier(
  client: TxClient,
  input: {
    code?: unknown;
    name_ar: unknown;
    name_en?: unknown;
    supplier_type?: unknown;
    legal_name?: unknown;
    tax_number?: unknown;
    registration_number?: unknown;
    phone?: unknown;
    email?: unknown;
    website?: unknown;
    country_code?: unknown;
    city?: unknown;
    address?: unknown;
    contact_person?: unknown;
    payment_terms_days?: unknown;
    currency_code?: unknown;
    notes?: unknown;
    created_by: string;
  }
): Promise<SupplierRow> {
  const nameAr = requireNameAr(input.name_ar);
  const code = normalizeSupplierCode(input.code);
  const currency = assertIqdOnly(input.currency_code);
  const supplierType = parseSupplierType(input.supplier_type);

  if (code) {
    const dup = await txQuery(
      client,
      `SELECT 1 FROM accounts.suppliers WHERE code = $1 LIMIT 1`,
      [code]
    );
    if (dup.rows[0]) {
      throw new AccountsHttpError('رمز المورد مستخدم مسبقاً', 409);
    }
  }

  let paymentTerms = 0;
  if (input.payment_terms_days != null && input.payment_terms_days !== '') {
    paymentTerms = Number(input.payment_terms_days);
    if (!Number.isInteger(paymentTerms) || paymentTerms < 0) {
      throw new AccountsHttpError('أيام شروط الدفع غير صالحة', 400);
    }
  }

  const supplierNumber = await allocateSupplierNumber(client);
  const ins = await txQuery<SupplierRow>(
    client,
    `INSERT INTO accounts.suppliers (
       supplier_number, code, name_ar, name_en, supplier_type,
       legal_name, tax_number, registration_number, phone, email, website,
       country_code, city, address, contact_person, payment_terms_days,
       currency_code, status, notes, created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       'ACTIVE',$18,$19::uuid,$19::uuid
     ) RETURNING *`,
    [
      supplierNumber,
      code,
      nameAr,
      optText(input.name_en, 200),
      supplierType,
      optText(input.legal_name, 200),
      optText(input.tax_number, 60),
      optText(input.registration_number, 60),
      optText(input.phone, 40),
      optText(input.email, 120),
      optText(input.website, 200),
      optText(input.country_code, 8),
      optText(input.city, 100),
      optText(input.address, 4000),
      optText(input.contact_person, 120),
      paymentTerms,
      currency,
      optText(input.notes, 4000),
      input.created_by,
    ]
  );
  const row = ins.rows[0];
  await acquireAccountingResourceLocks(client, [supplierLock(row.id)]);
  return row;
}

export async function updateSupplier(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    code?: unknown;
    name_ar?: unknown;
    name_en?: unknown;
    supplier_type?: unknown;
    legal_name?: unknown;
    tax_number?: unknown;
    registration_number?: unknown;
    phone?: unknown;
    email?: unknown;
    website?: unknown;
    country_code?: unknown;
    city?: unknown;
    address?: unknown;
    contact_person?: unknown;
    payment_terms_days?: unknown;
    notes?: unknown;
  }
): Promise<SupplierRow> {
  const row = await loadSupplier(client, params.id, true);
  assertOptimistic(row, params.version, params.updated_at);
  if (row.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن تعديل مورد مغلق', 409);
  }

  await acquireAccountingResourceLocks(client, [supplierLock(row.id)]);

  let code = row.code;
  if (params.code !== undefined) {
    code = normalizeSupplierCode(params.code);
    if (code) {
      const dup = await txQuery(
        client,
        `SELECT 1 FROM accounts.suppliers
         WHERE code = $1 AND id <> $2::uuid LIMIT 1`,
        [code, row.id]
      );
      if (dup.rows[0]) {
        throw new AccountsHttpError('رمز المورد مستخدم مسبقاً', 409);
      }
    }
  }

  let paymentTerms = row.payment_terms_days;
  if (params.payment_terms_days !== undefined && params.payment_terms_days !== '') {
    paymentTerms = Number(params.payment_terms_days);
    if (!Number.isInteger(paymentTerms) || paymentTerms < 0) {
      throw new AccountsHttpError('أيام شروط الدفع غير صالحة', 400);
    }
  }

  const upd = await txQuery<SupplierRow>(
    client,
    `UPDATE accounts.suppliers SET
       code = $2,
       name_ar = $3,
       name_en = $4,
       supplier_type = $5,
       legal_name = $6,
       tax_number = $7,
       registration_number = $8,
       phone = $9,
       email = $10,
       website = $11,
       country_code = $12,
       city = $13,
       address = $14,
       contact_person = $15,
       payment_terms_days = $16,
       notes = $17,
       updated_by = $18::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      row.id,
      code,
      params.name_ar !== undefined ? requireNameAr(params.name_ar) : row.name_ar,
      params.name_en !== undefined
        ? optText(params.name_en, 200)
        : row.name_en,
      params.supplier_type !== undefined
        ? parseSupplierType(params.supplier_type)
        : row.supplier_type,
      params.legal_name !== undefined
        ? optText(params.legal_name, 200)
        : row.legal_name,
      params.tax_number !== undefined
        ? optText(params.tax_number, 60)
        : row.tax_number,
      params.registration_number !== undefined
        ? optText(params.registration_number, 60)
        : row.registration_number,
      params.phone !== undefined ? optText(params.phone, 40) : row.phone,
      params.email !== undefined ? optText(params.email, 120) : row.email,
      params.website !== undefined ? optText(params.website, 200) : row.website,
      params.country_code !== undefined
        ? optText(params.country_code, 8)
        : row.country_code,
      params.city !== undefined ? optText(params.city, 100) : row.city,
      params.address !== undefined
        ? optText(params.address, 4000)
        : row.address,
      params.contact_person !== undefined
        ? optText(params.contact_person, 120)
        : row.contact_person,
      paymentTerms,
      params.notes !== undefined ? optText(params.notes, 4000) : row.notes,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function suspendSupplier(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<SupplierRow> {
  const row = await loadSupplier(client, params.id, true);
  assertOptimistic(row, params.version, params.updated_at);
  if (row.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن تعليق مورد مغلق', 409);
  }
  if (row.status === 'SUSPENDED') return row;

  await acquireAccountingResourceLocks(client, [supplierLock(row.id)]);
  const upd = await txQuery<SupplierRow>(
    client,
    `UPDATE accounts.suppliers SET
       status = 'SUSPENDED',
       suspended_at = NOW(),
       suspended_by = $2::uuid,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [row.id, params.userId]
  );
  return upd.rows[0];
}

export async function activateSupplier(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<SupplierRow> {
  const row = await loadSupplier(client, params.id, true);
  assertOptimistic(row, params.version, params.updated_at);
  if (row.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن إعادة فتح مورد مغلق', 409);
  }
  if (row.status === 'ACTIVE') return row;

  await acquireAccountingResourceLocks(client, [supplierLock(row.id)]);
  const upd = await txQuery<SupplierRow>(
    client,
    `UPDATE accounts.suppliers SET
       status = 'ACTIVE',
       suspended_at = NULL,
       suspended_by = NULL,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [row.id, params.userId]
  );
  return upd.rows[0];
}

/**
 * إغلاق المورد (كيان رئيسي) — نهائي.
 * يشترط: رصيد صفر · لا فواتير DRAFT/POSTED/PARTIALLY_PAID · جميع الحسابات المالية CLOSED.
 * فرق السياسة: إغلاق Supplier Account يغلق قناة الفوترة/الحساب؛ إغلاق Supplier يغلق سجل المورد كله.
 */
export async function closeSupplier(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<SupplierRow> {
  const row = await loadSupplier(client, params.id, true);
  assertOptimistic(row, params.version, params.updated_at);
  if (row.status === 'CLOSED') return row;

  const balance = await getSupplierBalanceBySupplierId(client, row.id);
  if (!moneyIsZero(balance) && !moneyEquals(balance, '0.000')) {
    throw new AccountsHttpError(
      'لا يمكن إغلاق مورد برصيد مستحق غير صفر',
      409
    );
  }

  const openInv = await txQuery(
    client,
    `SELECT 1 FROM accounts.supplier_invoices
     WHERE supplier_id = $1::uuid
       AND status IN ('DRAFT', 'POSTED', 'PARTIALLY_PAID')
     LIMIT 1`,
    [row.id]
  );
  if (openInv.rows[0]) {
    throw new AccountsHttpError(
      'لا يمكن إغلاق مورد بوجود فواتير مفتوحة أو مسودة',
      409
    );
  }

  const openAcc = await txQuery<{ account_number: string; status: string }>(
    client,
    `SELECT account_number, status FROM accounts.supplier_accounts
     WHERE supplier_id = $1::uuid AND status <> 'CLOSED'
     LIMIT 1`,
    [row.id]
  );
  if (openAcc.rows[0]) {
    throw new AccountsHttpError(
      `لا يمكن إغلاق المورد قبل إغلاق الحساب المالي (${openAcc.rows[0].account_number}). أغلق الحساب أولاً عبر إغلاق الحساب المالي.`,
      409
    );
  }

  await acquireAccountingResourceLocks(client, [supplierLock(row.id)]);
  const upd = await txQuery<SupplierRow>(
    client,
    `UPDATE accounts.suppliers SET
       status = 'CLOSED',
       closed_at = NOW(),
       closed_by = $2::uuid,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [row.id, params.userId]
  );
  return upd.rows[0];
}

export async function listSuppliers(
  client: TxClient,
  params: {
    q?: string;
    status?: string | null;
    supplier_type?: string | null;
    has_balance?: string | null;
    balance_min?: string | null;
    balance_max?: string | null;
    page?: number;
    page_size?: number;
  }
): Promise<{
  rows: SupplierListRow[];
  total: number;
  page: number;
  page_size: number;
}> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.page_size ?? 20));
  const offset = (page - 1) * pageSize;
  const q = (params.q || '').trim();
  const status = params.status?.trim() || null;
  const supplierType = params.supplier_type?.trim() || null;
  const hasBalance = params.has_balance?.trim() || null;

  const where: string[] = ['TRUE'];
  const values: unknown[] = [];
  let i = 1;

  if (q) {
    where.push(
      `(s.supplier_number ILIKE $${i} OR COALESCE(s.code,'') ILIKE $${i}
        OR s.name_ar ILIKE $${i} OR COALESCE(s.name_en,'') ILIKE $${i}
        OR COALESCE(s.phone,'') ILIKE $${i})`
    );
    values.push(`%${q}%`);
    i += 1;
  }
  if (status) {
    where.push(`s.status = $${i}`);
    values.push(status);
    i += 1;
  }
  if (supplierType) {
    where.push(`s.supplier_type = $${i}`);
    values.push(supplierType);
    i += 1;
  }

  const balExpr = `COALESCE((
    SELECT SUM(le.credit_amount - le.debit_amount)
    FROM accounts.supplier_ledger_entries le
    WHERE le.supplier_id = s.id AND le.entry_type <> 'OPENING_REFERENCE'
  ), 0)`;

  if (hasBalance === '1' || hasBalance === 'true') {
    where.push(`${balExpr} <> 0`);
  } else if (hasBalance === '0' || hasBalance === 'false') {
    where.push(`${balExpr} = 0`);
  }
  if (params.balance_min != null && params.balance_min !== '') {
    where.push(`${balExpr} >= $${i}::numeric`);
    values.push(params.balance_min);
    i += 1;
  }
  if (params.balance_max != null && params.balance_max !== '') {
    where.push(`${balExpr} <= $${i}::numeric`);
    values.push(params.balance_max);
    i += 1;
  }

  const whereSql = where.join(' AND ');

  const count = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total FROM accounts.suppliers s WHERE ${whereSql}`,
    values
  );

  const list = await txQuery<SupplierListRow>(
    client,
    `SELECT s.*,
       ${balExpr}::text AS balance,
       (
         SELECT MAX(le.entry_date)::text
         FROM accounts.supplier_ledger_entries le
         WHERE le.supplier_id = s.id
       ) AS last_entry_date,
       sa.id AS account_id,
       sa.account_number,
       gl.code AS payable_gl_code
     FROM accounts.suppliers s
     LEFT JOIN LATERAL (
       SELECT id, account_number, payable_gl_account_id
       FROM accounts.supplier_accounts
       WHERE supplier_id = s.id AND currency_code = s.currency_code
       ORDER BY created_at
       LIMIT 1
     ) sa ON TRUE
     LEFT JOIN accounts.chart_of_accounts gl ON gl.id = sa.payable_gl_account_id
     WHERE ${whereSql}
     ORDER BY s.created_at DESC
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

export async function getSupplierDashboardSummary(client: TxClient): Promise<{
  active_suppliers: number;
  total_payables: string;
  draft_invoices: number;
  posted_invoices: number;
  void_invoices: number;
  due_invoices: number;
  overdue_invoices: number;
  recent_invoices: Array<Record<string, unknown>>;
}> {
  const active = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n FROM accounts.suppliers WHERE status = 'ACTIVE'`
  );
  const payables = await txQuery<{ total: string }>(
    client,
    `SELECT COALESCE(SUM(credit_amount - debit_amount), 0)::text AS total
     FROM accounts.supplier_ledger_entries
     WHERE entry_type <> 'OPENING_REFERENCE'`
  );
  const counts = await txQuery<{ status: string; n: number }>(
    client,
    `SELECT status, COUNT(*)::int AS n
     FROM accounts.supplier_invoices
     GROUP BY status`
  );
  const byStatus = Object.fromEntries(counts.rows.map((r) => [r.status, r.n]));
  const due = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n FROM accounts.supplier_invoices
     WHERE status = 'POSTED' AND outstanding_amount > 0
       AND (due_date IS NULL OR due_date >= CURRENT_DATE)`
  );
  const overdue = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n FROM accounts.supplier_invoices
     WHERE status = 'POSTED' AND outstanding_amount > 0
       AND due_date IS NOT NULL AND due_date < CURRENT_DATE`
  );
  const recent = await txQuery(
    client,
    `SELECT si.id, si.invoice_number, si.supplier_invoice_number, si.status,
            si.total_amount::text AS total_amount, si.invoice_date::text AS invoice_date,
            s.name_ar AS supplier_name_ar
     FROM accounts.supplier_invoices si
     JOIN accounts.suppliers s ON s.id = si.supplier_id
     ORDER BY si.created_at DESC
     LIMIT 8`
  );

  return {
    active_suppliers: active.rows[0]?.n ?? 0,
    total_payables: normalizeSignedMoneyInput(payables.rows[0]?.total ?? '0'),
    draft_invoices: byStatus.DRAFT ?? 0,
    posted_invoices: byStatus.POSTED ?? 0,
    void_invoices: byStatus.VOID ?? 0,
    due_invoices: due.rows[0]?.n ?? 0,
    overdue_invoices: overdue.rows[0]?.n ?? 0,
    recent_invoices: recent.rows,
  };
}

export async function listSupplierOptions(client: TxClient): Promise<
  Array<{
    id: string;
    supplier_number: string;
    code: string | null;
    name_ar: string;
    status: string;
    currency_code: string;
    account_id: string | null;
    account_number: string | null;
  }>
> {
  const r = await txQuery(
    client,
    `SELECT s.id, s.supplier_number, s.code, s.name_ar, s.status, s.currency_code,
            sa.id AS account_id, sa.account_number
     FROM accounts.suppliers s
     LEFT JOIN LATERAL (
       SELECT id, account_number FROM accounts.supplier_accounts
       WHERE supplier_id = s.id AND currency_code = s.currency_code
         AND status = 'ACTIVE'
       LIMIT 1
     ) sa ON TRUE
     WHERE s.status IN ('ACTIVE', 'SUSPENDED')
     ORDER BY s.name_ar
     LIMIT 500`
  );
  return r.rows as Array<{
    id: string;
    supplier_number: string;
    code: string | null;
    name_ar: string;
    status: string;
    currency_code: string;
    account_id: string | null;
    account_number: string | null;
  }>;
}
