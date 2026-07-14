/**
 * كشوف الحساب المصرفي — المرحلة 4.D (CRUD + سطور + انتقالات الحالة الأساسية).
 *
 * دورة الحالة: DRAFT → IN_PROGRESS → RECONCILED → CLOSED
 *                      \-------------------→ CANCELLED (من DRAFT أو IN_PROGRESS)
 *
 * منطق المطابقة والحساب (calculateBankReconciliation) وعمليات الإقفال/إعادة الفتح/
 * الإنهاء (markBankStatementReconciled/closeBankStatement/reopenBankStatement) موجودة
 * في bank-reconciliation.ts لتفادي استيراد دائري (هي تحتاج حساب التسوية، وهذا الملف
 * لا يحتاج معرفة تفاصيل المطابقة).
 *
 * اصطلاح الإشارة على سطر الكشف (bank_statement_lines):
 * - debit_amount  = خروج من الحساب بحسب المصرف (يقابله دائن على حساب البنك GL)
 * - credit_amount = دخول إلى الحساب بحسب المصرف (يقابله مدين على حساب البنك GL)
 */
import crypto from 'crypto';
import { AccountsHttpError } from './auth';
import { hasAccountsAdminAccess } from './accounts-access';
import {
  assertCanReconcileBankAccount,
} from './bank-account-access';
import { assertBankAccountOperational } from './bank-vouchers';
import { writeFinancialAudit } from './audit';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import { normalizeCurrencyCode } from './currency';
import {
  nextDocumentNumber,
  pgDateOnly,
  yearLabelFromDate,
} from './document-sequences';
import {
  moneyIsPositive,
  moneyToMillis,
  normalizeMoneyInput,
  normalizeSignedMoneyInput,
} from './money';
import {
  acquireAccountingResourceLocks,
  bankAccountLock,
  bankStatementLock,
} from './accounting-locks';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type BankStatementStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'RECONCILED'
  | 'CLOSED'
  | 'CANCELLED';

export type LineMatchStatus =
  | 'UNMATCHED'
  | 'PARTIALLY_MATCHED'
  | 'MATCHED'
  | 'EXCLUDED';

export type BankStatementRow = {
  id: string;
  statement_number: string;
  bank_account_id: string;
  external_statement_reference: string | null;
  date_from: string | Date;
  date_to: string | Date;
  opening_balance: string;
  closing_balance: string;
  currency_code: string;
  status: BankStatementStatus;
  notes: string | null;
  imported_file_name: string | null;
  imported_at: Date | string | null;
  imported_by: string | null;
  snapshot_json: unknown | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  started_by: string | null;
  reconciled_by: string | null;
  closed_by: string | null;
  cancelled_by: string | null;
  started_at: Date | string | null;
  reconciled_at: Date | string | null;
  closed_at: Date | string | null;
  cancelled_at: Date | string | null;
  cancellation_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type BankStatementLineRow = {
  id: string;
  bank_statement_id: string;
  line_number: number;
  transaction_date: string | Date;
  value_date: string | Date | null;
  description: string;
  bank_reference: string | null;
  debit_amount: string;
  credit_amount: string;
  running_balance: string | null;
  currency_code: string;
  external_line_id: string | null;
  fingerprint: string;
  match_status: LineMatchStatus;
  exclusion_reason: string | null;
  notes: string | null;
  adjustment_journal_entry_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function requireDescription(value: unknown, label = 'الوصف'): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError(`${label} مطلوب`, 400);
  return s.slice(0, 4000);
}

function normalizeOptionalText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, max);
  return s || null;
}

function requireReason(value: unknown, label = 'السبب'): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError(`${label} مطلوب`, 400);
  return s.slice(0, 4000);
}

/** تزامن متفائل لكشف الحساب المصرفي (version + updated_at) */
function assertOptimistic(
  row: BankStatementRow,
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

/** خطأ الـ trigger الذي يمنع تداخل فترات الكشوف غير الملغاة لنفس الحساب */
function isStatementOverlapError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return (
    err?.code === '23514' &&
    typeof err.message === 'string' &&
    err.message.includes('bank statement period overlaps')
  );
}

