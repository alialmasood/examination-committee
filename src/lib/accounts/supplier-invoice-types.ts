/**
 * أنواع فواتير الموردين — المرحلة 6.A
 */
import { AccountsHttpError } from './auth';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { assertPostingAccountWithType } from './posting-account';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type SupplierInvoiceTypeRow = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  default_expense_gl_account_id: string | null;
  default_cost_center_id: string | null;
  requires_cost_center: boolean;
  is_active: boolean;
  description: string | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
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

function requireCode(value: unknown): string {
  const s = String(value ?? '').trim().toUpperCase();
  if (!s) throw new AccountsHttpError('رمز نوع الفاتورة مطلوب', 400);
  if (s.length > 40) throw new AccountsHttpError('رمز نوع الفاتورة طويل جداً', 400);
  if (!/^[A-Z0-9_\-]+$/.test(s)) {
    throw new AccountsHttpError('رمز نوع الفاتورة يحتوي محارف غير مسموحة', 400);
  }
  return s;
}

function requireNameAr(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError('اسم نوع الفاتورة بالعربية مطلوب', 400);
  return s.slice(0, 200);
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return Boolean(value);
}

function assertOptimistic(
  row: SupplierInvoiceTypeRow,
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

export function serializeSupplierInvoiceType(row: SupplierInvoiceTypeRow) {
  return {
    ...row,
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

/** مصروف تشغيلي صالح في 6.A: EXPENSE ترحيلي — ليس Payables/Cash/Bank/Receivables */
export async function assertValidExpenseGlAccount(
  client: TxClient,
  accountId: string
): Promise<{
  id: string;
  code: string;
  account_type_code: string;
  requires_cost_center: boolean;
}> {
  const glId = String(accountId ?? '').trim();
  if (!glId) throw new AccountsHttpError('حساب المصروف مطلوب', 400);

  const acc = await assertPostingAccountWithType(
    client,
    glId,
    'حساب المصروف',
    { invalidStatusCode: 400 }
  );
  if (acc.account_type_code !== 'EXPENSE') {
    throw new AccountsHttpError(
      'يجب أن يكون حساب المصروف من نوع المصروفات (EXPENSE) في المرحلة 6.A',
      400
    );
  }

  const cash = await txQuery(
    client,
    `SELECT code FROM accounts.cash_boxes
     WHERE account_id = $1::uuid OR closed_account_id = $1::uuid
     LIMIT 1`,
    [glId]
  );
  if (cash.rows[0]) {
    throw new AccountsHttpError(
      `لا يمكن استخدام حساب صندوق نقدي كمصروف (${cash.rows[0].code})`,
      400
    );
  }

  const bank = await txQuery(
    client,
    `SELECT code FROM accounts.bank_accounts
     WHERE gl_account_id = $1::uuid
     LIMIT 1`,
    [glId]
  );
  if (bank.rows[0]) {
    throw new AccountsHttpError(
      `لا يمكن استخدام حساب بنكي كمصروف (${bank.rows[0].code})`,
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
      'لا يمكن استخدام حساب ذمم مدينة كحساب مصروف',
      400
    );
  }

  const pay = await txQuery(
    client,
    `SELECT account_number FROM accounts.supplier_accounts
     WHERE payable_gl_account_id = $1::uuid
     LIMIT 1`,
    [glId]
  );
  if (pay.rows[0]) {
    throw new AccountsHttpError(
      'لا يمكن استخدام حساب ذمم دائنة كحساب مصروف',
      400
    );
  }

  return {
    id: acc.id,
    code: acc.code,
    account_type_code: acc.account_type_code,
    requires_cost_center: acc.requires_cost_center,
  };
}

export async function loadSupplierInvoiceType(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<SupplierInvoiceTypeRow> {
  const r = await txQuery<SupplierInvoiceTypeRow>(
    client,
    `SELECT * FROM accounts.supplier_invoice_types WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('نوع فاتورة المورد غير موجود', 404);
  return r.rows[0];
}

export async function createSupplierInvoiceType(
  client: TxClient,
  input: {
    code: unknown;
    name_ar: unknown;
    name_en?: unknown;
    default_expense_gl_account_id?: unknown;
    default_cost_center_id?: unknown;
    requires_cost_center?: unknown;
    description?: unknown;
    created_by: string;
  }
): Promise<SupplierInvoiceTypeRow> {
  const code = requireCode(input.code);
  const nameAr = requireNameAr(input.name_ar);

  const dup = await txQuery(
    client,
    `SELECT 1 FROM accounts.supplier_invoice_types WHERE code = $1 LIMIT 1`,
    [code]
  );
  if (dup.rows[0]) {
    throw new AccountsHttpError('رمز نوع الفاتورة مستخدم مسبقاً', 409);
  }

  let expenseGlId: string | null = null;
  if (
    input.default_expense_gl_account_id != null &&
    input.default_expense_gl_account_id !== ''
  ) {
    const gl = await assertValidExpenseGlAccount(
      client,
      String(input.default_expense_gl_account_id)
    );
    expenseGlId = gl.id;
  }

  let costCenterId: string | null = null;
  if (
    input.default_cost_center_id != null &&
    input.default_cost_center_id !== ''
  ) {
    costCenterId = String(input.default_cost_center_id).trim();
    const cc = await txQuery(
      client,
      `SELECT 1 FROM accounts.cost_centers
       WHERE id = $1::uuid AND is_active = TRUE LIMIT 1`,
      [costCenterId]
    );
    if (!cc.rows[0]) {
      throw new AccountsHttpError('مركز الكلفة غير موجود أو غير فعّال', 400);
    }
  }

  const ins = await txQuery<SupplierInvoiceTypeRow>(
    client,
    `INSERT INTO accounts.supplier_invoice_types (
       code, name_ar, name_en, default_expense_gl_account_id,
       default_cost_center_id, requires_cost_center, is_active,
       description, created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4::uuid,$5::uuid,$6,TRUE,$7,$8::uuid,$8::uuid
     ) RETURNING *`,
    [
      code,
      nameAr,
      optText(input.name_en, 200),
      expenseGlId,
      costCenterId,
      bool(input.requires_cost_center, false),
      optText(input.description, 4000),
      input.created_by,
    ]
  );
  return ins.rows[0];
}

export async function updateSupplierInvoiceType(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    name_ar?: unknown;
    name_en?: unknown;
    default_expense_gl_account_id?: unknown;
    default_cost_center_id?: unknown;
    requires_cost_center?: unknown;
    description?: unknown;
  }
): Promise<SupplierInvoiceTypeRow> {
  const row = await loadSupplierInvoiceType(client, params.id, true);
  assertOptimistic(row, params.version, params.updated_at);

  let expenseGlId = row.default_expense_gl_account_id;
  if (params.default_expense_gl_account_id !== undefined) {
    if (
      params.default_expense_gl_account_id === null ||
      params.default_expense_gl_account_id === ''
    ) {
      expenseGlId = null;
    } else {
      const gl = await assertValidExpenseGlAccount(
        client,
        String(params.default_expense_gl_account_id)
      );
      expenseGlId = gl.id;
    }
  }

  let costCenterId = row.default_cost_center_id;
  if (params.default_cost_center_id !== undefined) {
    if (
      params.default_cost_center_id === null ||
      params.default_cost_center_id === ''
    ) {
      costCenterId = null;
    } else {
      costCenterId = String(params.default_cost_center_id).trim();
      const cc = await txQuery(
        client,
        `SELECT 1 FROM accounts.cost_centers
         WHERE id = $1::uuid AND is_active = TRUE LIMIT 1`,
        [costCenterId]
      );
      if (!cc.rows[0]) {
        throw new AccountsHttpError('مركز الكلفة غير موجود أو غير فعّال', 400);
      }
    }
  }

  const upd = await txQuery<SupplierInvoiceTypeRow>(
    client,
    `UPDATE accounts.supplier_invoice_types SET
       name_ar = $2,
       name_en = $3,
       default_expense_gl_account_id = $4::uuid,
       default_cost_center_id = $5::uuid,
       requires_cost_center = $6,
       description = $7,
       updated_by = $8::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      row.id,
      params.name_ar !== undefined ? requireNameAr(params.name_ar) : row.name_ar,
      params.name_en !== undefined
        ? optText(params.name_en, 200)
        : row.name_en,
      expenseGlId,
      costCenterId,
      params.requires_cost_center !== undefined
        ? bool(params.requires_cost_center, row.requires_cost_center)
        : row.requires_cost_center,
      params.description !== undefined
        ? optText(params.description, 4000)
        : row.description,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function deactivateSupplierInvoiceType(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<SupplierInvoiceTypeRow> {
  const row = await loadSupplierInvoiceType(client, params.id, true);
  assertOptimistic(row, params.version, params.updated_at);
  if (!row.is_active) return row;
  const upd = await txQuery<SupplierInvoiceTypeRow>(
    client,
    `UPDATE accounts.supplier_invoice_types SET
       is_active = FALSE,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [row.id, params.userId]
  );
  return upd.rows[0];
}

export async function listSupplierInvoiceTypes(
  client: TxClient,
  params: {
    q?: string;
    active_only?: boolean;
    page?: number;
    page_size?: number;
  }
): Promise<{
  rows: SupplierInvoiceTypeRow[];
  total: number;
  page: number;
  page_size: number;
}> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.page_size ?? 50));
  const offset = (page - 1) * pageSize;
  const q = (params.q || '').trim();
  const where: string[] = ['TRUE'];
  const values: unknown[] = [];
  let i = 1;
  if (params.active_only) {
    where.push('is_active = TRUE');
  }
  if (q) {
    where.push(
      `(code ILIKE $${i} OR name_ar ILIKE $${i} OR COALESCE(name_en,'') ILIKE $${i})`
    );
    values.push(`%${q}%`);
    i += 1;
  }
  const whereSql = where.join(' AND ');
  const count = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total FROM accounts.supplier_invoice_types WHERE ${whereSql}`,
    values
  );
  const list = await txQuery<SupplierInvoiceTypeRow>(
    client,
    `SELECT * FROM accounts.supplier_invoice_types
     WHERE ${whereSql}
     ORDER BY code
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
