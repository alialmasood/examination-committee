/**
 * سندات القبض والصرف المصرفي — المرحلة 4.B
 */
import { getAccountBookBalanceTx } from './account-book-balance';
import {
  assertCanPostBankAccount,
  assertCanPrepareBankAccount,
  assertCanViewBankAccount,
} from './bank-account-access';
import { loadBankAccount, type BankAccountRow } from './bank-accounts';
import { loadBank } from './banks';
import { loadBankBranch } from './bank-branches';
import { AccountsHttpError } from './auth';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
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
  millisToMoney,
  moneyIsPositive,
  moneyToMillis,
  moneyToMillisSigned,
  normalizeMoneyInput,
} from './money';
import type { TxClient } from './with-transaction';
import { acquireBanksLock, txQuery } from './with-transaction';

export type BankVoucherType = 'BANK_RECEIPT' | 'BANK_PAYMENT';
export type BankVoucherStatus = 'DRAFT' | 'POSTED' | 'VOID';

export type BankVoucherRow = {
  id: string;
  voucher_number: string;
  voucher_type: BankVoucherType;
  status: BankVoucherStatus;
  fiscal_year_id: string;
  fiscal_period_id: string;
  bank_account_id: string;
  counter_account_id: string;
  cost_center_id: string | null;
  voucher_date: string | Date;
  value_date: string | Date | null;
  amount: string;
  currency_code: string;
  party_name: string | null;
  party_reference: string | null;
  external_reference: string | null;
  bank_reference: string | null;
  description: string;
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

export type BankBookBalanceBreakdown = {
  bank_account_id: string;
  gl_account_id: string;
  currency_code: string;
  book_balance: string;
  source: 'POSTED_JOURNAL_LINES';
  totals: {
    bank_receipts_posted: string;
    bank_payments_posted: string;
    other_posted_net: string;
  };
  counts: {
    draft: number;
    posted: number;
    void: number;
  };
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export function serializeBankVoucher(row: BankVoucherRow) {
  return {
    ...row,
    amount: normalizeMoneyInput(row.amount),
    voucher_date: pgDateOnly(row.voucher_date),
    value_date: row.value_date ? pgDateOnly(row.value_date) : null,
    posted_at: iso(row.posted_at),
    voided_at: iso(row.voided_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

function sourceTypeFor(voucherType: BankVoucherType): string {
  return voucherType;
}

function entryTypeFor(voucherType: BankVoucherType): 'RECEIPT' | 'PAYMENT' {
  return voucherType === 'BANK_RECEIPT' ? 'RECEIPT' : 'PAYMENT';
}

function documentTypeFor(
  voucherType: BankVoucherType
): 'BANK_RECEIPT_VOUCHER' | 'BANK_PAYMENT_VOUCHER' {
  return voucherType === 'BANK_RECEIPT'
    ? 'BANK_RECEIPT_VOUCHER'
    : 'BANK_PAYMENT_VOUCHER';
}

function requireDescription(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError('بيان السند مطلوب', 400);
  return s.slice(0, 4000);
}

function normalizeOptionalText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, max);
  return s || null;
}

function parseVoucherType(value: unknown): BankVoucherType {
  const t = String(value ?? '').trim().toUpperCase();
  if (t !== 'BANK_RECEIPT' && t !== 'BANK_PAYMENT') {
    throw new AccountsHttpError('نوع السند المصرفي غير صالح', 400);
  }
  return t;
}

function assertOptimistic(
  row: BankVoucherRow,
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

export async function loadBankVoucher(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<BankVoucherRow> {
  const r = await txQuery<BankVoucherRow>(
    client,
    `SELECT * FROM accounts.bank_vouchers WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('السند المصرفي غير موجود', 404);
  return r.rows[0];
}

export async function allocateBankVoucherNumber(
  client: TxClient,
  params: { fiscalYearId: string; voucherType: BankVoucherType }
): Promise<string> {
  const year = await txQuery<{ start_date: string }>(
    client,
    `SELECT start_date::text AS start_date FROM accounts.fiscal_years WHERE id = $1`,
    [params.fiscalYearId]
  );
  if (!year.rows[0]) {
    throw new AccountsHttpError('السنة المالية غير موجودة', 404);
  }
  const docType = documentTypeFor(params.voucherType);
  // إنشاء التسلسل عند غيابها (سنوات قديمة قبل 068)
  await txQuery(
    client,
    `INSERT INTO accounts.document_sequences
      (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
     SELECT $1::varchar, $2::uuid, $3::varchar, 0, 6, TRUE, TRUE
     WHERE NOT EXISTS (
       SELECT 1 FROM accounts.document_sequences
       WHERE document_type = $1::varchar AND fiscal_year_id = $2::uuid
     )`,
    [
      docType,
      params.fiscalYearId,
      params.voucherType === 'BANK_RECEIPT' ? 'BRV' : 'BPV',
    ]
  );
  try {
    const seq = await nextDocumentNumber(client, {
      documentType: docType,
      fiscalYearId: params.fiscalYearId,
      yearLabel: yearLabelFromDate(year.rows[0].start_date),
    });
    return seq.formatted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'تعذر تخصيص رقم السند';
    throw new AccountsHttpError(msg, 409);
  }
}

async function resolveOpenFiscalForDate(
  client: TxClient,
  voucherDate: string
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
    [voucherDate]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError(
      'لا توجد فترة مالية مفتوحة تغطي تاريخ السند',
      409
    );
  }
  return {
    fiscalYearId: r.rows[0].year_id,
    fiscalPeriodId: r.rows[0].period_id,
  };
}

async function assertPostingAccount(
  client: TxClient,
  accountId: string,
  label: string
): Promise<{ id: string; code: string; requires_cost_center: boolean }> {
  const r = await txQuery<{
    id: string;
    code: string;
    is_active: boolean;
    is_group: boolean;
    allow_posting: boolean;
    requires_cost_center: boolean;
  }>(
    client,
    `SELECT id, code, is_active, is_group, allow_posting, requires_cost_center
     FROM accounts.chart_of_accounts WHERE id = $1::uuid`,
    [accountId]
  );
  if (!r.rows[0]) throw new AccountsHttpError(`${label} غير موجود`, 404);
  const a = r.rows[0];
  if (!a.is_active || a.is_group || !a.allow_posting) {
    throw new AccountsHttpError(
      `${label} يجب أن يكون تفصيلياً وترحيلياً وفعّالاً`,
      400
    );
  }
  return {
    id: a.id,
    code: a.code,
    requires_cost_center: a.requires_cost_center,
  };
}

/**
 * التحقق من صلاحية الحساب البنكي للعمليات المالية الجديدة.
 */
export async function assertBankAccountOperational(
  client: TxClient,
  bankAccountId: string,
  opts: { forReceipt?: boolean; forPayment?: boolean }
): Promise<BankAccountRow> {
  const acc = await loadBankAccount(client, bankAccountId, true);
  if (acc.status !== 'ACTIVE') {
    throw new AccountsHttpError(
      'الحساب المصرفي يجب أن يكون نشطاً (ACTIVE) لاستخدامه في العمليات',
      409
    );
  }
  const bank = await loadBank(client, acc.bank_id);
  if (!bank.is_active) {
    throw new AccountsHttpError('المصرف غير فعّال', 409);
  }
  if (acc.bank_branch_id) {
    const br = await loadBankBranch(client, acc.bank_branch_id);
    if (!br.is_active) {
      throw new AccountsHttpError('فرع المصرف غير فعّال', 409);
    }
  }
  if (opts.forReceipt && !acc.allows_receipts) {
    throw new AccountsHttpError(
      'هذا الحساب المصرفي لا يسمح بسندات القبض',
      409
    );
  }
  if (opts.forPayment && !acc.allows_payments) {
    throw new AccountsHttpError(
      'هذا الحساب المصرفي لا يسمح بسندات الصرف',
      409
    );
  }
  return acc;
}

/**
 * رصيد دفتري للحساب البنكي من قيود POSTED فقط (لا يشمل opening_balance_reference).
 */
export async function calculateBankAccountBookBalance(
  client: TxClient,
  bankAccountId: string
): Promise<BankBookBalanceBreakdown> {
  const acc = await loadBankAccount(client, bankAccountId);
  const book = await getAccountBookBalanceTx(client, acc.gl_account_id);

  const voucherTotals = await txQuery<{
    receipts: string | null;
    payments: string | null;
    draft: string;
    posted: string;
    voided: string;
  }>(
    client,
    `SELECT
       COALESCE(SUM(amount) FILTER (
         WHERE status = 'POSTED' AND voucher_type = 'BANK_RECEIPT'
       ), 0)::text AS receipts,
       COALESCE(SUM(amount) FILTER (
         WHERE status = 'POSTED' AND voucher_type = 'BANK_PAYMENT'
       ), 0)::text AS payments,
       COUNT(*) FILTER (WHERE status = 'DRAFT')::text AS draft,
       COUNT(*) FILTER (WHERE status = 'POSTED')::text AS posted,
       COUNT(*) FILTER (WHERE status = 'VOID')::text AS voided
     FROM accounts.bank_vouchers
     WHERE bank_account_id = $1::uuid`,
    [bankAccountId]
  );
  const t = voucherTotals.rows[0];
  const receipts = normalizeMoneyInput(t?.receipts ?? '0');
  const payments = normalizeMoneyInput(t?.payments ?? '0');
  const voucherNet = millisToMoney(
    moneyToMillis(receipts) - moneyToMillis(payments)
  );
  const otherNet = millisToMoney(
    moneyToMillisSigned(book.balance) - moneyToMillisSigned(voucherNet)
  );

  return {
    bank_account_id: acc.id,
    gl_account_id: acc.gl_account_id,
    currency_code: acc.currency_code,
    book_balance: book.balance,
    source: 'POSTED_JOURNAL_LINES',
    totals: {
      bank_receipts_posted: receipts,
      bank_payments_posted: payments,
      other_posted_net: otherNet,
    },
    counts: {
      draft: Number(t?.draft || 0),
      posted: Number(t?.posted || 0),
      void: Number(t?.voided || 0),
    },
  };
}

export async function createBankVoucher(
  client: TxClient,
  input: {
    voucher_type: unknown;
    bank_account_id: unknown;
    counter_account_id: unknown;
    cost_center_id?: unknown;
    voucher_date: unknown;
    value_date?: unknown;
    amount: unknown;
    party_name?: unknown;
    party_reference?: unknown;
    external_reference?: unknown;
    bank_reference?: unknown;
    description: unknown;
    currency_code?: unknown;
    fiscal_year_id?: unknown;
    fiscal_period_id?: unknown;
    created_by: string;
  }
): Promise<BankVoucherRow> {
  const voucherType = parseVoucherType(input.voucher_type);
  const bankAccountId = String(input.bank_account_id ?? '').trim();
  if (!bankAccountId) throw new AccountsHttpError('الحساب المصرفي مطلوب', 400);

  await assertCanPrepareBankAccount(client, {
    bankAccountId,
    userId: input.created_by,
  });

  const bankAcc = await assertBankAccountOperational(client, bankAccountId, {
    forReceipt: voucherType === 'BANK_RECEIPT',
    forPayment: voucherType === 'BANK_PAYMENT',
  });

  const voucherDate = pgDateOnly(String(input.voucher_date ?? ''));
  if (!voucherDate) throw new AccountsHttpError('تاريخ السند غير صالح', 400);

  let valueDate: string | null = null;
  if (input.value_date != null && input.value_date !== '') {
    valueDate = pgDateOnly(String(input.value_date));
    if (!valueDate) throw new AccountsHttpError('تاريخ القيمة غير صالح', 400);
  }

  let fiscalYearId = String(input.fiscal_year_id ?? '').trim() || null;
  let fiscalPeriodId = String(input.fiscal_period_id ?? '').trim() || null;
  if (!fiscalYearId || !fiscalPeriodId) {
    const resolved = await resolveOpenFiscalForDate(client, voucherDate);
    fiscalYearId = resolved.fiscalYearId;
    fiscalPeriodId = resolved.fiscalPeriodId;
  }

  await assertFiscalContextForEntry(client, {
    fiscalYearId,
    fiscalPeriodId,
    entryDate: voucherDate,
  });

  const counterId = String(input.counter_account_id ?? '').trim();
  if (!counterId) throw new AccountsHttpError('الحساب المقابل مطلوب', 400);
  if (counterId === bankAcc.gl_account_id) {
    throw new AccountsHttpError(
      'لا يجوز أن يكون الحساب المقابل هو حساب GL للبنك نفسه',
      400
    );
  }
  const counterAcc = await assertPostingAccount(client, counterId, 'الحساب المقابل');

  const costCenterId: string | null =
    input.cost_center_id == null || input.cost_center_id === ''
      ? null
      : String(input.cost_center_id).trim();
  if (counterAcc.requires_cost_center && !costCenterId) {
    throw new AccountsHttpError(
      'الحساب المقابل يتطلب مركز كلفة',
      409
    );
  }
  if (costCenterId) {
    const cc = await txQuery(
      client,
      `SELECT id FROM accounts.cost_centers WHERE id = $1::uuid AND is_active AND NOT is_group`,
      [costCenterId]
    );
    if (!cc.rows[0]) {
      throw new AccountsHttpError('مركز الكلفة غير صالح', 400);
    }
  }

  const amount = normalizeMoneyInput(input.amount);
  if (!moneyIsPositive(amount)) {
    throw new AccountsHttpError('مبلغ السند يجب أن يكون أكبر من صفر', 400);
  }

  const currency = bankAcc.currency_code;
  if (
    input.currency_code != null &&
    String(input.currency_code).trim() !== '' &&
    String(input.currency_code).trim().toUpperCase() !== currency
  ) {
    throw new AccountsHttpError(
      'عملة السند يجب أن تطابق عملة الحساب المصرفي',
      409
    );
  }

  const voucherNumber = await allocateBankVoucherNumber(client, {
    fiscalYearId,
    voucherType,
  });

  const ins = await txQuery<BankVoucherRow>(
    client,
    `INSERT INTO accounts.bank_vouchers (
       voucher_number, voucher_type, status, fiscal_year_id, fiscal_period_id,
       bank_account_id, counter_account_id, cost_center_id,
       voucher_date, value_date, amount, currency_code,
       party_name, party_reference, external_reference, bank_reference,
       description, created_by, updated_by
     ) VALUES (
       $1,$2,'DRAFT',$3::uuid,$4::uuid,
       $5::uuid,$6::uuid,$7::uuid,
       $8::date,$9::date,$10::numeric,$11,
       $12,$13,$14,$15,
       $16,$17::uuid,$17::uuid
     ) RETURNING *`,
    [
      voucherNumber,
      voucherType,
      fiscalYearId,
      fiscalPeriodId,
      bankAccountId,
      counterId,
      costCenterId,
      voucherDate,
      valueDate,
      amount,
      currency,
      normalizeOptionalText(input.party_name, 200),
      normalizeOptionalText(input.party_reference, 100),
      normalizeOptionalText(input.external_reference, 100),
      normalizeOptionalText(input.bank_reference, 100),
      requireDescription(input.description),
      input.created_by,
    ]
  );
  return ins.rows[0];
}

export async function updateBankVoucher(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    voucher_type?: unknown;
    bank_account_id?: unknown;
    counter_account_id?: unknown;
    cost_center_id?: unknown;
    voucher_date?: unknown;
    value_date?: unknown;
    amount?: unknown;
    party_name?: unknown;
    party_reference?: unknown;
    external_reference?: unknown;
    bank_reference?: unknown;
    description?: unknown;
  }
): Promise<BankVoucherRow> {
  const voucher = await loadBankVoucher(client, params.id, true);
  assertOptimistic(voucher, params.version, params.updated_at);
  if (voucher.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن تعديل المسودات فقط', 409);
  }

  // صلاحية الإعداد على الحساب الحالي أولاً (منع سحب سند عبر تغيير الحساب)
  await assertCanPrepareBankAccount(client, {
    bankAccountId: voucher.bank_account_id,
    userId: params.userId,
  });

  let bankAccountId = voucher.bank_account_id;
  if (params.bank_account_id !== undefined) {
    bankAccountId = String(params.bank_account_id || '').trim();
    if (!bankAccountId) throw new AccountsHttpError('الحساب المصرفي مطلوب', 400);
  }

  if (bankAccountId !== voucher.bank_account_id) {
    await assertCanPrepareBankAccount(client, {
      bankAccountId,
      userId: params.userId,
    });
  }

  let voucherType = voucher.voucher_type;
  if (params.voucher_type !== undefined) {
    voucherType = parseVoucherType(params.voucher_type);
  }

  const bankAcc = await assertBankAccountOperational(client, bankAccountId, {
    forReceipt: voucherType === 'BANK_RECEIPT',
    forPayment: voucherType === 'BANK_PAYMENT',
  });

  let voucherDate = pgDateOnly(voucher.voucher_date);
  if (params.voucher_date !== undefined) {
    voucherDate = pgDateOnly(String(params.voucher_date || ''));
    if (!voucherDate) throw new AccountsHttpError('تاريخ السند غير صالح', 400);
  }

  let valueDate = voucher.value_date ? pgDateOnly(voucher.value_date) : null;
  if (params.value_date !== undefined) {
    valueDate =
      params.value_date == null || params.value_date === ''
        ? null
        : pgDateOnly(String(params.value_date));
  }

  await assertFiscalContextForEntry(client, {
    fiscalYearId: voucher.fiscal_year_id,
    fiscalPeriodId: voucher.fiscal_period_id,
    entryDate: voucherDate,
  });

  let counterId = voucher.counter_account_id;
  if (params.counter_account_id !== undefined) {
    counterId = String(params.counter_account_id || '').trim();
    if (!counterId) throw new AccountsHttpError('الحساب المقابل مطلوب', 400);
  }
  if (counterId === bankAcc.gl_account_id) {
    throw new AccountsHttpError(
      'لا يجوز أن يكون الحساب المقابل هو حساب GL للبنك نفسه',
      400
    );
  }
  const counterAcc = await assertPostingAccount(
    client,
    counterId,
    'الحساب المقابل'
  );

  let costCenterId = voucher.cost_center_id;
  if (params.cost_center_id !== undefined) {
    costCenterId =
      params.cost_center_id == null || params.cost_center_id === ''
        ? null
        : String(params.cost_center_id);
  }
  if (counterAcc.requires_cost_center && !costCenterId) {
    throw new AccountsHttpError('الحساب المقابل يتطلب مركز كلفة', 409);
  }

  let amount = normalizeMoneyInput(voucher.amount);
  if (params.amount !== undefined) {
    amount = normalizeMoneyInput(params.amount);
    if (!moneyIsPositive(amount)) {
      throw new AccountsHttpError('مبلغ السند يجب أن يكون أكبر من صفر', 400);
    }
  }

  const upd = await txQuery<BankVoucherRow>(
    client,
    `UPDATE accounts.bank_vouchers SET
       voucher_type = $2,
       bank_account_id = $3::uuid,
       counter_account_id = $4::uuid,
       cost_center_id = $5::uuid,
       voucher_date = $6::date,
       value_date = $7::date,
       amount = $8::numeric,
       currency_code = $9,
       party_name = $10,
       party_reference = $11,
       external_reference = $12,
       bank_reference = $13,
       description = $14,
       updated_by = $15::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      voucher.id,
      voucherType,
      bankAccountId,
      counterId,
      costCenterId,
      voucherDate,
      valueDate,
      amount,
      bankAcc.currency_code,
      params.party_name !== undefined
        ? normalizeOptionalText(params.party_name, 200)
        : voucher.party_name,
      params.party_reference !== undefined
        ? normalizeOptionalText(params.party_reference, 100)
        : voucher.party_reference,
      params.external_reference !== undefined
        ? normalizeOptionalText(params.external_reference, 100)
        : voucher.external_reference,
      params.bank_reference !== undefined
        ? normalizeOptionalText(params.bank_reference, 100)
        : voucher.bank_reference,
      params.description !== undefined
        ? requireDescription(params.description)
        : voucher.description,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function postBankVoucher(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<{ voucher: BankVoucherRow; created: boolean }> {
  const voucher = await loadBankVoucher(client, params.id, true);

  if (voucher.status === 'POSTED' && voucher.journal_entry_id) {
    return { voucher, created: false };
  }
  if (voucher.status === 'VOID') {
    throw new AccountsHttpError('لا يمكن ترحيل سند ملغى', 409);
  }
  if (voucher.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن ترحيل المسودات فقط', 409);
  }
  assertOptimistic(voucher, params.version, params.updated_at);

  await assertCanPostBankAccount(client, {
    bankAccountId: voucher.bank_account_id,
    userId: params.userId,
  });

  await acquireBanksLock(client);

  const bankAcc = await assertBankAccountOperational(
    client,
    voucher.bank_account_id,
    {
      forReceipt: voucher.voucher_type === 'BANK_RECEIPT',
      forPayment: voucher.voucher_type === 'BANK_PAYMENT',
    }
  );

  if (voucher.currency_code !== bankAcc.currency_code) {
    throw new AccountsHttpError(
      'عملة السند لا تطابق عملة الحساب المصرفي',
      409
    );
  }
  if (voucher.counter_account_id === bankAcc.gl_account_id) {
    throw new AccountsHttpError(
      'لا يجوز أن يكون الحساب المقابل هو حساب GL للبنك نفسه',
      400
    );
  }

  const voucherDate = pgDateOnly(voucher.voucher_date);
  await assertFiscalContextForEntry(client, {
    fiscalYearId: voucher.fiscal_year_id,
    fiscalPeriodId: voucher.fiscal_period_id,
    entryDate: voucherDate,
  });

  const bankGl = await assertPostingAccount(
    client,
    bankAcc.gl_account_id,
    'حساب البنك GL'
  );
  const counterAcc = await assertPostingAccount(
    client,
    voucher.counter_account_id,
    'الحساب المقابل'
  );
  const costCenterId = voucher.cost_center_id;
  if (
    (bankGl.requires_cost_center || counterAcc.requires_cost_center) &&
    !costCenterId
  ) {
    throw new AccountsHttpError(
      'أحد الحسابات يتطلب مركز كلفة',
      409
    );
  }

  const amount = normalizeMoneyInput(voucher.amount);

  if (voucher.voucher_type === 'BANK_PAYMENT') {
    // تسلسل الصرف داخل نفس المعاملة بعد acquireBanksLock:
    // 1) قفل صف الحساب البنكي
    // 2) قفل صف Bank GL — يمنع تزامن أي عملية أخرى تقفل نفس الـ GL قبل الخصم
    // 3) قفل سندات الحساب
    // 4) حساب الرصيد من دفتر الأستاذ POSTED ثم الفحص
    // سياسة: كل عملية بنكية مستقبلية تخصم من الرصيد يجب أن تستخدم acquireBanksLock
    // وأن تقفل صف Bank GL (FOR UPDATE) قبل فحص الرصيد.
    await loadBankAccount(client, voucher.bank_account_id, true);
    await txQuery(
      client,
      `SELECT id FROM accounts.chart_of_accounts WHERE id = $1::uuid FOR UPDATE`,
      [bankAcc.gl_account_id]
    );
    await txQuery(
      client,
      `SELECT id FROM accounts.bank_vouchers
       WHERE bank_account_id = $1::uuid
       FOR UPDATE`,
      [voucher.bank_account_id]
    );
    const book = await getAccountBookBalanceTx(client, bankAcc.gl_account_id);
    if (moneyToMillis(amount) > moneyToMillisSigned(book.balance)) {
      throw new AccountsHttpError(
        'لا يمكن ترحيل سند الصرف لأن رصيد الحساب المصرفي المتاح غير كافٍ.',
        409
      );
    }
  }

  const linesInput =
    voucher.voucher_type === 'BANK_RECEIPT'
      ? [
          {
            account_id: bankAcc.gl_account_id,
            cost_center_id: costCenterId,
            debit_amount: amount,
            credit_amount: '0',
            description: `قبض مصرفي ${voucher.voucher_number}`,
          },
          {
            account_id: voucher.counter_account_id,
            cost_center_id: costCenterId,
            debit_amount: '0',
            credit_amount: amount,
            description: voucher.description,
          },
        ]
      : [
          {
            account_id: voucher.counter_account_id,
            cost_center_id: costCenterId,
            debit_amount: amount,
            credit_amount: '0',
            description: voucher.description,
          },
          {
            account_id: bankAcc.gl_account_id,
            cost_center_id: costCenterId,
            debit_amount: '0',
            credit_amount: amount,
            description: `صرف مصرفي ${voucher.voucher_number}`,
          },
        ];

  const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
    client,
    linesInput,
    'strict'
  );

  const entryNumber = await allocateJournalEntryNumber(
    client,
    voucher.fiscal_year_id
  );

  const typeLabel =
    voucher.voucher_type === 'BANK_RECEIPT'
      ? 'سند قبض مصرفي'
      : 'سند صرف مصرفي';
  const jeDesc = [
    typeLabel,
    voucher.voucher_number,
    bankAcc.code,
    voucher.party_name ? `طرف: ${voucher.party_name}` : null,
    voucher.description,
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
      ($1, $2::uuid, $3::uuid, $4::date, $5,
       $6, $7::uuid, $8, $9,
       $10::numeric, $11::numeric, 'POSTED',
       1, $12::uuid, $12::uuid, $12::uuid, NOW())
     RETURNING id`,
    [
      entryNumber,
      voucher.fiscal_year_id,
      voucher.fiscal_period_id,
      voucherDate,
      entryTypeFor(voucher.voucher_type),
      sourceTypeFor(voucher.voucher_type),
      voucher.id,
      voucher.bank_reference || voucher.external_reference || voucher.voucher_number,
      jeDesc,
      totalDebit,
      totalCredit,
      params.userId,
    ]
  );
  const journalId = jeIns.rows[0].id as string;
  await replaceJournalLines(client, journalId, lines);

  const posted = await txQuery<BankVoucherRow>(
    client,
    `UPDATE accounts.bank_vouchers SET
       status = 'POSTED',
       journal_entry_id = $2::uuid,
       posted_by = $3::uuid,
       posted_at = NOW(),
       updated_by = $3::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [voucher.id, journalId, params.userId]
  );
  return { voucher: posted.rows[0], created: true };
}

export async function voidBankVoucher(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason: unknown;
  }
): Promise<BankVoucherRow> {
  const voucher = await loadBankVoucher(client, params.id, true);
  assertOptimistic(voucher, params.version, params.updated_at);

  const reason = String(params.reason ?? '').trim();
  if (!reason) throw new AccountsHttpError('سبب الإلغاء مطلوب', 400);

  if (voucher.status === 'VOID') {
    return voucher;
  }

  await assertCanPostBankAccount(client, {
    bankAccountId: voucher.bank_account_id,
    userId: params.userId,
  });

  const bankAcc = await loadBankAccount(client, voucher.bank_account_id, true);
  if (bankAcc.status === 'CLOSED') {
    throw new AccountsHttpError(
      'لا يمكن إلغاء سند مرتبط بحساب مصرفي مغلق',
      409
    );
  }

  if (voucher.status === 'DRAFT') {
    const upd = await txQuery<BankVoucherRow>(
      client,
      `UPDATE accounts.bank_vouchers SET
         status = 'VOID',
         void_reason = $2,
         voided_by = $3::uuid,
         voided_at = NOW(),
         updated_by = $3::uuid,
         updated_at = NOW(),
         version = version + 1
       WHERE id = $1::uuid
       RETURNING *`,
      [voucher.id, reason, params.userId]
    );
    return upd.rows[0];
  }

  if (voucher.status !== 'POSTED' || !voucher.journal_entry_id) {
    throw new AccountsHttpError('حالة السند لا تسمح بالإلغاء', 409);
  }

  await acquireBanksLock(client);
  const original = await loadJournalEntry(client, voucher.journal_entry_id);
  const reversalDate = pgDateOnly(voucher.voucher_date);
  const reversal = await createReversalEntry(client, {
    original,
    reversalDate,
    reason: `إلغاء سند ${voucher.voucher_number}: ${reason}`,
    userId: params.userId,
  });

  // المحرك يضع الأصل REVERSED؛ لإبقاء الرصيد الدفتري صحيحاً (POSTED فقط)
  // نعيد الأصل إلى POSTED مع الإبقاء على ربط قيد العكس — الأثر الصافي = صفر.
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

  const upd = await txQuery<BankVoucherRow>(
    client,
    `UPDATE accounts.bank_vouchers SET
       status = 'VOID',
       reversal_journal_entry_id = $2::uuid,
       void_reason = $3,
       voided_by = $4::uuid,
       voided_at = NOW(),
       updated_by = $4::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [voucher.id, reversal.id, reason, params.userId]
  );
  return upd.rows[0];
}

export async function deleteDraftBankVoucher(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<void> {
  const voucher = await loadBankVoucher(client, params.id, true);
  assertOptimistic(voucher, params.version, params.updated_at);
  if (voucher.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن حذف المسودات فقط', 409);
  }
  await assertCanPrepareBankAccount(client, {
    bankAccountId: voucher.bank_account_id,
    userId: params.userId,
  });
  await txQuery(client, `DELETE FROM accounts.bank_vouchers WHERE id = $1::uuid`, [
    voucher.id,
  ]);
}

/** التحقق من صلاحية العرض على مستوى السند */
export async function assertCanViewBankVoucher(
  client: TxClient,
  params: { voucherId: string; userId: string }
): Promise<BankVoucherRow> {
  const voucher = await loadBankVoucher(client, params.voucherId);
  await assertCanViewBankAccount(client, {
    bankAccountId: voucher.bank_account_id,
    userId: params.userId,
  });
  return voucher;
}
