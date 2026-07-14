/**
 * التحويلات بين الحسابات المصرفية — المرحلة 4.C
 *
 * القرار المحاسبي: قيد واحد متعدد الأسطر لكل تحويل.
 * بدون رسوم: Dr Destination / Cr Source
 * مع رسوم: Dr Destination (amount) + Dr Fees (fee) / Cr Source (amount+fee)
 *
 * التزامن: acquireBanksLock + قفل صفوف الحسابات البنكية و Bank GL بترتيب
 * UUID ثابت لتجنب deadlock عند التحويلات المتعاكسة.
 */
import { getAccountBookBalanceTx } from './account-book-balance';
import {
  assertCanPostBankAccount,
  assertCanPrepareBankAccount,
  assertCanViewBankAccount,
} from './bank-account-access';
import { loadBankAccount, type BankAccountRow } from './bank-accounts';
import {
  assertBankAccountOperational,
  calculateBankAccountBookBalance,
} from './bank-vouchers';
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

export type BankTransferStatus = 'DRAFT' | 'POSTED' | 'VOID';

export type BankTransferRow = {
  id: string;
  transfer_number: string;
  status: BankTransferStatus;
  fiscal_year_id: string;
  fiscal_period_id: string;
  source_bank_account_id: string;
  destination_bank_account_id: string;
  transfer_date: string | Date;
  value_date: string | Date | null;
  amount: string;
  currency_code: string;
  fee_amount: string;
  fee_expense_account_id: string | null;
  cost_center_id: string | null;
  bank_reference: string | null;
  external_reference: string | null;
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

export type BankTransferImpact = {
  source_debit_total: string;
  destination_credit_total: string;
  fee_amount: string;
  currency_code: string;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export function serializeBankTransfer(row: BankTransferRow) {
  return {
    ...row,
    amount: normalizeMoneyInput(row.amount),
    fee_amount: normalizeMoneyInput(row.fee_amount ?? '0'),
    transfer_date: pgDateOnly(row.transfer_date),
    value_date: row.value_date ? pgDateOnly(row.value_date) : null,
    posted_at: iso(row.posted_at),
    voided_at: iso(row.voided_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

function requireDescription(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError('بيان التحويل مطلوب', 400);
  return s.slice(0, 4000);
}

function normalizeOptionalText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null;
  const s = String(value).trim().slice(0, max);
  return s || null;
}

function assertOptimistic(
  row: BankTransferRow,
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

export async function loadBankTransfer(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<BankTransferRow> {
  const r = await txQuery<BankTransferRow>(
    client,
    `SELECT * FROM accounts.bank_transfers WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('التحويل المصرفي غير موجود', 404);
  return r.rows[0];
}

export async function allocateBankTransferNumber(
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
     SELECT 'BANK_TRANSFER_VOUCHER'::varchar, $1::uuid, 'BTR'::varchar, 0, 6, TRUE, TRUE
     WHERE NOT EXISTS (
       SELECT 1 FROM accounts.document_sequences
       WHERE document_type = 'BANK_TRANSFER_VOUCHER' AND fiscal_year_id = $1::uuid
     )`,
    [fiscalYearId]
  );
  try {
    const seq = await nextDocumentNumber(client, {
      documentType: 'BANK_TRANSFER_VOUCHER',
      fiscalYearId,
      yearLabel: yearLabelFromDate(year.rows[0].start_date),
    });
    return seq.formatted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'تعذر تخصيص رقم التحويل';
    throw new AccountsHttpError(msg, 409);
  }
}

async function resolveOpenFiscalForDate(
  client: TxClient,
  transferDate: string
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
    [transferDate]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError(
      'لا توجد فترة مالية مفتوحة تغطي تاريخ التحويل',
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
): Promise<{
  id: string;
  code: string;
  requires_cost_center: boolean;
  account_type_code: string;
}> {
  const r = await txQuery<{
    id: string;
    code: string;
    is_active: boolean;
    is_group: boolean;
    allow_posting: boolean;
    requires_cost_center: boolean;
    account_type_code: string;
  }>(
    client,
    `SELECT a.id, a.code, a.is_active, a.is_group, a.allow_posting,
            a.requires_cost_center, t.code AS account_type_code
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE a.id = $1::uuid`,
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
    account_type_code: a.account_type_code,
  };
}

/**
 * صلاحيات العرض: can_view على المصدر والوجهة (تحفظي) — Admin يتجاوز.
 */
export async function assertCanViewBankTransfer(
  client: TxClient,
  params: { transferId: string; userId: string }
): Promise<BankTransferRow> {
  const t = await loadBankTransfer(client, params.transferId);
  await assertCanViewBankAccount(client, {
    bankAccountId: t.source_bank_account_id,
    userId: params.userId,
  });
  await assertCanViewBankAccount(client, {
    bankAccountId: t.destination_bank_account_id,
    userId: params.userId,
  });
  return t;
}

async function assertPreparePair(
  client: TxClient,
  params: {
    sourceId: string;
    destinationId: string;
    userId: string;
  }
): Promise<void> {
  await assertCanPrepareBankAccount(client, {
    bankAccountId: params.sourceId,
    userId: params.userId,
  });
  await assertCanViewBankAccount(client, {
    bankAccountId: params.destinationId,
    userId: params.userId,
  });
}

async function assertPostPair(
  client: TxClient,
  params: {
    sourceId: string;
    destinationId: string;
    userId: string;
  }
): Promise<void> {
  await assertCanPostBankAccount(client, {
    bankAccountId: params.sourceId,
    userId: params.userId,
  });
  await assertCanViewBankAccount(client, {
    bankAccountId: params.destinationId,
    userId: params.userId,
  });
}

export async function assertBankTransferAccounts(
  client: TxClient,
  params: {
    sourceId: string;
    destinationId: string;
    amount: string;
    feeAmount: string;
    feeExpenseAccountId: string | null;
    costCenterId: string | null;
    /** عند false لا يُقفل صف الحساب (بعد قفل مرتّب مسبق) */
    forUpdate?: boolean;
  }
): Promise<{
  source: BankAccountRow;
  destination: BankAccountRow;
  feeAccount: Awaited<ReturnType<typeof assertPostingAccount>> | null;
}> {
  if (params.sourceId === params.destinationId) {
    throw new AccountsHttpError(
      'لا يجوز أن يكون الحساب المصدر هو نفسه الوجهة',
      400
    );
  }

  const source = await assertBankAccountOperational(client, params.sourceId, {
    forTransfer: true,
    forUpdate: params.forUpdate,
  });
  const destination = await assertBankAccountOperational(
    client,
    params.destinationId,
    { forTransfer: true, forUpdate: params.forUpdate }
  );

  if (source.currency_code !== destination.currency_code) {
    throw new AccountsHttpError(
      'يجب أن يكون للحسابين نفس العملة (تحويل متعدد العملات خارج نطاق 4.C)',
      409
    );
  }
  if (source.gl_account_id === destination.gl_account_id) {
    throw new AccountsHttpError(
      'حسابا GL للمصدر والوجهة يجب أن يكونا مختلفين',
      409
    );
  }

  await assertPostingAccount(client, source.gl_account_id, 'حساب GL المصدر');
  await assertPostingAccount(
    client,
    destination.gl_account_id,
    'حساب GL الوجهة'
  );

  const feeMillis = moneyToMillis(params.feeAmount);
  let feeAccount: Awaited<ReturnType<typeof assertPostingAccount>> | null = null;
  if (feeMillis > BigInt(0)) {
    if (!params.feeExpenseAccountId) {
      throw new AccountsHttpError(
        'حساب مصروف الرسوم مطلوب عندما تكون الرسوم أكبر من صفر',
        400
      );
    }
    feeAccount = await assertPostingAccount(
      client,
      params.feeExpenseAccountId,
      'حساب مصروف الرسوم'
    );
    if (feeAccount.account_type_code !== 'EXPENSE') {
      throw new AccountsHttpError(
        'حساب مصروف الرسوم يجب أن يكون من نوع مصروف (EXPENSE)',
        400
      );
    }
    if (
      feeAccount.id === source.gl_account_id ||
      feeAccount.id === destination.gl_account_id
    ) {
      throw new AccountsHttpError(
        'حساب الرسوم لا يجوز أن يكون GL المصدر أو الوجهة',
        400
      );
    }
  }

  const sourceGl = await assertPostingAccount(
    client,
    source.gl_account_id,
    'حساب GL المصدر'
  );
  const destGl = await assertPostingAccount(
    client,
    destination.gl_account_id,
    'حساب GL الوجهة'
  );
  const needsCc =
    sourceGl.requires_cost_center ||
    destGl.requires_cost_center ||
    Boolean(feeAccount?.requires_cost_center);
  if (needsCc && !params.costCenterId) {
    throw new AccountsHttpError(
      'أحد الحسابات يتطلب مركز كلفة',
      409
    );
  }
  if (params.costCenterId) {
    const cc = await txQuery(
      client,
      `SELECT id FROM accounts.cost_centers
       WHERE id = $1::uuid AND is_active = TRUE`,
      [params.costCenterId]
    );
    if (!cc.rows[0]) {
      throw new AccountsHttpError('مركز الكلفة غير موجود أو غير فعّال', 400);
    }
  }

  if (!moneyIsPositive(params.amount)) {
    throw new AccountsHttpError('مبلغ التحويل يجب أن يكون أكبر من صفر', 400);
  }

  return { source, destination, feeAccount };
}

export function calculateBankTransferImpact(params: {
  amount: unknown;
  fee_amount?: unknown;
  currency_code: string;
}): BankTransferImpact {
  const amount = normalizeMoneyInput(params.amount);
  const fee = normalizeMoneyInput(params.fee_amount ?? '0');
  const total = millisToMoney(moneyToMillis(amount) + moneyToMillis(fee));
  return {
    source_debit_total: total,
    destination_credit_total: amount,
    fee_amount: fee,
    currency_code: params.currency_code,
  };
}

/**
 * قفل الحسابات و GL بترتيب UUID تصاعدي لتجنب deadlock عند A→B و B→A.
 */
async function lockTransferBalanceParticipants(
  client: TxClient,
  params: {
    source: BankAccountRow;
    destination: BankAccountRow;
    feeGlId: string | null;
  }
): Promise<void> {
  const bankIds = [
    params.source.id,
    params.destination.id,
  ].sort((a, b) => a.localeCompare(b));
  for (const id of bankIds) {
    await loadBankAccount(client, id, true);
  }

  const glIds = [
    params.source.gl_account_id,
    params.destination.gl_account_id,
    ...(params.feeGlId ? [params.feeGlId] : []),
  ].sort((a, b) => a.localeCompare(b));
  for (const glId of glIds) {
    await txQuery(
      client,
      `SELECT id FROM accounts.chart_of_accounts WHERE id = $1::uuid FOR UPDATE`,
      [glId]
    );
  }

  // قفل سندات/تحويلات مرتبطة بالمصدر (خصم) بنفس روح 4.B
  await txQuery(
    client,
    `SELECT id FROM accounts.bank_vouchers
     WHERE bank_account_id = $1::uuid FOR UPDATE`,
    [params.source.id]
  );
  await txQuery(
    client,
    `SELECT id FROM accounts.bank_transfers
     WHERE source_bank_account_id = $1::uuid
        OR destination_bank_account_id = $1::uuid
     FOR UPDATE`,
    [params.source.id]
  );
}

export async function createBankTransfer(
  client: TxClient,
  input: {
    source_bank_account_id: unknown;
    destination_bank_account_id: unknown;
    transfer_date: unknown;
    value_date?: unknown;
    amount: unknown;
    fee_amount?: unknown;
    fee_expense_account_id?: unknown;
    cost_center_id?: unknown;
    bank_reference?: unknown;
    external_reference?: unknown;
    description: unknown;
    created_by: string;
  }
): Promise<BankTransferRow> {
  const sourceId = String(input.source_bank_account_id || '').trim();
  const destinationId = String(input.destination_bank_account_id || '').trim();
  if (!sourceId || !destinationId) {
    throw new AccountsHttpError('الحساب المصدر والوجهة مطلوبان', 400);
  }

  await assertPreparePair(client, {
    sourceId,
    destinationId,
    userId: input.created_by,
  });

  const transferDate = pgDateOnly(String(input.transfer_date || ''));
  if (!transferDate) {
    throw new AccountsHttpError('تاريخ التحويل غير صالح', 400);
  }
  let valueDate: string | null = null;
  if (input.value_date != null && input.value_date !== '') {
    valueDate = pgDateOnly(String(input.value_date));
  }

  const amount = normalizeMoneyInput(input.amount);
  const feeAmount = normalizeMoneyInput(input.fee_amount ?? '0');
  const feeExpenseAccountId =
    input.fee_expense_account_id == null || input.fee_expense_account_id === ''
      ? null
      : String(input.fee_expense_account_id).trim();
  const costCenterId =
    input.cost_center_id == null || input.cost_center_id === ''
      ? null
      : String(input.cost_center_id).trim();

  const { source } = await assertBankTransferAccounts(client, {
    sourceId,
    destinationId,
    amount,
    feeAmount,
    feeExpenseAccountId,
    costCenterId,
  });

  const fiscal = await resolveOpenFiscalForDate(client, transferDate);
  await assertFiscalContextForEntry(client, {
    fiscalYearId: fiscal.fiscalYearId,
    fiscalPeriodId: fiscal.fiscalPeriodId,
    entryDate: transferDate,
  });

  const transferNumber = await allocateBankTransferNumber(
    client,
    fiscal.fiscalYearId
  );

  const ins = await txQuery<BankTransferRow>(
    client,
    `INSERT INTO accounts.bank_transfers (
       transfer_number, status, fiscal_year_id, fiscal_period_id,
       source_bank_account_id, destination_bank_account_id,
       transfer_date, value_date, amount, currency_code,
       fee_amount, fee_expense_account_id, cost_center_id,
       bank_reference, external_reference, description,
       created_by, updated_by
     ) VALUES (
       $1, 'DRAFT', $2::uuid, $3::uuid,
       $4::uuid, $5::uuid,
       $6::date, $7::date, $8::numeric, $9,
       $10::numeric, $11::uuid, $12::uuid,
       $13, $14, $15,
       $16::uuid, $16::uuid
     ) RETURNING *`,
    [
      transferNumber,
      fiscal.fiscalYearId,
      fiscal.fiscalPeriodId,
      sourceId,
      destinationId,
      transferDate,
      valueDate,
      amount,
      source.currency_code,
      feeAmount,
      feeExpenseAccountId,
      costCenterId,
      normalizeOptionalText(input.bank_reference, 100),
      normalizeOptionalText(input.external_reference, 100),
      requireDescription(input.description),
      input.created_by,
    ]
  );
  return ins.rows[0];
}

export async function updateBankTransfer(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    source_bank_account_id?: unknown;
    destination_bank_account_id?: unknown;
    transfer_date?: unknown;
    value_date?: unknown;
    amount?: unknown;
    fee_amount?: unknown;
    fee_expense_account_id?: unknown;
    cost_center_id?: unknown;
    bank_reference?: unknown;
    external_reference?: unknown;
    description?: unknown;
  }
): Promise<BankTransferRow> {
  const row = await loadBankTransfer(client, params.id, true);
  assertOptimistic(row, params.version, params.updated_at);
  if (row.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن تعديل المسودات فقط', 409);
  }

  await assertPreparePair(client, {
    sourceId: row.source_bank_account_id,
    destinationId: row.destination_bank_account_id,
    userId: params.userId,
  });

  let sourceId = row.source_bank_account_id;
  let destinationId = row.destination_bank_account_id;
  if (params.source_bank_account_id !== undefined) {
    sourceId = String(params.source_bank_account_id || '').trim();
    if (!sourceId) throw new AccountsHttpError('الحساب المصدر مطلوب', 400);
  }
  if (params.destination_bank_account_id !== undefined) {
    destinationId = String(params.destination_bank_account_id || '').trim();
    if (!destinationId) throw new AccountsHttpError('الحساب الوجهة مطلوب', 400);
  }

  if (
    sourceId !== row.source_bank_account_id ||
    destinationId !== row.destination_bank_account_id
  ) {
    await assertPreparePair(client, {
      sourceId,
      destinationId,
      userId: params.userId,
    });
  }

  let transferDate = pgDateOnly(row.transfer_date);
  if (params.transfer_date !== undefined) {
    transferDate = pgDateOnly(String(params.transfer_date || ''));
    if (!transferDate) throw new AccountsHttpError('تاريخ التحويل غير صالح', 400);
  }

  let valueDate = row.value_date ? pgDateOnly(row.value_date) : null;
  if (params.value_date !== undefined) {
    valueDate =
      params.value_date == null || params.value_date === ''
        ? null
        : pgDateOnly(String(params.value_date));
  }

  const amount =
    params.amount !== undefined
      ? normalizeMoneyInput(params.amount)
      : normalizeMoneyInput(row.amount);
  const feeAmount =
    params.fee_amount !== undefined
      ? normalizeMoneyInput(params.fee_amount)
      : normalizeMoneyInput(row.fee_amount ?? '0');

  let feeExpenseAccountId = row.fee_expense_account_id;
  if (params.fee_expense_account_id !== undefined) {
    feeExpenseAccountId =
      params.fee_expense_account_id == null ||
      params.fee_expense_account_id === ''
        ? null
        : String(params.fee_expense_account_id).trim();
  }
  if (moneyToMillis(feeAmount) === BigInt(0)) {
    feeExpenseAccountId = null;
  }

  let costCenterId = row.cost_center_id;
  if (params.cost_center_id !== undefined) {
    costCenterId =
      params.cost_center_id == null || params.cost_center_id === ''
        ? null
        : String(params.cost_center_id).trim();
  }

  const { source } = await assertBankTransferAccounts(client, {
    sourceId,
    destinationId,
    amount,
    feeAmount,
    feeExpenseAccountId,
    costCenterId,
  });

  await assertFiscalContextForEntry(client, {
    fiscalYearId: row.fiscal_year_id,
    fiscalPeriodId: row.fiscal_period_id,
    entryDate: transferDate,
  });

  const fiscal = await resolveOpenFiscalForDate(client, transferDate);
  if (
    fiscal.fiscalYearId !== row.fiscal_year_id ||
    fiscal.fiscalPeriodId !== row.fiscal_period_id
  ) {
    // يسمح بتحديث الفترة إذا غيّر التاريخ فترة أخرى OPEN ضمن نفس السنة النشطة
  }

  const description =
    params.description !== undefined
      ? requireDescription(params.description)
      : row.description;

  const upd = await txQuery<BankTransferRow>(
    client,
    `UPDATE accounts.bank_transfers SET
       source_bank_account_id = $2::uuid,
       destination_bank_account_id = $3::uuid,
       fiscal_year_id = $4::uuid,
       fiscal_period_id = $5::uuid,
       transfer_date = $6::date,
       value_date = $7::date,
       amount = $8::numeric,
       currency_code = $9,
       fee_amount = $10::numeric,
       fee_expense_account_id = $11::uuid,
       cost_center_id = $12::uuid,
       bank_reference = $13,
       external_reference = $14,
       description = $15,
       updated_by = $16::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      row.id,
      sourceId,
      destinationId,
      fiscal.fiscalYearId,
      fiscal.fiscalPeriodId,
      transferDate,
      valueDate,
      amount,
      source.currency_code,
      feeAmount,
      feeExpenseAccountId,
      costCenterId,
      params.bank_reference !== undefined
        ? normalizeOptionalText(params.bank_reference, 100)
        : row.bank_reference,
      params.external_reference !== undefined
        ? normalizeOptionalText(params.external_reference, 100)
        : row.external_reference,
      description,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function postBankTransfer(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<{ transfer: BankTransferRow; created: boolean }> {
  const transfer = await loadBankTransfer(client, params.id, true);

  if (transfer.status === 'POSTED' && transfer.journal_entry_id) {
    return { transfer, created: false };
  }
  if (transfer.status === 'VOID') {
    throw new AccountsHttpError('لا يمكن ترحيل تحويل ملغى', 409);
  }
  if (transfer.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن ترحيل المسودات فقط', 409);
  }
  assertOptimistic(transfer, params.version, params.updated_at);

  await assertPostPair(client, {
    sourceId: transfer.source_bank_account_id,
    destinationId: transfer.destination_bank_account_id,
    userId: params.userId,
  });

  await acquireBanksLock(client);

  const amount = normalizeMoneyInput(transfer.amount);
  const feeAmount = normalizeMoneyInput(transfer.fee_amount ?? '0');

  // تحميل أولي بلا قفل ثم قفل مرتّب — يمنع deadlock مع تحويلات متعاكسة أو 4.B
  const sourcePeek = await loadBankAccount(
    client,
    transfer.source_bank_account_id,
    false
  );
  const destPeek = await loadBankAccount(
    client,
    transfer.destination_bank_account_id,
    false
  );
  await lockTransferBalanceParticipants(client, {
    source: sourcePeek,
    destination: destPeek,
    feeGlId: transfer.fee_expense_account_id,
  });

  const { source, destination } = await assertBankTransferAccounts(client, {
    sourceId: transfer.source_bank_account_id,
    destinationId: transfer.destination_bank_account_id,
    amount,
    feeAmount,
    feeExpenseAccountId: transfer.fee_expense_account_id,
    costCenterId: transfer.cost_center_id,
    forUpdate: false,
  });

  if (transfer.currency_code !== source.currency_code) {
    throw new AccountsHttpError(
      'عملة التحويل لا تطابق عملة الحساب المصدر',
      409
    );
  }

  const transferDate = pgDateOnly(transfer.transfer_date);
  await assertFiscalContextForEntry(client, {
    fiscalYearId: transfer.fiscal_year_id,
    fiscalPeriodId: transfer.fiscal_period_id,
    entryDate: transferDate,
  });

  const book = await getAccountBookBalanceTx(client, source.gl_account_id);
  const totalDebit = millisToMoney(
    moneyToMillis(amount) + moneyToMillis(feeAmount)
  );
  if (moneyToMillis(totalDebit) > moneyToMillisSigned(book.balance)) {
    throw new AccountsHttpError(
      'لا يمكن ترحيل التحويل لأن رصيد الحساب المصدر المتاح غير كافٍ (المبلغ + الرسوم).',
      409
    );
  }

  const costCenterId = transfer.cost_center_id;
  const linesInput =
    moneyToMillis(feeAmount) > BigInt(0) && transfer.fee_expense_account_id
      ? [
          {
            account_id: destination.gl_account_id,
            cost_center_id: costCenterId,
            debit_amount: amount,
            credit_amount: '0',
            description: `تحويل وارد ${transfer.transfer_number}`,
          },
          {
            account_id: transfer.fee_expense_account_id,
            cost_center_id: costCenterId,
            debit_amount: feeAmount,
            credit_amount: '0',
            description: `رسوم تحويل ${transfer.transfer_number}`,
          },
          {
            account_id: source.gl_account_id,
            cost_center_id: costCenterId,
            debit_amount: '0',
            credit_amount: totalDebit,
            description: `تحويل صادر ${transfer.transfer_number}`,
          },
        ]
      : [
          {
            account_id: destination.gl_account_id,
            cost_center_id: costCenterId,
            debit_amount: amount,
            credit_amount: '0',
            description: `تحويل وارد ${transfer.transfer_number}`,
          },
          {
            account_id: source.gl_account_id,
            cost_center_id: costCenterId,
            debit_amount: '0',
            credit_amount: amount,
            description: `تحويل صادر ${transfer.transfer_number}`,
          },
        ];

  const { lines, totalDebit: td, totalCredit: tc } =
    await normalizeAndValidateLines(client, linesInput, 'strict');

  const entryNumber = await allocateJournalEntryNumber(
    client,
    transfer.fiscal_year_id
  );
  const jeDesc = [
    'تحويل مصرفي',
    transfer.transfer_number,
    `${source.code} → ${destination.code}`,
    transfer.description,
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
      ($1, $2::uuid, $3::uuid, $4::date, 'TRANSFER',
       'BANK_TRANSFER', $5::uuid, $6, $7,
       $8::numeric, $9::numeric, 'POSTED',
       1, $10::uuid, $10::uuid, $10::uuid, NOW())
     RETURNING id`,
    [
      entryNumber,
      transfer.fiscal_year_id,
      transfer.fiscal_period_id,
      transferDate,
      transfer.id,
      transfer.bank_reference ||
        transfer.external_reference ||
        transfer.transfer_number,
      jeDesc,
      td,
      tc,
      params.userId,
    ]
  );
  const journalId = jeIns.rows[0].id as string;
  await replaceJournalLines(client, journalId, lines);

  const posted = await txQuery<BankTransferRow>(
    client,
    `UPDATE accounts.bank_transfers SET
       status = 'POSTED',
       journal_entry_id = $2::uuid,
       posted_by = $3::uuid,
       posted_at = NOW(),
       updated_by = $3::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [transfer.id, journalId, params.userId]
  );
  return { transfer: posted.rows[0], created: true };
}

export async function voidBankTransfer(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason: unknown;
  }
): Promise<BankTransferRow> {
  const transfer = await loadBankTransfer(client, params.id, true);
  assertOptimistic(transfer, params.version, params.updated_at);

  const reason = String(params.reason ?? '').trim();
  if (!reason) throw new AccountsHttpError('سبب الإلغاء مطلوب', 400);

  if (transfer.status === 'VOID') {
    return transfer;
  }

  await assertPostPair(client, {
    sourceId: transfer.source_bank_account_id,
    destinationId: transfer.destination_bank_account_id,
    userId: params.userId,
  });

  await acquireBanksLock(client);

  // قفل الحسابات بترتيب UUID ثابت (ليس مصدر ثم وجهة) لتوافق POST والتحويلات المتعاكسة
  const bankIds = [
    transfer.source_bank_account_id,
    transfer.destination_bank_account_id,
  ].sort((a, b) => a.localeCompare(b));
  const lockedBanks = new Map<string, BankAccountRow>();
  for (const id of bankIds) {
    lockedBanks.set(id, await loadBankAccount(client, id, true));
  }
  const sourceAcc = lockedBanks.get(transfer.source_bank_account_id)!;
  const destAcc = lockedBanks.get(transfer.destination_bank_account_id)!;
  if (sourceAcc.status === 'CLOSED' || destAcc.status === 'CLOSED') {
    throw new AccountsHttpError(
      'لا يمكن إلغاء تحويل مرتبط بحساب مصرفي مغلق',
      409
    );
  }

  if (transfer.status === 'DRAFT') {
    const upd = await txQuery<BankTransferRow>(
      client,
      `UPDATE accounts.bank_transfers SET
         status = 'VOID',
         void_reason = $2,
         voided_by = $3::uuid,
         voided_at = NOW(),
         updated_by = $3::uuid,
         updated_at = NOW(),
         version = version + 1
       WHERE id = $1::uuid
       RETURNING *`,
      [transfer.id, reason, params.userId]
    );
    return upd.rows[0];
  }

  if (transfer.status !== 'POSTED' || !transfer.journal_entry_id) {
    throw new AccountsHttpError('حالة التحويل لا تسمح بالإلغاء', 409);
  }

  // قفل GL بترتيب ثابت أيضاً عند العكس
  const glIds = [sourceAcc.gl_account_id, destAcc.gl_account_id].sort((a, b) =>
    a.localeCompare(b)
  );
  for (const glId of glIds) {
    await txQuery(
      client,
      `SELECT id FROM accounts.chart_of_accounts WHERE id = $1::uuid FOR UPDATE`,
      [glId]
    );
  }

  const original = await loadJournalEntry(client, transfer.journal_entry_id);
  // تاريخ العكس = transfer_date (مثل 4.B) — ليس تاريخ الإلغاء؛ الفترة يجب أن تكون OPEN
  const reversalDate = pgDateOnly(transfer.transfer_date);
  const reversal = await createReversalEntry(client, {
    original,
    reversalDate,
    reason: `إلغاء تحويل ${transfer.transfer_number}: ${reason}`,
    userId: params.userId,
  });

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

  const upd = await txQuery<BankTransferRow>(
    client,
    `UPDATE accounts.bank_transfers SET
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
    [transfer.id, reversal.id, reason, params.userId]
  );
  return upd.rows[0];
}

export async function deleteDraftBankTransfer(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<void> {
  const row = await loadBankTransfer(client, params.id, true);
  assertOptimistic(row, params.version, params.updated_at);
  if (row.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن حذف المسودات فقط', 409);
  }
  await assertPreparePair(client, {
    sourceId: row.source_bank_account_id,
    destinationId: row.destination_bank_account_id,
    userId: params.userId,
  });
  await txQuery(client, `DELETE FROM accounts.bank_transfers WHERE id = $1::uuid`, [
    row.id,
  ]);
}

export { calculateBankAccountBookBalance };