async function runCatchingOverlap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isStatementOverlapError(e)) {
      throw new AccountsHttpError(
        'تتداخل فترة هذا الكشف مع كشف آخر غير ملغى لنفس الحساب المصرفي',
        409
      );
    }
    throw e;
  }
}

export function serializeBankStatement(row: BankStatementRow) {
  return {
    ...row,
    opening_balance: normalizeSignedMoneyInput(row.opening_balance),
    closing_balance: normalizeSignedMoneyInput(row.closing_balance),
    date_from: pgDateOnly(row.date_from),
    date_to: pgDateOnly(row.date_to),
    imported_at: iso(row.imported_at),
    started_at: iso(row.started_at),
    reconciled_at: iso(row.reconciled_at),
    closed_at: iso(row.closed_at),
    cancelled_at: iso(row.cancelled_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export function serializeBankStatementLine(row: BankStatementLineRow) {
  return {
    ...row,
    debit_amount: normalizeMoneyInput(row.debit_amount),
    credit_amount: normalizeMoneyInput(row.credit_amount),
    running_balance:
      row.running_balance == null
        ? null
        : normalizeSignedMoneyInput(row.running_balance),
    transaction_date: pgDateOnly(row.transaction_date),
    value_date: row.value_date ? pgDateOnly(row.value_date) : null,
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

/** يفرض أن lineId يتبع كشف المسار — يمنع تمرير معرف من كشف آخر عبر URL متداخل */
export function assertLineBelongsToStatement(
  line: BankStatementLineRow,
  statementId: string
): void {
  if (line.bank_statement_id !== statementId) {
    throw new AccountsHttpError('سطر الكشف غير موجود ضمن هذا الكشف', 404);
  }
}

/**
 * بصمة مستقرة (SHA-256) لسطر كشف — تُستخدم لمنع استيراد سطور مكررة (نفس المصدر).
 * تُطبّع الحقول (تاريخ ثابت الصيغة، مبالغ مطبّعة، نص بلا حساسية لحالة الأحرف/الفراغات).
 */
export function computeLineFingerprint(input: {
  transaction_date: string | Date;
  description: string | null | undefined;
  bank_reference?: string | null;
  debit_amount: unknown;
  credit_amount: unknown;
  external_line_id?: string | null;
}): string {
  const normalized = [
    pgDateOnly(input.transaction_date),
    normalizeMoneyInput(input.debit_amount ?? '0'),
    normalizeMoneyInput(input.credit_amount ?? '0'),
    String(input.description ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' '),
    String(input.bank_reference ?? '').trim().toUpperCase(),
    String(input.external_line_id ?? '').trim().toUpperCase(),
  ].join('|');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export async function loadBankStatement(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<BankStatementRow> {
  const r = await txQuery<BankStatementRow>(
    client,
    `SELECT * FROM accounts.bank_statements WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('كشف الحساب المصرفي غير موجود', 404);
  return r.rows[0];
}

export async function loadBankStatementLine(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<BankStatementLineRow> {
  const r = await txQuery<BankStatementLineRow>(
    client,
    `SELECT * FROM accounts.bank_statement_lines WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('سطر كشف الحساب غير موجود', 404);
  return r.rows[0];
}

export async function listBankStatementLines(
  client: TxClient,
  statementId: string
): Promise<BankStatementLineRow[]> {
  const r = await txQuery<BankStatementLineRow>(
    client,
    `SELECT * FROM accounts.bank_statement_lines
     WHERE bank_statement_id = $1::uuid
     ORDER BY line_number ASC`,
    [statementId]
  );
  return r.rows;
}

/** حالات لا يمكن فيها تعديل رأس/سطور الكشف على الإطلاق */
export function assertStatementEditable(statement: BankStatementRow): void {
  if (
    statement.status === 'CLOSED' ||
    statement.status === 'CANCELLED' ||
    statement.status === 'RECONCILED'
  ) {
    throw new AccountsHttpError(
      'لا يمكن تعديل هذا الكشف في حالته الحالية (مغلق/مسوّى/ملغى)',
      409
    );
  }
}

/** عمليات المطابقة (إضافة/حذف مطابقة، تسوية) تتطلب أن يكون الكشف قيد المعالجة */
export function assertStatementMatchable(statement: BankStatementRow): void {
  if (statement.status !== 'IN_PROGRESS') {
    throw new AccountsHttpError(
      'عمليات المطابقة تتطلب أن يكون الكشف قيد المعالجة (IN_PROGRESS) — ابدأ التسوية أولاً',
      409
    );
  }
}

/** صلاحية الوصول لعرض/العمل على كشف: Admin أو can_view أو can_reconcile على الحساب */
export async function assertCanAccessBankStatement(
  client: TxClient,
  params: { statementId: string; userId: string }
): Promise<BankStatementRow> {
  const statement = await loadBankStatement(client, params.statementId);
  if (await hasAccountsAdminAccess(client, params.userId)) return statement;
  const r = await txQuery(
    client,
    `SELECT 1 FROM accounts.bank_account_users
     WHERE bank_account_id = $1::uuid AND user_id = $2::uuid
       AND (can_view = TRUE OR can_reconcile = TRUE)
     LIMIT 1`,
    [statement.bank_account_id, params.userId]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('ليس لديك صلاحية الوصول إلى كشف الحساب المصرفي', 403);
  }
  return statement;
}

async function resolveFiscalYearForStatementDate(
  client: TxClient,
  date: string
): Promise<{ fiscalYearId: string; yearLabel: string }> {
  const r = await txQuery<{ id: string; start_date: string }>(
    client,
    `SELECT id, start_date::text AS start_date
     FROM accounts.fiscal_years
     WHERE start_date <= $1::date AND end_date >= $1::date
     ORDER BY is_default DESC, start_date DESC
     LIMIT 1`,
    [date]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError(
      'لا توجد سنة مالية تغطي تاريخ نهاية الكشف (date_to)',
      409
    );
  }
  return {
    fiscalYearId: r.rows[0].id,
    yearLabel: yearLabelFromDate(r.rows[0].start_date),
  };
}

async function allocateBankStatementNumber(
  client: TxClient,
  params: { fiscalYearId: string; yearLabel: string }
): Promise<string> {
  await txQuery(
    client,
    `INSERT INTO accounts.document_sequences
      (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
     SELECT 'BANK_STATEMENT'::varchar, $1::uuid, 'BST'::varchar, 0, 6, TRUE, TRUE
     WHERE NOT EXISTS (
       SELECT 1 FROM accounts.document_sequences
       WHERE document_type = 'BANK_STATEMENT' AND fiscal_year_id = $1::uuid
     )`,
    [params.fiscalYearId]
  );
  try {
    const seq = await nextDocumentNumber(client, {
      documentType: 'BANK_STATEMENT',
      fiscalYearId: params.fiscalYearId,
      yearLabel: params.yearLabel,
    });
    return seq.formatted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'تعذر تخصيص رقم كشف الحساب';
    throw new AccountsHttpError(msg, 409);
  }
}

export async function createBankStatement(
  client: TxClient,
  input: {
    bank_account_id: unknown;
    external_statement_reference?: unknown;
    date_from: unknown;
    date_to: unknown;
    opening_balance: unknown;
    closing_balance: unknown;
    currency_code?: unknown;
    notes?: unknown;
    created_by: string;
  }
): Promise<BankStatementRow> {
  const bankAccountId = String(input.bank_account_id ?? '').trim();
  if (!bankAccountId) throw new AccountsHttpError('الحساب المصرفي مطلوب', 400);

  await assertCanReconcileBankAccount(client, {
    bankAccountId,
    userId: input.created_by,
  });

  await acquireAccountingResourceLocks(client, [bankAccountLock(bankAccountId)]);

  const bankAcc = await assertBankAccountOperational(client, bankAccountId, {});

  const dateFrom = pgDateOnly(String(input.date_from ?? ''));
  const dateTo = pgDateOnly(String(input.date_to ?? ''));
  if (!dateFrom || !dateTo) {
    throw new AccountsHttpError('تاريخ بداية ونهاية الكشف مطلوبان', 400);
  }
  if (dateFrom > dateTo) {
    throw new AccountsHttpError('تاريخ البداية يجب أن يسبق أو يساوي تاريخ النهاية', 400);
  }

  const currency = normalizeCurrencyCode(
    input.currency_code ?? bankAcc.currency_code,
    bankAcc.currency_code
  );
  if (currency !== bankAcc.currency_code) {
    throw new AccountsHttpError(
      'عملة الكشف يجب أن تطابق عملة الحساب المصرفي',
      409
    );
  }

  const openingBalance = normalizeSignedMoneyInput(input.opening_balance);
  const closingBalance = normalizeSignedMoneyInput(input.closing_balance);

  const fiscal = await resolveFiscalYearForStatementDate(client, dateTo);
  const statementNumber = await allocateBankStatementNumber(client, fiscal);

  const ins = await runCatchingOverlap(() =>
    txQuery<BankStatementRow>(
      client,
      `INSERT INTO accounts.bank_statements (
         statement_number, bank_account_id, external_statement_reference,
         date_from, date_to, opening_balance, closing_balance, currency_code,
         status, notes, created_by, updated_by
       ) VALUES (
         $1, $2::uuid, $3,
         $4::date, $5::date, $6::numeric, $7::numeric, $8,
         'DRAFT', $9, $10::uuid, $10::uuid
       ) RETURNING *`,
      [
        statementNumber,
        bankAccountId,
        normalizeOptionalText(input.external_statement_reference, 100),
        dateFrom,
        dateTo,
        openingBalance,
        closingBalance,
        currency,
        normalizeOptionalText(input.notes, 4000),
        input.created_by,
      ]
    )
  );
  const row = ins.rows[0];

  await writeFinancialAudit(client, {
    userId: input.created_by,
    action: 'bank_statement.created',
    entityType: 'bank_statement',
    entityId: row.id,
    newValues: { statement_number: row.statement_number, bank_account_id: bankAccountId },
    description: `إنشاء كشف حساب مصرفي ${row.statement_number}`,
  });

  return row;
}

export async function updateBankStatement(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    bank_account_id?: unknown;
    external_statement_reference?: unknown;
    date_from?: unknown;
    date_to?: unknown;
    opening_balance?: unknown;
    closing_balance?: unknown;
    currency_code?: unknown;
    notes?: unknown;
  }
): Promise<BankStatementRow> {
  const statement = await loadBankStatement(client, params.id, true);
  assertOptimistic(statement, params.version, params.updated_at);
  assertStatementEditable(statement);

  await assertCanReconcileBankAccount(client, {
    bankAccountId: statement.bank_account_id,
    userId: params.userId,
  });

  const frozenFieldsTouched =
    params.bank_account_id !== undefined ||
    params.date_from !== undefined ||
    params.date_to !== undefined ||
    params.currency_code !== undefined;

  if (statement.status !== 'DRAFT' && frozenFieldsTouched) {
    throw new AccountsHttpError(
      'لا يمكن تعديل الحساب المصرفي أو فترة الكشف أو العملة بعد بدء التسوية (IN_PROGRESS)',
      409
    );
  }

  let bankAccountId = statement.bank_account_id;
  if (params.bank_account_id !== undefined) {
    bankAccountId = String(params.bank_account_id || '').trim();
    if (!bankAccountId) throw new AccountsHttpError('الحساب المصرفي مطلوب', 400);
    if (bankAccountId !== statement.bank_account_id) {
      await assertCanReconcileBankAccount(client, {
        bankAccountId,
        userId: params.userId,
      });
    }
  }

  await acquireAccountingResourceLocks(client, [
    bankAccountLock(statement.bank_account_id),
    ...(bankAccountId !== statement.bank_account_id
      ? [bankAccountLock(bankAccountId)]
      : []),
  ]);

  const bankAcc = await assertBankAccountOperational(client, bankAccountId, {});

  let dateFrom = pgDateOnly(statement.date_from);
  if (params.date_from !== undefined) {
    dateFrom = pgDateOnly(String(params.date_from || ''));
    if (!dateFrom) throw new AccountsHttpError('تاريخ بداية الكشف غير صالح', 400);
  }
  let dateTo = pgDateOnly(statement.date_to);
  if (params.date_to !== undefined) {
    dateTo = pgDateOnly(String(params.date_to || ''));
    if (!dateTo) throw new AccountsHttpError('تاريخ نهاية الكشف غير صالح', 400);
  }
  if (dateFrom > dateTo) {
    throw new AccountsHttpError('تاريخ البداية يجب أن يسبق أو يساوي تاريخ النهاية', 400);
  }

  const currency = normalizeCurrencyCode(
    params.currency_code ?? bankAcc.currency_code,
    bankAcc.currency_code
  );
  if (currency !== bankAcc.currency_code) {
    throw new AccountsHttpError(
      'عملة الكشف يجب أن تطابق عملة الحساب المصرفي',
      409
    );
  }

  const openingBalance =
    params.opening_balance !== undefined
      ? normalizeSignedMoneyInput(params.opening_balance)
      : normalizeSignedMoneyInput(statement.opening_balance);
  const closingBalance =
    params.closing_balance !== undefined
      ? normalizeSignedMoneyInput(params.closing_balance)
      : normalizeSignedMoneyInput(statement.closing_balance);

  const upd = await runCatchingOverlap(() =>
    txQuery<BankStatementRow>(
      client,
      `UPDATE accounts.bank_statements SET
         bank_account_id = $2::uuid,
         external_statement_reference = $3,
         date_from = $4::date,
         date_to = $5::date,
         opening_balance = $6::numeric,
         closing_balance = $7::numeric,
         currency_code = $8,
         notes = $9,
         updated_by = $10::uuid,
         updated_at = NOW(),
         version = version + 1
       WHERE id = $1::uuid
       RETURNING *`,
      [
        statement.id,
        bankAccountId,
        params.external_statement_reference !== undefined
          ? normalizeOptionalText(params.external_statement_reference, 100)
          : statement.external_statement_reference,
        dateFrom,
        dateTo,
        openingBalance,
        closingBalance,
        currency,
        params.notes !== undefined
          ? normalizeOptionalText(params.notes, 4000)
          : statement.notes,
        params.userId,
      ]
    )
  );
  return upd.rows[0];
}

export async function startBankReconciliation(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<BankStatementRow> {
  const statement = await loadBankStatement(client, params.id, true);
  if (statement.status === 'IN_PROGRESS') return statement;
  assertOptimistic(statement, params.version, params.updated_at);
  if (statement.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن بدء التسوية من حالة مسودة (DRAFT) فقط', 409);
  }

  await assertCanReconcileBankAccount(client, {
    bankAccountId: statement.bank_account_id,
    userId: params.userId,
  });

  const upd = await txQuery<BankStatementRow>(
    client,
    `UPDATE accounts.bank_statements SET
       status = 'IN_PROGRESS',
       started_by = $2::uuid,
       started_at = NOW(),
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [statement.id, params.userId]
  );
  const row = upd.rows[0];

  await writeFinancialAudit(client, {
    userId: params.userId,
    action: 'bank_statement.started',
    entityType: 'bank_statement',
    entityId: row.id,
    description: `بدء تسوية كشف الحساب المصرفي ${row.statement_number}`,
  });

  return row;
}

export async function cancelBankStatement(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason: unknown;
  }
): Promise<BankStatementRow> {
  const statement = await loadBankStatement(client, params.id, true);
  if (statement.status === 'CANCELLED') return statement;
  assertOptimistic(statement, params.version, params.updated_at);
  if (statement.status !== 'DRAFT' && statement.status !== 'IN_PROGRESS') {
    throw new AccountsHttpError(
      'لا يمكن إلغاء كشف تمت تسويته أو إغلاقه',
      409
    );
  }

  const reason = requireReason(params.reason, 'سبب الإلغاء');

  await assertCanReconcileBankAccount(client, {
    bankAccountId: statement.bank_account_id,
    userId: params.userId,
  });

  // سياسة محافظة: منع الإلغاء إن وُجدت قيود تسوية مرحّلة مرتبطة بسطور الكشف
  const adjPosted = await txQuery<{ cnt: string }>(
    client,
    `SELECT COUNT(*)::text AS cnt
     FROM accounts.bank_statement_lines
     WHERE bank_statement_id = $1::uuid
       AND adjustment_journal_entry_id IS NOT NULL`,
    [statement.id]
  );
  if (Number(adjPosted.rows[0]?.cnt ?? 0) > 0) {
    throw new AccountsHttpError(
      'لا يمكن إلغاء كشف مرتبط بقيود تسوية مرحّلة — يجب عكس قيود التسوية أولاً',
      409
    );
  }

  const upd = await txQuery<BankStatementRow>(
    client,
    `UPDATE accounts.bank_statements SET
       status = 'CANCELLED',
       cancellation_reason = $2,
       cancelled_by = $3::uuid,
       cancelled_at = NOW(),
       updated_by = $3::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [statement.id, reason, params.userId]
  );
  const row = upd.rows[0];

  await writeFinancialAudit(client, {
    userId: params.userId,
    action: 'bank_statement.cancelled',
    entityType: 'bank_statement',
    entityId: row.id,
    newValues: { reason },
    description: `إلغاء كشف الحساب المصرفي ${row.statement_number}`,
  });

  return row;
}

/**
 * رقم السطر التالي — يُستدعى تحت قفل استشاري + FOR UPDATE على رأس الكشف لضمان التسلسل.
 */
async function nextLineNumber(client: TxClient, statementId: string): Promise<number> {
  const r = await txQuery<{ next: string }>(
    client,
    `SELECT COALESCE(MAX(line_number), 0) + 1 AS next
     FROM accounts.bank_statement_lines
     WHERE bank_statement_id = $1::uuid`,
    [statementId]
  );
  return Number(r.rows[0]?.next ?? 1);
}

function parseLineSides(
  debitInput: unknown,
  creditInput: unknown
): { debit: string; credit: string } {
  const debit = normalizeMoneyInput(debitInput ?? '0');
  const credit = normalizeMoneyInput(creditInput ?? '0');
  const debitPos = moneyIsPositive(debit);
  const creditPos = moneyIsPositive(credit);
  if (debitPos && creditPos) {
    throw new AccountsHttpError('لا يمكن أن يكون السطر مديناً ودائناً معاً', 400);
  }
  if (!debitPos && !creditPos) {
    throw new AccountsHttpError('يجب إدخال مبلغ مدين أو دائن أكبر من صفر', 400);
  }
  return { debit, credit };
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === '23505';
}

export async function addBankStatementLine(
  client: TxClient,
  input: {
    statementId: string;
    transaction_date: unknown;
    value_date?: unknown;
    description: unknown;
    bank_reference?: unknown;
    debit_amount?: unknown;
    credit_amount?: unknown;
    running_balance?: unknown;
    external_line_id?: unknown;
    notes?: unknown;
    userId: string;
  }
): Promise<BankStatementLineRow> {
  const statement = await loadBankStatement(client, input.statementId, true);
  assertStatementEditable(statement);

  await assertCanReconcileBankAccount(client, {
    bankAccountId: statement.bank_account_id,
    userId: input.userId,
  });

  await acquireAccountingResourceLocks(client, [bankStatementLock(statement.id)]);

  const transactionDate = pgDateOnly(String(input.transaction_date ?? ''));
  if (!transactionDate) throw new AccountsHttpError('تاريخ الحركة مطلوب', 400);
  let valueDate: string | null = null;
  if (input.value_date != null && input.value_date !== '') {
    valueDate = pgDateOnly(String(input.value_date));
  }

  const description = requireDescription(input.description, 'وصف الحركة');
  const bankReference = normalizeOptionalText(input.bank_reference, 100);
  const externalLineId = normalizeOptionalText(input.external_line_id, 100);
  const notes = normalizeOptionalText(input.notes, 4000);
  const { debit, credit } = parseLineSides(input.debit_amount, input.credit_amount);
  const runningBalance =
    input.running_balance != null && input.running_balance !== ''
      ? normalizeSignedMoneyInput(input.running_balance)
      : null;

  const fingerprint = computeLineFingerprint({
    transaction_date: transactionDate,
    description,
    bank_reference: bankReference,
    debit_amount: debit,
    credit_amount: credit,
    external_line_id: externalLineId,
  });

  const lineNumber = await nextLineNumber(client, statement.id);

  try {
    const ins = await txQuery<BankStatementLineRow>(
      client,
      `INSERT INTO accounts.bank_statement_lines (
         bank_statement_id, line_number, transaction_date, value_date, description,
         bank_reference, debit_amount, credit_amount, running_balance, currency_code,
         external_line_id, fingerprint, notes
       ) VALUES (
         $1::uuid, $2, $3::date, $4::date, $5,
         $6, $7::numeric, $8::numeric, $9::numeric, $10,
         $11, $12, $13
       ) RETURNING *`,
      [
        statement.id,
        lineNumber,
        transactionDate,
        valueDate,
        description,
        bankReference,
        debit,
        credit,
        runningBalance,
        statement.currency_code,
        externalLineId,
        fingerprint,
        notes,
      ]
    );
    return ins.rows[0];
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new AccountsHttpError(
        'هذا السطر مكرر (نفس البيانات أو المعرّف الخارجي) ضمن هذا الكشف',
        409
      );
    }
    throw e;
  }
}

export async function updateBankStatementLine(
  client: TxClient,
  params: {
    lineId: string;
    userId: string;
    transaction_date?: unknown;
    value_date?: unknown;
    description?: unknown;
    bank_reference?: unknown;
    debit_amount?: unknown;
    credit_amount?: unknown;
    running_balance?: unknown;
    external_line_id?: unknown;
    notes?: unknown;
  }
): Promise<BankStatementLineRow> {
  const line = await loadBankStatementLine(client, params.lineId, true);
  const statement = await loadBankStatement(client, line.bank_statement_id, true);
  assertStatementEditable(statement);

  await assertCanReconcileBankAccount(client, {
    bankAccountId: statement.bank_account_id,
    userId: params.userId,
  });

  if (line.match_status === 'EXCLUDED') {
    throw new AccountsHttpError('لا يمكن تعديل سطر مستبعد — أعد إدراجه أولاً', 409);
  }

  const amountFieldsTouched =
    params.debit_amount !== undefined ||
    params.credit_amount !== undefined ||
    params.transaction_date !== undefined;

  if (amountFieldsTouched) {
    const matched = await txQuery<{ total: string }>(
      client,
      `SELECT COALESCE(SUM(matched_amount), 0)::text AS total
       FROM accounts.bank_reconciliation_matches
       WHERE bank_statement_line_id = $1::uuid`,
      [line.id]
    );
    if (moneyToMillis(normalizeMoneyInput(matched.rows[0]?.total ?? '0')) > BigInt(0)) {
      throw new AccountsHttpError(
        'أزل المطابقات المرتبطة بهذا السطر قبل تعديل المبلغ أو التاريخ',
        409
      );
    }
  }

  const transactionDate =
    params.transaction_date !== undefined
      ? pgDateOnly(String(params.transaction_date || ''))
      : pgDateOnly(line.transaction_date);
  if (!transactionDate) throw new AccountsHttpError('تاريخ الحركة غير صالح', 400);

  let valueDate = line.value_date ? pgDateOnly(line.value_date) : null;
  if (params.value_date !== undefined) {
    valueDate =
      params.value_date == null || params.value_date === ''
        ? null
        : pgDateOnly(String(params.value_date));
  }

  const description =
    params.description !== undefined
      ? requireDescription(params.description, 'وصف الحركة')
      : line.description;

  const bankReference =
    params.bank_reference !== undefined
      ? normalizeOptionalText(params.bank_reference, 100)
      : line.bank_reference;
  const externalLineId =
    params.external_line_id !== undefined
      ? normalizeOptionalText(params.external_line_id, 100)
      : line.external_line_id;
  const notes =
    params.notes !== undefined ? normalizeOptionalText(params.notes, 4000) : line.notes;

  const { debit, credit } =
    params.debit_amount !== undefined || params.credit_amount !== undefined
      ? parseLineSides(
          params.debit_amount !== undefined ? params.debit_amount : line.debit_amount,
          params.credit_amount !== undefined ? params.credit_amount : line.credit_amount
        )
      : { debit: normalizeMoneyInput(line.debit_amount), credit: normalizeMoneyInput(line.credit_amount) };

  const runningBalance =
    params.running_balance !== undefined
      ? params.running_balance == null || params.running_balance === ''
        ? null
        : normalizeSignedMoneyInput(params.running_balance)
      : line.running_balance == null
        ? null
        : normalizeSignedMoneyInput(line.running_balance);

  const fingerprint = computeLineFingerprint({
    transaction_date: transactionDate,
    description,
    bank_reference: bankReference,
    debit_amount: debit,
    credit_amount: credit,
    external_line_id: externalLineId,
  });

  try {
    const upd = await txQuery<BankStatementLineRow>(
      client,
      `UPDATE accounts.bank_statement_lines SET
         transaction_date = $2::date,
         value_date = $3::date,
         description = $4,
         bank_reference = $5,
         debit_amount = $6::numeric,
         credit_amount = $7::numeric,
         running_balance = $8::numeric,
         external_line_id = $9,
         notes = $10,
         fingerprint = $11,
         updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING *`,
      [
        line.id,
        transactionDate,
        valueDate,
        description,
        bankReference,
        debit,
        credit,
        runningBalance,
        externalLineId,
        notes,
        fingerprint,
      ]
    );
    return upd.rows[0];
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new AccountsHttpError(
        'هذا السطر مكرر (نفس البيانات أو المعرّف الخارجي) ضمن هذا الكشف',
        409
      );
    }
    throw e;
  }
}

export async function deleteBankStatementLine(
  client: TxClient,
  params: { lineId: string; userId: string }
): Promise<void> {
  const line = await loadBankStatementLine(client, params.lineId, true);
  const statement = await loadBankStatement(client, line.bank_statement_id, true);
  assertStatementEditable(statement);

  await assertCanReconcileBankAccount(client, {
    bankAccountId: statement.bank_account_id,
    userId: params.userId,
  });

  if (line.adjustment_journal_entry_id) {
    throw new AccountsHttpError(
      'لا يمكن حذف سطر مرتبط بقيد تسوية مرحّل — يجب عكس القيد أولاً',
      409
    );
  }

  const matched = await txQuery<{ total: string }>(
    client,
    `SELECT COUNT(*)::int AS cnt
     FROM accounts.bank_reconciliation_matches
     WHERE bank_statement_line_id = $1::uuid`,
    [line.id]
  );
  if (Number((matched.rows[0] as unknown as { cnt: number })?.cnt ?? 0) > 0) {
    throw new AccountsHttpError(
      'أزل المطابقات المرتبطة بهذا السطر قبل حذفه',
      409
    );
  }

  await txQuery(
    client,
    `DELETE FROM accounts.bank_statement_lines WHERE id = $1::uuid`,
    [line.id]
  );
}

export async function excludeBankStatementLine(
  client: TxClient,
  params: { lineId: string; userId: string; reason: unknown }
): Promise<BankStatementLineRow> {
  const line = await loadBankStatementLine(client, params.lineId, true);
  const statement = await loadBankStatement(client, line.bank_statement_id, true);
  assertStatementEditable(statement);

  await assertCanReconcileBankAccount(client, {
    bankAccountId: statement.bank_account_id,
    userId: params.userId,
  });

  if (line.match_status === 'EXCLUDED') return line;

  const matched = await txQuery<{ total: string }>(
    client,
    `SELECT COALESCE(SUM(matched_amount), 0)::text AS total
     FROM accounts.bank_reconciliation_matches
     WHERE bank_statement_line_id = $1::uuid`,
    [line.id]
  );
  if (moneyToMillis(normalizeMoneyInput(matched.rows[0]?.total ?? '0')) > BigInt(0)) {
    throw new AccountsHttpError(
      'لا يمكن استبعاد سطر مرتبط بمطابقات — أزلها أولاً',
      409
    );
  }

  const reason = requireReason(params.reason, 'سبب الاستبعاد');

  const upd = await txQuery<BankStatementLineRow>(
    client,
    `UPDATE accounts.bank_statement_lines SET
       match_status = 'EXCLUDED',
       exclusion_reason = $2,
       updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [line.id, reason]
  );
  return upd.rows[0];
}

export async function unexcludeBankStatementLine(
  client: TxClient,
  params: { lineId: string; userId: string }
): Promise<BankStatementLineRow> {
  const line = await loadBankStatementLine(client, params.lineId, true);
  const statement = await loadBankStatement(client, line.bank_statement_id, true);
  assertStatementEditable(statement);

  await assertCanReconcileBankAccount(client, {
    bankAccountId: statement.bank_account_id,
    userId: params.userId,
  });

  if (line.match_status !== 'EXCLUDED') {
    throw new AccountsHttpError('السطر غير مستبعد', 409);
  }

  const upd = await txQuery<BankStatementLineRow>(
    client,
    `UPDATE accounts.bank_statement_lines SET
       match_status = 'UNMATCHED',
       exclusion_reason = NULL,
       updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [line.id]
  );
  return upd.rows[0];
}
