/**
 * الحسابات المصرفية — المرحلة 4.A
 */
import { getAccountBookBalanceTx } from './account-book-balance';
import { AccountsHttpError } from './auth';
import { loadBank } from './banks';
import { loadBankBranch } from './bank-branches';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import {
  moneyEquals,
  normalizeSignedMoneyInput,
} from './money';
import { pgDateOnly } from './document-sequences';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type BankAccountType =
  | 'CURRENT'
  | 'SAVINGS'
  | 'DEPOSIT'
  | 'ESCROW'
  | 'OTHER';

export type BankAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export type BankAccountRow = {
  id: string;
  code: string;
  bank_id: string;
  bank_branch_id: string | null;
  account_name_ar: string;
  account_name_en: string | null;
  account_number: string;
  account_number_normalized: string;
  iban: string | null;
  iban_normalized: string | null;
  currency_code: string;
  gl_account_id: string;
  account_type: BankAccountType;
  status: BankAccountStatus;
  opening_balance_reference: string | null;
  opening_balance_date: string | Date | null;
  is_primary: boolean;
  allows_receipts: boolean;
  allows_payments: boolean;
  allows_transfers: boolean;
  allows_cheques: boolean;
  cheque_book_enabled: boolean;
  notes: string | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  suspended_at: Date | string | null;
  suspended_by: string | null;
  closed_at: Date | string | null;
  closed_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type BankAccountUserRow = {
  id: string;
  bank_account_id: string;
  user_id: string;
  can_view: boolean;
  can_prepare: boolean;
  can_post: boolean;
  can_approve: boolean;
  can_reconcile: boolean;
  created_by: string;
  created_at: Date | string;
};

const ACCOUNT_TYPES = new Set<BankAccountType>([
  'CURRENT',
  'SAVINGS',
  'DEPOSIT',
  'ESCROW',
  'OTHER',
]);

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export function normalizeAccountNumber(value: unknown): {
  display: string;
  normalized: string;
} {
  const raw = String(value ?? '').trim();
  if (!raw) throw new AccountsHttpError('رقم الحساب مطلوب', 400);
  const normalized = raw.replace(/[\s\-]/g, '').toUpperCase();
  if (!normalized || normalized.length < 3 || normalized.length > 80) {
    throw new AccountsHttpError('رقم الحساب غير صالح', 400);
  }
  if (!/^[A-Z0-9]+$/.test(normalized)) {
    throw new AccountsHttpError('رقم الحساب يحتوي محارف غير مسموحة', 400);
  }
  return { display: raw.slice(0, 80), normalized };
}

/** تطبيع IBAN للمقارنة والتخزين (إزالة فراغات/شرطات، أحرف كبيرة) */
export function normalizeIban(value: unknown): {
  display: string | null;
  normalized: string | null;
} {
  if (value == null || value === '') return { display: null, normalized: null };
  const raw = String(value).trim();
  if (!raw) return { display: null, normalized: null };
  const normalized = raw.replace(/[\s\-]/g, '').toUpperCase();
  if (normalized.length < 15 || normalized.length > 34) {
    throw new AccountsHttpError('IBAN غير صالح (الطول غير مناسب)', 400);
  }
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(normalized)) {
    throw new AccountsHttpError('صيغة IBAN غير صالحة', 400);
  }
  return { display: raw.slice(0, 50), normalized };
}

export function formatIbanDisplay(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const n = iban.replace(/[\s\-]/g, '').toUpperCase();
  return n.replace(/(.{4})/g, '$1 ').trim();
}

function normalizeCurrency(value: unknown): string {
  const s = String(value ?? 'IQD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(s)) {
    throw new AccountsHttpError('رمز العملة يجب أن يكون 3 أحرف (ISO)', 400);
  }
  return s;
}

function normalizeCode(value: unknown): string {
  const s = String(value ?? '').trim().toUpperCase();
  if (!s) throw new AccountsHttpError('الكود الداخلي مطلوب', 400);
  return s.slice(0, 50);
}

function requireNameAr(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError('اسم الحساب بالعربية مطلوب', 400);
  return s.slice(0, 200);
}

function optText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, max);
  return s || null;
}

