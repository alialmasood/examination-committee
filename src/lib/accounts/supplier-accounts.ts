/**
 * الحسابات المالية للموردين — المرحلة 6.A
 * لا يُنشأ GL لكل مورد؛ يستخدم Payables GL موحّد (LIABILITY).
 */
import {
  acquireAccountingResourceLocks,
  glAccountLock,
  supplierAccountLock,
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
import { assertPostingAccountWithType } from './posting-account';
import {
  SUPPLIER_PAYABLES_CAPABILITIES,
  assertSupplierPayablesCapability,
} from './supplier-payables-access';
import { loadSupplier } from './suppliers';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type SupplierAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export type SupplierAccountRow = {
  id: string;
  supplier_id: string;
  account_number: string;
  payable_gl_account_id: string;
  currency_code: string;
  status: SupplierAccountStatus;
  opening_reference: string | null;
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

function assertIqdOnly(value: unknown): string {
  const code = normalizeCurrencyCode(value, 'IQD');
  if (code !== 'IQD') {
    throw new AccountsHttpError(
      'عملة حساب المورد في المرحلة 6.A هي IQD فقط',
      400
    );
  }
  return code;
}

function assertOptimistic(
  row: SupplierAccountRow,
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

export function serializeSupplierAccount(row: SupplierAccountRow) {
  return {
    ...row,
    suspended_at: iso(row.suspended_at),
    closed_at: iso(row.closed_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

/** حساب ذمم دائنة: LIABILITY ترحيلي — ليس نقد/بنك/ذمم مدينة/إيراد/مصروف */
export async function assertValidPayableGlAccount(
  client: TxClient,
  accountId: string
): Promise<{
  id: string;
  code: string;
  name_ar?: string;
  requires_cost_center: boolean;
}> {
  const glId = String(accountId ?? '').trim();
  if (!glId) throw new AccountsHttpError('حساب الذمم الدائنة مطلوب', 400);

  const acc = await assertPostingAccountWithType(
    client,
    glId,
    'حساب الذمم الدائنة',
    { invalidStatusCode: 400 }
  );
  if (acc.account_type_code !== 'LIABILITY') {
    throw new AccountsHttpError(
      'يجب أن يكون حساب الذمم الدائنة من نوع الخصوم (LIABILITY)',
      400
    );
  }

  const cash = await txQuery<{ code: string }>(
    client,
    `SELECT code FROM accounts.cash_boxes
     WHERE account_id = $1::uuid OR closed_account_id = $1::uuid
     LIMIT 1`,
    [glId]
  );
  if (cash.rows[0]) {
    throw new AccountsHttpError(
      `لا يمكن استخدام حساب صندوق نقدي كذمم دائنة (${cash.rows[0].code})`,
      400
    );
  }

  const bank = await txQuery<{ code: string }>(
    client,
    `SELECT code FROM accounts.bank_accounts
     WHERE gl_account_id = $1::uuid
     LIMIT 1`,
    [glId]
  );
  if (bank.rows[0]) {
    throw new AccountsHttpError(
      `لا يمكن استخدام حساب بنكي كذمم دائنة (${bank.rows[0].code})`,
      400
    );
  }

  const recv = await txQuery(
    client,
    `SELECT account_number FROM accounts.student_accounts
     WHERE receivable_gl_account_id = $1::uuid
     LIMIT 1`,
    [glId]
  );
  if (recv.rows[0]) {
    throw new AccountsHttpError(
      'لا يمكن استخدام حساب ذمم مدينة (طلبة) كذمم دائنة',
      400
    );
  }

  return {
    id: acc.id,
    code: acc.code,
    requires_cost_center: acc.requires_cost_center,
  };
}

export async function listEligiblePayableGlAccounts(client: TxClient): Promise<
  Array<{ id: string; code: string; name_ar: string; account_type_code: string }>
> {
  const r = await txQuery(
    client,
    `SELECT a.id, a.code, a.name_ar, t.code AS account_type_code
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code = 'LIABILITY'
       AND NOT a.is_group
       AND a.allow_posting
       AND a.is_active
       AND NOT EXISTS (
         SELECT 1 FROM accounts.cash_boxes cb
         WHERE cb.account_id = a.id OR cb.closed_account_id = a.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM accounts.bank_accounts ba WHERE ba.gl_account_id = a.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM accounts.student_accounts sa
         WHERE sa.receivable_gl_account_id = a.id
       )
     ORDER BY a.code
     LIMIT 500`
  );
  return r.rows as Array<{
    id: string;
    code: string;
    name_ar: string;
    account_type_code: string;
  }>;
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

export async function allocateSupplierAccountNumber(
  client: TxClient
): Promise<string> {
  const year = await getDefaultActiveFiscalYear(client);
  await txQuery(
    client,
    `INSERT INTO accounts.document_sequences
      (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
     SELECT 'SUPPLIER_ACCOUNT', $1::uuid, 'SPA', 0, 6, TRUE, TRUE
     WHERE NOT EXISTS (
       SELECT 1 FROM accounts.document_sequences
       WHERE document_type = 'SUPPLIER_ACCOUNT' AND fiscal_year_id = $1::uuid
     )`,
    [year.id]
  );
  try {
    const seq = await nextDocumentNumber(client, {
      documentType: 'SUPPLIER_ACCOUNT',
      fiscalYearId: year.id,
      yearLabel: yearLabelFromDate(year.start_date),
    });
    return seq.formatted;
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : 'تعذر تخصيص رقم حساب المورد';
    throw new AccountsHttpError(msg, 409);
  }
}

export async function loadSupplierAccount(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<SupplierAccountRow> {
  const r = await txQuery<SupplierAccountRow>(
    client,
    `SELECT * FROM accounts.supplier_accounts WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('الحساب المالي للمورد غير موجود', 404);
  }
  return r.rows[0];
}

export async function findSupplierAccountBySupplierCurrency(
  client: TxClient,
  supplierId: string,
  currencyCode = 'IQD'
): Promise<SupplierAccountRow | null> {
  const r = await txQuery<SupplierAccountRow>(
    client,
    `SELECT * FROM accounts.supplier_accounts
     WHERE supplier_id = $1::uuid AND currency_code = $2
     LIMIT 1`,
    [supplierId, currencyCode]
  );
  return r.rows[0] ?? null;
}

export async function getSupplierAccountBalance(
  client: TxClient,
  supplierAccountId: string
): Promise<string> {
  const r = await txQuery<{ balance: string }>(
    client,
    `SELECT COALESCE(SUM(credit_amount - debit_amount), 0)::text AS balance
     FROM accounts.supplier_ledger_entries
     WHERE supplier_account_id = $1::uuid
       AND entry_type <> 'OPENING_REFERENCE'`,
    [supplierAccountId]
  );
  return normalizeSignedMoneyInput(r.rows[0]?.balance ?? '0');
}

export async function assertSupplierAccountActiveForInvoices(
  client: TxClient,
  account: SupplierAccountRow
): Promise<void> {
  if (account.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن إنشاء فاتورة على حساب مورد مغلق', 409);
  }
  if (account.status === 'SUSPENDED') {
    throw new AccountsHttpError(
      'لا يمكن إنشاء فاتورة على حساب مورد معلّق',
      409
    );
  }
  if (account.status !== 'ACTIVE') {
    throw new AccountsHttpError('حالة حساب المورد لا تسمح بالفواتير', 409);
  }
}

export async function createSupplierAccount(
  client: TxClient,
  input: {
    supplier_id: unknown;
    payable_gl_account_id: unknown;
    currency_code?: unknown;
    opening_reference?: unknown;
    notes?: unknown;
    created_by: string;
  }
): Promise<SupplierAccountRow> {
  const supplierId = String(input.supplier_id ?? '').trim();
  if (!supplierId) throw new AccountsHttpError('معرّف المورد مطلوب', 400);

  const supplier = await loadSupplier(client, supplierId, true);
  if (supplier.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن إنشاء حساب لمورد مغلق', 409);
  }

  const currency = assertIqdOnly(input.currency_code ?? supplier.currency_code);
  if (currency !== supplier.currency_code) {
    throw new AccountsHttpError('عملة الحساب لا تطابق عملة المورد', 409);
  }

  const existing = await findSupplierAccountBySupplierCurrency(
    client,
    supplierId,
    currency
  );
  if (existing) {
    throw new AccountsHttpError(
      'يوجد حساب مالي لهذا المورد بنفس العملة مسبقاً',
      409
    );
  }

  const gl = await assertValidPayableGlAccount(
    client,
    String(input.payable_gl_account_id ?? '')
  );

  const accountNumber = await allocateSupplierAccountNumber(client);
  const ins = await txQuery<SupplierAccountRow>(
    client,
    `INSERT INTO accounts.supplier_accounts (
       supplier_id, account_number, payable_gl_account_id, currency_code,
       status, opening_reference, notes, created_by, updated_by
     ) VALUES (
       $1::uuid, $2, $3::uuid, $4, 'ACTIVE', $5, $6, $7::uuid, $7::uuid
     ) RETURNING *`,
    [
      supplierId,
      accountNumber,
      gl.id,
      currency,
      optText(input.opening_reference, 2000),
      optText(input.notes, 4000),
      input.created_by,
    ]
  );
  const row = ins.rows[0];
  await acquireAccountingResourceLocks(client, [
    supplierLock(supplierId),
    supplierAccountLock(row.id),
    glAccountLock(row.payable_gl_account_id),
  ]);
  return row;
}

export async function getOrCreateSupplierAccount(
  client: TxClient,
  input: {
    supplier_id: unknown;
    payable_gl_account_id: unknown;
    currency_code?: unknown;
    opening_reference?: unknown;
    notes?: unknown;
    created_by: string;
  }
): Promise<{ account: SupplierAccountRow; created: boolean }> {
  const supplierId = String(input.supplier_id ?? '').trim();
  const currency = assertIqdOnly(input.currency_code);
  const existing = await findSupplierAccountBySupplierCurrency(
    client,
    supplierId,
    currency
  );
  if (existing) return { account: existing, created: false };
  const account = await createSupplierAccount(client, input);
  return { account, created: true };
}

export async function updateSupplierAccount(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    payable_gl_account_id?: unknown;
    opening_reference?: unknown;
    notes?: unknown;
  }
): Promise<SupplierAccountRow> {
  const acc = await loadSupplierAccount(client, params.id, true);
  assertOptimistic(acc, params.version, params.updated_at);
  if (acc.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن تعديل حساب مورد مغلق', 409);
  }

  await acquireAccountingResourceLocks(client, [
    supplierAccountLock(acc.id),
    glAccountLock(acc.payable_gl_account_id),
  ]);

  let glId = acc.payable_gl_account_id;
  if (
    params.payable_gl_account_id !== undefined &&
    params.payable_gl_account_id !== ''
  ) {
    const posted = await txQuery(
      client,
      `SELECT 1 FROM accounts.supplier_invoices
       WHERE supplier_account_id = $1::uuid
         AND status NOT IN ('DRAFT', 'VOID')
       LIMIT 1`,
      [acc.id]
    );
    if (posted.rows[0]) {
      throw new AccountsHttpError(
        'لا يمكن تغيير حساب الذمم الدائنة بعد وجود فواتير مرحّلة',
        409
      );
    }
    const gl = await assertValidPayableGlAccount(
      client,
      String(params.payable_gl_account_id)
    );
    glId = gl.id;
  }

  const upd = await txQuery<SupplierAccountRow>(
    client,
    `UPDATE accounts.supplier_accounts SET
       payable_gl_account_id = $2::uuid,
       opening_reference = $3,
       notes = $4,
       updated_by = $5::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      acc.id,
      glId,
      params.opening_reference !== undefined
        ? optText(params.opening_reference, 2000)
        : acc.opening_reference,
      params.notes !== undefined ? optText(params.notes, 4000) : acc.notes,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function suspendSupplierAccount(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<SupplierAccountRow> {
  const acc = await loadSupplierAccount(client, params.id, true);
  assertOptimistic(acc, params.version, params.updated_at);
  if (acc.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن تعليق حساب مغلق', 409);
  }
  if (acc.status === 'SUSPENDED') return acc;
  await acquireAccountingResourceLocks(client, [
    supplierAccountLock(acc.id),
    glAccountLock(acc.payable_gl_account_id),
  ]);
  const upd = await txQuery<SupplierAccountRow>(
    client,
    `UPDATE accounts.supplier_accounts SET
       status = 'SUSPENDED',
       suspended_at = NOW(),
       suspended_by = $2::uuid,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [acc.id, params.userId]
  );
  return upd.rows[0];
}

export async function activateSupplierAccount(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<SupplierAccountRow> {
  const acc = await loadSupplierAccount(client, params.id, true);
  assertOptimistic(acc, params.version, params.updated_at);
  if (acc.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن إعادة فتح حساب مغلق', 409);
  }
  if (acc.status === 'ACTIVE') return acc;
  await assertValidPayableGlAccount(client, acc.payable_gl_account_id);
  await acquireAccountingResourceLocks(client, [
    supplierAccountLock(acc.id),
    glAccountLock(acc.payable_gl_account_id),
  ]);
  const upd = await txQuery<SupplierAccountRow>(
    client,
    `UPDATE accounts.supplier_accounts SET
       status = 'ACTIVE',
       suspended_at = NULL,
       suspended_by = NULL,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [acc.id, params.userId]
  );
  return upd.rows[0];
}

export async function closeSupplierAccount(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<SupplierAccountRow> {
  await assertSupplierPayablesCapability(
    client,
    params.userId,
    SUPPLIER_PAYABLES_CAPABILITIES.CLOSE
  );

  const acc = await loadSupplierAccount(client, params.id, true);
  assertOptimistic(acc, params.version, params.updated_at);
  if (acc.status === 'CLOSED') return acc;

  const balance = await getSupplierAccountBalance(client, acc.id);
  if (!moneyIsZero(balance) && !moneyEquals(balance, '0.000')) {
    throw new AccountsHttpError(
      'لا يمكن إغلاق حساب مورد برصيد مستحق غير صفر',
      409
    );
  }

  const openInv = await txQuery(
    client,
    `SELECT 1 FROM accounts.supplier_invoices
     WHERE supplier_account_id = $1::uuid
       AND status IN ('DRAFT', 'POSTED', 'PARTIALLY_PAID')
     LIMIT 1`,
    [acc.id]
  );
  if (openInv.rows[0]) {
    throw new AccountsHttpError(
      'لا يمكن إغلاق حساب بوجود فواتير مفتوحة أو مسودة',
      409
    );
  }

  await acquireAccountingResourceLocks(client, [
    supplierAccountLock(acc.id),
    glAccountLock(acc.payable_gl_account_id),
  ]);
  const upd = await txQuery<SupplierAccountRow>(
    client,
    `UPDATE accounts.supplier_accounts SET
       status = 'CLOSED',
       closed_at = NOW(),
       closed_by = $2::uuid,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [acc.id, params.userId]
  );
  return upd.rows[0];
}