function parseAccountType(value: unknown): BankAccountType {
  const t = String(value ?? 'CURRENT').trim().toUpperCase() as BankAccountType;
  if (!ACCOUNT_TYPES.has(t)) {
    throw new AccountsHttpError('نوع الحساب المصرفي غير صالح', 400);
  }
  return t;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return Boolean(value);
}

export function serializeBankAccount(row: BankAccountRow) {
  return {
    ...row,
    opening_balance_reference:
      row.opening_balance_reference == null
        ? null
        : String(row.opening_balance_reference),
    opening_balance_date: row.opening_balance_date
      ? pgDateOnly(row.opening_balance_date as string | Date)
      : null,
    iban_display: formatIbanDisplay(row.iban_normalized || row.iban),
    suspended_at: iso(row.suspended_at),
    closed_at: iso(row.closed_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

function assertOptimistic(
  row: BankAccountRow,
  version: unknown,
  updatedAt: unknown
) {
  assertCashSessionOptimisticConcurrency({
    currentVersion: row.version,
    currentUpdatedAt: row.updated_at,
    expectedVersion: version,
    expectedUpdatedAt: updatedAt,
  });
}

export async function loadBankAccount(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<BankAccountRow> {
  const r = await txQuery<BankAccountRow>(
    client,
    `SELECT * FROM accounts.bank_accounts WHERE id = $1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('الحساب المصرفي غير موجود', 404);
  return r.rows[0];
}

/**
 * التحقق من صلاحية حساب GL للحساب البنكي.
 * يرفض: تجميعي، غير ترحيلي، غير فعّال، غير ASSET، مربوط بصندوق، مربوط بحساب بنكي آخر.
 */
export async function assertValidBankGlAccount(
  client: TxClient,
  accountId: string,
  excludeBankAccountId?: string | null
): Promise<{ id: string; code: string; name_ar: string }> {
  const acc = await txQuery<{
    id: string;
    code: string;
    name_ar: string;
    is_group: boolean;
    allow_posting: boolean;
    is_active: boolean;
    account_type_code: string;
  }>(
    client,
    `SELECT a.id, a.code, a.name_ar, a.is_group, a.allow_posting, a.is_active,
            t.code AS account_type_code
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE a.id = $1::uuid`,
    [accountId]
  );
  if (!acc.rows[0]) throw new AccountsHttpError('حساب GL غير موجود', 404);
  const row = acc.rows[0];
  if (row.account_type_code !== 'ASSET') {
    throw new AccountsHttpError('يجب أن يكون حساب GL من نوع الأصول (ASSET)', 400);
  }
  if (row.is_group) {
    throw new AccountsHttpError('لا يمكن ربط الحساب البنكي بحساب GL تجميعي', 400);
  }
  if (!row.allow_posting) {
    throw new AccountsHttpError('حساب GL غير قابل للترحيل', 400);
  }
  if (!row.is_active) {
    throw new AccountsHttpError('حساب GL غير فعّال', 400);
  }

  const cash = await txQuery(
    client,
    `SELECT code FROM accounts.cash_boxes
     WHERE account_id = $1::uuid AND status IN ('ACTIVE', 'SUSPENDED', 'DRAFT', 'CLOSED')
     LIMIT 1`,
    [accountId]
  );
  if (cash.rows[0]) {
    throw new AccountsHttpError(
      `حساب GL مستخدم لصندوق نقدي (${cash.rows[0].code})`,
      409
    );
  }

  const bank = await txQuery(
    client,
    `SELECT code FROM accounts.bank_accounts
     WHERE gl_account_id = $1::uuid
       AND ($2::uuid IS NULL OR id <> $2::uuid)
     LIMIT 1`,
    [accountId, excludeBankAccountId ?? null]
  );
  if (bank.rows[0]) {
    throw new AccountsHttpError(
      `حساب GL مرتبط بحساب مصرفي آخر (${bank.rows[0].code})`,
      409
    );
  }

  return { id: row.id, code: row.code, name_ar: row.name_ar };
}

export async function listEligibleBankGlAccounts(
  client: TxClient,
  excludeBankAccountId?: string | null
): Promise<
  Array<{
    id: string;
    code: string;
    name_ar: string;
    account_type_code: string;
  }>
> {
  const r = await txQuery(
    client,
    `SELECT a.id, a.code, a.name_ar, t.code AS account_type_code
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE t.code = 'ASSET'
       AND NOT a.is_group
       AND a.allow_posting
       AND a.is_active
       AND NOT EXISTS (
         SELECT 1 FROM accounts.cash_boxes cb WHERE cb.account_id = a.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM accounts.bank_accounts ba
         WHERE ba.gl_account_id = a.id
           AND ($1::uuid IS NULL OR ba.id <> $1::uuid)
       )
     ORDER BY a.code
     LIMIT 500`,
    [excludeBankAccountId ?? null]
  );
  return r.rows as Array<{
    id: string;
    code: string;
    name_ar: string;
    account_type_code: string;
  }>;
}

async function clearOtherPrimaries(
  client: TxClient,
  currency: string,
  excludeId?: string | null
): Promise<void> {
  await txQuery(
    client,
    `UPDATE accounts.bank_accounts SET
       is_primary = FALSE,
       updated_at = NOW(),
       version = version + 1
     WHERE currency_code = $1
       AND is_primary = TRUE
       AND status <> 'CLOSED'
       AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [currency, excludeId ?? null]
  );
}

export async function createBankAccount(
  client: TxClient,
  input: {
    code: unknown;
    bank_id: unknown;
    bank_branch_id?: unknown;
    account_name_ar: unknown;
    account_name_en?: unknown;
    account_number: unknown;
    iban?: unknown;
    currency_code?: unknown;
    gl_account_id: unknown;
    account_type?: unknown;
    opening_balance_reference?: unknown;
    opening_balance_date?: unknown;
    is_primary?: unknown;
    allows_receipts?: unknown;
    allows_payments?: unknown;
    allows_transfers?: unknown;
    allows_cheques?: unknown;
    cheque_book_enabled?: unknown;
    notes?: unknown;
    created_by: string;
  }
): Promise<BankAccountRow> {
  const bankId = String(input.bank_id ?? '').trim();
  if (!bankId) throw new AccountsHttpError('المصرف مطلوب', 400);
  const bank = await loadBank(client, bankId, true);
  if (!bank.is_active) {
    throw new AccountsHttpError('لا يمكن إنشاء حساب لمصرف غير فعّال', 409);
  }

  let branchId: string | null = null;
  if (input.bank_branch_id != null && input.bank_branch_id !== '') {
    branchId = String(input.bank_branch_id).trim();
    const branch = await loadBankBranch(client, branchId, true);
    if (branch.bank_id !== bankId) {
      throw new AccountsHttpError('الفرع لا يتبع المصرف المختار', 409);
    }
    if (!branch.is_active) {
      throw new AccountsHttpError('الفرع غير فعّال', 409);
    }
  }

  const glId = String(input.gl_account_id ?? '').trim();
  if (!glId) throw new AccountsHttpError('حساب GL مطلوب', 400);
  await assertValidBankGlAccount(client, glId);

  const num = normalizeAccountNumber(input.account_number);
  const iban = normalizeIban(input.iban);
  const currency = normalizeCurrency(input.currency_code);
  const allowsCheques = bool(input.allows_cheques, false);
  let chequeBook = bool(input.cheque_book_enabled, false);
  if (!allowsCheques) chequeBook = false;

  const isPrimary = bool(input.is_primary, false);
  if (isPrimary) await clearOtherPrimaries(client, currency);

  let openingRef: string | null = null;
  if (
    input.opening_balance_reference != null &&
    input.opening_balance_reference !== ''
  ) {
    openingRef = normalizeSignedMoneyInput(input.opening_balance_reference);
  }
  let openingDate: string | null = null;
  if (input.opening_balance_date != null && input.opening_balance_date !== '') {
    openingDate = pgDateOnly(String(input.opening_balance_date).trim());
  }

  const ins = await txQuery<BankAccountRow>(
    client,
    `INSERT INTO accounts.bank_accounts (
       code, bank_id, bank_branch_id, account_name_ar, account_name_en,
       account_number, account_number_normalized, iban, iban_normalized,
       currency_code, gl_account_id, account_type, status,
       opening_balance_reference, opening_balance_date, is_primary,
       allows_receipts, allows_payments, allows_transfers, allows_cheques,
       cheque_book_enabled, notes, created_by, updated_by
     ) VALUES (
       $1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$12,'ACTIVE',
       $13::numeric,$14::date,$15,$16,$17,$18,$19,$20,$21,$22::uuid,$22::uuid
     ) RETURNING *`,
    [
      normalizeCode(input.code),
      bankId,
      branchId,
      requireNameAr(input.account_name_ar),
      optText(input.account_name_en, 200),
      num.display,
      num.normalized,
      iban.display,
      iban.normalized,
      currency,
      glId,
      parseAccountType(input.account_type),
      openingRef,
      openingDate,
      isPrimary,
      bool(input.allows_receipts, true),
      bool(input.allows_payments, true),
      bool(input.allows_transfers, true),
      allowsCheques,
      chequeBook,
      optText(input.notes, 4000),
      input.created_by,
    ]
  );
  return ins.rows[0];
}

export async function updateBankAccount(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    account_name_ar?: unknown;
    account_name_en?: unknown;
    bank_branch_id?: unknown;
    account_number?: unknown;
    iban?: unknown;
    account_type?: unknown;
    opening_balance_reference?: unknown;
    opening_balance_date?: unknown;
    is_primary?: unknown;
    allows_receipts?: unknown;
    allows_payments?: unknown;
    allows_transfers?: unknown;
    allows_cheques?: unknown;
    cheque_book_enabled?: unknown;
    notes?: unknown;
    // gl_account_id / currency / bank_id intentionally not freely changed after create
    // in 4.A we allow currency/gl only if no future movements — none exist yet, but keep bank fixed
    gl_account_id?: unknown;
  }
): Promise<BankAccountRow> {
  const acc = await loadBankAccount(client, params.id, true);
  assertOptimistic(acc, params.version, params.updated_at);
  if (acc.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن تعديل حساب مصرفي مغلق', 409);
  }

  let branchId = acc.bank_branch_id;
  if (params.bank_branch_id !== undefined) {
    if (params.bank_branch_id === null || params.bank_branch_id === '') {
      branchId = null;
    } else {
      branchId = String(params.bank_branch_id).trim();
      const branch = await loadBankBranch(client, branchId, true);
      if (branch.bank_id !== acc.bank_id) {
        throw new AccountsHttpError('الفرع لا يتبع المصرف المختار', 409);
      }
      if (!branch.is_active) {
        throw new AccountsHttpError('الفرع غير فعّال', 409);
      }
    }
  }

  let glId = acc.gl_account_id;
  if (params.gl_account_id !== undefined && params.gl_account_id !== '') {
    glId = String(params.gl_account_id).trim();
    // مستقبلاً: منع التغيير عند وجود حركات مصرفية
    await assertValidBankGlAccount(client, glId, acc.id);
  }

  const num =
    params.account_number !== undefined
      ? normalizeAccountNumber(params.account_number)
      : {
          display: acc.account_number,
          normalized: acc.account_number_normalized,
        };
  const iban =
    params.iban !== undefined
      ? normalizeIban(params.iban)
      : { display: acc.iban, normalized: acc.iban_normalized };

  const allowsCheques =
    params.allows_cheques !== undefined
      ? bool(params.allows_cheques, acc.allows_cheques)
      : acc.allows_cheques;
  let chequeBook =
    params.cheque_book_enabled !== undefined
      ? bool(params.cheque_book_enabled, acc.cheque_book_enabled)
      : acc.cheque_book_enabled;
  if (!allowsCheques) chequeBook = false;

  const isPrimary =
    params.is_primary !== undefined
      ? bool(params.is_primary, acc.is_primary)
      : acc.is_primary;
  if (isPrimary) await clearOtherPrimaries(client, acc.currency_code, acc.id);

  let openingRef = acc.opening_balance_reference;
  if (params.opening_balance_reference !== undefined) {
    openingRef =
      params.opening_balance_reference === null ||
      params.opening_balance_reference === ''
        ? null
        : normalizeSignedMoneyInput(params.opening_balance_reference);
  }
  let openingDate = acc.opening_balance_date
    ? pgDateOnly(acc.opening_balance_date as string | Date)
    : null;
  if (params.opening_balance_date !== undefined) {
    openingDate =
      params.opening_balance_date === null || params.opening_balance_date === ''
        ? null
        : pgDateOnly(String(params.opening_balance_date).trim());
  }

  const upd = await txQuery<BankAccountRow>(
    client,
    `UPDATE accounts.bank_accounts SET
       bank_branch_id = $2::uuid,
       account_name_ar = $3,
       account_name_en = $4,
       account_number = $5,
       account_number_normalized = $6,
       iban = $7,
       iban_normalized = $8,
       gl_account_id = $9::uuid,
       account_type = $10,
       opening_balance_reference = $11::numeric,
       opening_balance_date = $12::date,
       is_primary = $13,
       allows_receipts = $14,
       allows_payments = $15,
       allows_transfers = $16,
       allows_cheques = $17,
       cheque_book_enabled = $18,
       notes = $19,
       updated_by = $20::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      acc.id,
      branchId,
      params.account_name_ar !== undefined
        ? requireNameAr(params.account_name_ar)
        : acc.account_name_ar,
      params.account_name_en !== undefined
        ? optText(params.account_name_en, 200)
        : acc.account_name_en,
      num.display,
      num.normalized,
      iban.display,
      iban.normalized,
      glId,
      params.account_type !== undefined
        ? parseAccountType(params.account_type)
        : acc.account_type,
      openingRef,
      openingDate,
      isPrimary,
      params.allows_receipts !== undefined
        ? bool(params.allows_receipts, acc.allows_receipts)
        : acc.allows_receipts,
      params.allows_payments !== undefined
        ? bool(params.allows_payments, acc.allows_payments)
        : acc.allows_payments,
      params.allows_transfers !== undefined
        ? bool(params.allows_transfers, acc.allows_transfers)
        : acc.allows_transfers,
      allowsCheques,
      chequeBook,
      params.notes !== undefined ? optText(params.notes, 4000) : acc.notes,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function suspendBankAccount(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<BankAccountRow> {
  const acc = await loadBankAccount(client, params.id, true);
  assertOptimistic(acc, params.version, params.updated_at);
  if (acc.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن تعليق حساب مغلق', 409);
  }
  if (acc.status === 'SUSPENDED') return acc;

  const upd = await txQuery<BankAccountRow>(
    client,
    `UPDATE accounts.bank_accounts SET
       status = 'SUSPENDED',
       suspended_at = NOW(),
       suspended_by = $2::uuid,
       is_primary = FALSE,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [acc.id, params.userId]
  );
  return upd.rows[0];
}

export async function activateBankAccount(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<BankAccountRow> {
  const acc = await loadBankAccount(client, params.id, true);
  assertOptimistic(acc, params.version, params.updated_at);
  if (acc.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن إعادة فتح حساب مغلق', 409);
  }
  if (acc.status === 'ACTIVE') return acc;

  const bank = await loadBank(client, acc.bank_id);
  if (!bank.is_active) {
    throw new AccountsHttpError('المصرف غير فعّال — لا يمكن تفعيل الحساب', 409);
  }
  await assertValidBankGlAccount(client, acc.gl_account_id, acc.id);

  const upd = await txQuery<BankAccountRow>(
    client,
    `UPDATE accounts.bank_accounts SET
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

export async function closeBankAccount(
  client: TxClient,
  params: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<BankAccountRow> {
  const acc = await loadBankAccount(client, params.id, true);
  assertOptimistic(acc, params.version, params.updated_at);
  if (acc.status === 'CLOSED') return acc;

  const bal = await getAccountBookBalanceTx(client, acc.gl_account_id);
  if (!moneyEquals(normalizeSignedMoneyInput(bal.balance), '0')) {
    throw new AccountsHttpError(
      'لا يمكن إغلاق الحساب المصرفي لأن رصيد حساب GL غير صفري',
      409
    );
  }

  const upd = await txQuery<BankAccountRow>(
    client,
    `UPDATE accounts.bank_accounts SET
       status = 'CLOSED',
       is_primary = FALSE,
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

export async function listBankAccountUsers(
  client: TxClient,
  bankAccountId: string
): Promise<BankAccountUserRow[]> {
  const r = await txQuery<BankAccountUserRow>(
    client,
    `SELECT * FROM accounts.bank_account_users
     WHERE bank_account_id = $1::uuid ORDER BY created_at`,
    [bankAccountId]
  );
  return r.rows;
}

export async function assignBankAccountUser(
  client: TxClient,
  params: {
    bank_account_id: string;
    user_id: unknown;
    can_view?: unknown;
    can_prepare?: unknown;
    can_post?: unknown;
    can_approve?: unknown;
    can_reconcile?: unknown;
    created_by: string;
  }
): Promise<BankAccountUserRow> {
  const acc = await loadBankAccount(client, params.bank_account_id, true);
  if (acc.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن إدارة مستخدمين لحساب مغلق', 409);
  }
  const userId = String(params.user_id ?? '').trim();
  if (!userId) throw new AccountsHttpError('المستخدم مطلوب', 400);

  const user = await txQuery(
    client,
    `SELECT id FROM student_affairs.users WHERE id = $1::uuid AND is_active`,
    [userId]
  );
  if (!user.rows[0]) throw new AccountsHttpError('المستخدم غير موجود أو غير نشط', 404);

  const flags = {
    can_view: bool(params.can_view, true),
    can_prepare: bool(params.can_prepare, false),
    can_post: bool(params.can_post, false),
    can_approve: bool(params.can_approve, false),
    can_reconcile: bool(params.can_reconcile, false),
  };
  if (
    !flags.can_view &&
    !flags.can_prepare &&
    !flags.can_post &&
    !flags.can_approve &&
    !flags.can_reconcile
  ) {
    throw new AccountsHttpError('يجب منح صلاحية واحدة على الأقل', 400);
  }

  const existing = await txQuery<BankAccountUserRow>(
    client,
    `SELECT * FROM accounts.bank_account_users
     WHERE bank_account_id = $1::uuid AND user_id = $2::uuid`,
    [acc.id, userId]
  );
  if (existing.rows[0]) {
    const upd = await txQuery<BankAccountUserRow>(
      client,
      `UPDATE accounts.bank_account_users SET
         can_view = $3, can_prepare = $4, can_post = $5,
         can_approve = $6, can_reconcile = $7
       WHERE id = $1::uuid
       RETURNING *`,
      [
        existing.rows[0].id,
        userId,
        flags.can_view,
        flags.can_prepare,
        flags.can_post,
        flags.can_approve,
        flags.can_reconcile,
      ]
    );
    return upd.rows[0];
  }

  const ins = await txQuery<BankAccountUserRow>(
    client,
    `INSERT INTO accounts.bank_account_users (
       bank_account_id, user_id, can_view, can_prepare, can_post,
       can_approve, can_reconcile, created_by
     ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::uuid)
     RETURNING *`,
    [
      acc.id,
      userId,
      flags.can_view,
      flags.can_prepare,
      flags.can_post,
      flags.can_approve,
      flags.can_reconcile,
      params.created_by,
    ]
  );
  return ins.rows[0];
}

export async function removeBankAccountUser(
  client: TxClient,
  params: { bank_account_id: string; user_id: string }
): Promise<BankAccountUserRow> {
  await loadBankAccount(client, params.bank_account_id, true);
  const del = await txQuery<BankAccountUserRow>(
    client,
    `DELETE FROM accounts.bank_account_users
     WHERE bank_account_id = $1::uuid AND user_id = $2::uuid
     RETURNING *`,
    [params.bank_account_id, params.user_id]
  );
  if (!del.rows[0]) {
    throw new AccountsHttpError('تعيين المستخدم غير موجود', 404);
  }
  return del.rows[0];
}

/** هل المستخدم مخول على الحساب (أو لديه وصول نظامي عام عبر Accounts) */
export async function userCanManageBankAccount(
  client: TxClient,
  params: { bankAccountId: string; userId: string }
): Promise<boolean> {
  const assigned = await txQuery(
    client,
    `SELECT 1 FROM accounts.bank_account_users
     WHERE bank_account_id = $1::uuid AND user_id = $2::uuid
       AND (can_view OR can_prepare OR can_post OR can_approve OR can_reconcile)
     LIMIT 1`,
    [params.bankAccountId, params.userId]
  );
  return Boolean(assigned.rows[0]);
}
