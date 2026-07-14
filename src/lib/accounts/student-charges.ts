/**
 * المطالبات المالية للطالب ودفتر الذمم الفرعي — المرحلة 5.A
 */
import {
  acquireAccountingResourceLocks,
  chartAccountLock,
  journalSourceLock,
  studentAccountLock,
  studentChargeLock,
  studentLedgerLock,
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
  millisToMoney,
  normalizeMoneyInput,
  normalizeSignedMoneyInput,
} from './money';
import { assertPostingAccount } from './posting-account';
import {
  assertStudentAccountActiveForCharges,
  assertValidReceivableGlAccount,
  getStudentAccountBalance,
  loadStudentAccount,
  type StudentAccountRow,
} from './student-accounts';
import {
  loadStudentFeeType,
  type StudentFeeTypeRow,
} from './student-fee-types';
import { assertStudentActiveForCharges } from './students-ref';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type StudentChargeStatus =
  | 'DRAFT'
  | 'POSTED'
  | 'PARTIALLY_SETTLED'
  | 'SETTLED'
  | 'VOID';

export type StudentChargeRow = {
  id: string;
  charge_number: string;
  student_account_id: string;
  student_id: string;
  fee_type_id: string;
  fiscal_year_id: string;
  fiscal_period_id: string;
  academic_year: string | null;
  charge_date: string | Date;
  due_date: string | Date | null;
  original_amount: string;
  outstanding_amount: string;
  currency_code: string;
  cost_center_id: string | null;
  description: string;
  external_reference: string | null;
  status: StudentChargeStatus;
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

export type StudentLedgerEntryRow = {
  id: string;
  student_account_id: string;
  student_id: string;
  entry_date: string | Date;
  entry_type: string;
  source_type: string;
  source_id: string;
  description: string;
  debit_amount: string;
  credit_amount: string;
  currency_code: string;
  journal_entry_id: string | null;
  created_by: string | null;
  created_at: Date | string;
  charge_number?: string | null;
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
  if (!s) throw new AccountsHttpError('بيان المطالبة مطلوب', 400);
  return s.slice(0, 4000);
}

function assertIqdOnly(value: unknown): string {
  const code = normalizeCurrencyCode(value, 'IQD');
  if (code !== 'IQD') {
    throw new AccountsHttpError('عملة المطالبات في المرحلة الحالية IQD فقط', 400);
  }
  return code;
}

function assertOptimistic(
  row: StudentChargeRow,
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

export function serializeStudentCharge(row: StudentChargeRow) {
  return {
    ...row,
    original_amount: normalizeMoneyInput(row.original_amount),
    outstanding_amount: normalizeMoneyInput(row.outstanding_amount),
    charge_date: pgDateOnly(row.charge_date),
    due_date: row.due_date ? pgDateOnly(row.due_date) : null,
    posted_at: iso(row.posted_at),
    voided_at: iso(row.voided_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export function serializeStudentLedgerEntry(row: StudentLedgerEntryRow) {
  return {
    ...row,
    debit_amount: normalizeMoneyInput(row.debit_amount),
    credit_amount: normalizeMoneyInput(row.credit_amount),
    entry_date: pgDateOnly(row.entry_date),
    created_at: iso(row.created_at)!,
  };
}

async function resolveOpenFiscalForDate(
  client: TxClient,
  chargeDate: string
): Promise<{ fiscalYearId: string; fiscalPeriodId: string; start_date: string }> {
  const r = await txQuery<{
    year_id: string;
    period_id: string;
    start_date: string;
  }>(
    client,
    `SELECT y.id AS year_id, p.id AS period_id, y.start_date::text AS start_date
     FROM accounts.fiscal_years y
     JOIN accounts.fiscal_periods p ON p.fiscal_year_id = y.id
     WHERE y.status = 'ACTIVE'
       AND p.status = 'OPEN'
       AND p.start_date <= $1::date
       AND p.end_date >= $1::date
     ORDER BY y.is_default DESC, p.start_date
     LIMIT 1`,
    [chargeDate]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError(
      'لا توجد فترة مالية مفتوحة تغطي تاريخ المطالبة',
      409
    );
  }
  return {
    fiscalYearId: r.rows[0].year_id,
    fiscalPeriodId: r.rows[0].period_id,
    start_date: r.rows[0].start_date,
  };
}

export async function allocateStudentChargeNumber(
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
     SELECT 'STUDENT_CHARGE', $1::uuid, 'SCH', 0, 6, TRUE, TRUE
     WHERE NOT EXISTS (
       SELECT 1 FROM accounts.document_sequences
       WHERE document_type = 'STUDENT_CHARGE' AND fiscal_year_id = $1::uuid
     )`,
    [fiscalYearId]
  );
  try {
    const seq = await nextDocumentNumber(client, {
      documentType: 'STUDENT_CHARGE',
      fiscalYearId,
      yearLabel: yearLabelFromDate(year.rows[0].start_date),
    });
    return seq.formatted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'تعذر تخصيص رقم المطالبة';
    throw new AccountsHttpError(msg, 409);
  }
}

export async function loadStudentCharge(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<StudentChargeRow> {
  const r = await txQuery<StudentChargeRow>(
    client,
    `SELECT * FROM accounts.student_charges WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('المطالبة المالية غير موجودة', 404);
  return r.rows[0];
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

function resolveCostCenterId(
  feeType: StudentFeeTypeRow,
  inputCostCenter: unknown
): string | null {
  if (inputCostCenter != null && inputCostCenter !== '') {
    return String(inputCostCenter).trim();
  }
  return feeType.default_cost_center_id;
}

export async function createStudentCharge(
  client: TxClient,
  input: {
    student_account_id: unknown;
    fee_type_id: unknown;
    charge_date?: unknown;
    due_date?: unknown;
    original_amount?: unknown;
    fiscal_year_id?: unknown;
    fiscal_period_id?: unknown;
    academic_year?: unknown;
    cost_center_id?: unknown;
    description?: unknown;
    external_reference?: unknown;
    currency_code?: unknown;
    created_by: string;
  }
): Promise<StudentChargeRow> {
  const accountId = String(input.student_account_id ?? '').trim();
  if (!accountId) throw new AccountsHttpError('الحساب المالي للطالب مطلوب', 400);

  const account = await loadStudentAccount(client, accountId, true);
  await assertStudentAccountActiveForCharges(client, account);
  await assertStudentActiveForCharges(client, account.student_id);

  const feeTypeId = String(input.fee_type_id ?? '').trim();
  if (!feeTypeId) throw new AccountsHttpError('نوع الرسم مطلوب', 400);
  const feeType = await loadStudentFeeType(client, feeTypeId, true);
  if (!feeType.is_active) {
    throw new AccountsHttpError('نوع الرسم غير فعّال', 409);
  }

  const currency = assertIqdOnly(input.currency_code ?? account.currency_code);
  if (currency !== account.currency_code) {
    throw new AccountsHttpError('عملة المطالبة لا تطابق عملة الحساب', 409);
  }
  if (feeType.currency_code !== currency) {
    throw new AccountsHttpError('عملة المطالبة لا تطابق عملة نوع الرسم', 409);
  }

  let amountRaw = input.original_amount;
  if (amountRaw == null || amountRaw === '') {
    amountRaw = feeType.default_amount;
  }
  if (amountRaw == null || amountRaw === '') {
    throw new AccountsHttpError('مبلغ المطالبة مطلوب', 400);
  }
  let amount: string;
  try {
    amount = normalizeMoneyInput(amountRaw);
  } catch {
    throw new AccountsHttpError('مبلغ المطالبة غير صالح', 400);
  }
  if (!moneyIsPositive(amount)) {
    throw new AccountsHttpError('مبلغ المطالبة يجب أن يكون أكبر من صفر', 400);
  }

  const chargeDate =
    input.charge_date != null && input.charge_date !== ''
      ? pgDateOnly(String(input.charge_date).trim())
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
    const resolved = await resolveOpenFiscalForDate(client, chargeDate);
    fiscalYearId = fiscalYearId || resolved.fiscalYearId;
    fiscalPeriodId = fiscalPeriodId || resolved.fiscalPeriodId;
  }

  await assertFiscalContextForEntry(client, {
    fiscalYearId,
    fiscalPeriodId,
    entryDate: chargeDate,
  });

  const costCenterId = resolveCostCenterId(feeType, input.cost_center_id);
  if (feeType.requires_cost_center && !costCenterId) {
    throw new AccountsHttpError('نوع الرسم يتطلب مركز كلفة', 400);
  }
  if (costCenterId) await assertCostCenterActive(client, costCenterId);

  const description =
    input.description != null && String(input.description).trim()
      ? requireDescription(input.description)
      : `مطالبة ${feeType.name_ar}`;

  const chargeNumber = await allocateStudentChargeNumber(client, fiscalYearId);

  let dueDate: string | null = null;
  if (input.due_date != null && input.due_date !== '') {
    dueDate = pgDateOnly(String(input.due_date).trim());
  }

  const ins = await txQuery<StudentChargeRow>(
    client,
    `INSERT INTO accounts.student_charges (
       charge_number, student_account_id, student_id, fee_type_id,
       fiscal_year_id, fiscal_period_id, academic_year,
       charge_date, due_date, original_amount, outstanding_amount,
       currency_code, cost_center_id, description, external_reference,
       status, created_by, updated_by
     ) VALUES (
       $1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,
       $8::date,$9::date,$10::numeric,$10::numeric,$11,$12::uuid,$13,$14,
       'DRAFT',$15::uuid,$15::uuid
     ) RETURNING *`,
    [
      chargeNumber,
      account.id,
      account.student_id,
      feeType.id,
      fiscalYearId,
      fiscalPeriodId,
      optText(input.academic_year, 20) ?? account.academic_year,
      chargeDate,
      dueDate,
      amount,
      currency,
      costCenterId,
      description,
      optText(input.external_reference, 100),
      input.created_by,
    ]
  );
  return ins.rows[0];
}

export async function updateStudentCharge(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    fee_type_id?: unknown;
    charge_date?: unknown;
    due_date?: unknown;
    original_amount?: unknown;
    fiscal_year_id?: unknown;
    fiscal_period_id?: unknown;
    academic_year?: unknown;
    cost_center_id?: unknown;
    description?: unknown;
    external_reference?: unknown;
  }
): Promise<StudentChargeRow> {
  const charge = await loadStudentCharge(client, params.id, true);
  assertOptimistic(charge, params.version, params.updated_at);
  if (charge.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن تعديل المسودات فقط', 409);
  }

  const account = await loadStudentAccount(client, charge.student_account_id, true);
  await assertStudentAccountActiveForCharges(client, account);

  let feeTypeId = charge.fee_type_id;
  if (params.fee_type_id !== undefined && params.fee_type_id !== '') {
    feeTypeId = String(params.fee_type_id).trim();
  }
  const feeType = await loadStudentFeeType(client, feeTypeId, true);
  if (!feeType.is_active) {
    throw new AccountsHttpError('نوع الرسم غير فعّال', 409);
  }

  let amount = normalizeMoneyInput(charge.original_amount);
  if (params.original_amount !== undefined && params.original_amount !== '') {
    try {
      amount = normalizeMoneyInput(params.original_amount);
    } catch {
      throw new AccountsHttpError('مبلغ المطالبة غير صالح', 400);
    }
    if (!moneyIsPositive(amount)) {
      throw new AccountsHttpError('مبلغ المطالبة يجب أن يكون أكبر من صفر', 400);
    }
  }

  const chargeDate =
    params.charge_date !== undefined && params.charge_date !== ''
      ? pgDateOnly(String(params.charge_date).trim())
      : pgDateOnly(charge.charge_date);

  let fiscalYearId = charge.fiscal_year_id;
  let fiscalPeriodId = charge.fiscal_period_id;
  if (params.fiscal_year_id !== undefined && params.fiscal_year_id !== '') {
    fiscalYearId = String(params.fiscal_year_id).trim();
  }
  if (params.fiscal_period_id !== undefined && params.fiscal_period_id !== '') {
    fiscalPeriodId = String(params.fiscal_period_id).trim();
  }
  if (
    (params.charge_date !== undefined ||
      params.fiscal_year_id !== undefined ||
      params.fiscal_period_id !== undefined) &&
    (params.fiscal_year_id === undefined || params.fiscal_period_id === undefined)
  ) {
    const resolved = await resolveOpenFiscalForDate(client, chargeDate);
    if (params.fiscal_year_id === undefined) fiscalYearId = resolved.fiscalYearId;
    if (params.fiscal_period_id === undefined) {
      fiscalPeriodId = resolved.fiscalPeriodId;
    }
  }

  await assertFiscalContextForEntry(client, {
    fiscalYearId,
    fiscalPeriodId,
    entryDate: chargeDate,
  });

  let costCenterId = charge.cost_center_id;
  if (params.cost_center_id !== undefined) {
    costCenterId =
      params.cost_center_id === null || params.cost_center_id === ''
        ? null
        : String(params.cost_center_id).trim();
  } else if (params.fee_type_id !== undefined) {
    costCenterId = resolveCostCenterId(feeType, null);
  }
  if (feeType.requires_cost_center && !costCenterId) {
    throw new AccountsHttpError('نوع الرسم يتطلب مركز كلفة', 400);
  }
  if (costCenterId) await assertCostCenterActive(client, costCenterId);

  let dueDate = charge.due_date ? pgDateOnly(charge.due_date) : null;
  if (params.due_date !== undefined) {
    dueDate =
      params.due_date === null || params.due_date === ''
        ? null
        : pgDateOnly(String(params.due_date).trim());
  }

  const upd = await txQuery<StudentChargeRow>(
    client,
    `UPDATE accounts.student_charges SET
       fee_type_id = $2::uuid,
       fiscal_year_id = $3::uuid,
       fiscal_period_id = $4::uuid,
       academic_year = $5,
       charge_date = $6::date,
       due_date = $7::date,
       original_amount = $8::numeric,
       outstanding_amount = $8::numeric,
       cost_center_id = $9::uuid,
       description = $10,
       external_reference = $11,
       updated_by = $12::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      charge.id,
      feeTypeId,
      fiscalYearId,
      fiscalPeriodId,
      params.academic_year !== undefined
        ? optText(params.academic_year, 20)
        : charge.academic_year,
      chargeDate,
      dueDate,
      amount,
      costCenterId,
      params.description !== undefined
        ? requireDescription(params.description)
        : charge.description,
      params.external_reference !== undefined
        ? optText(params.external_reference, 100)
        : charge.external_reference,
      params.userId,
    ]
  );
  return upd.rows[0];
}

async function insertLedgerCharge(
  client: TxClient,
  params: {
    account: StudentAccountRow;
    charge: StudentChargeRow;
    entryType: 'CHARGE' | 'CHARGE_REVERSAL';
    debit: string;
    credit: string;
    journalEntryId: string;
    userId: string;
    description: string;
  }
): Promise<void> {
  await writeStudentLedgerEntry(client, {
    account: params.account,
    entryDate: pgDateOnly(params.charge.charge_date),
    entryType: params.entryType,
    sourceType: 'STUDENT_CHARGE',
    sourceId: params.charge.id,
    description: params.description,
    debit: params.debit,
    credit: params.credit,
    currencyCode: params.charge.currency_code,
    journalEntryId: params.journalEntryId,
    userId: params.userId,
  });
}

export type StudentLedgerEntryType =
  | 'CHARGE'
  | 'CHARGE_REVERSAL'
  | 'COLLECTION'
  | 'COLLECTION_REVERSAL';

export async function writeStudentLedgerEntry(
  client: TxClient,
  params: {
    account: StudentAccountRow;
    entryDate: string;
    entryType: StudentLedgerEntryType;
    sourceType: 'STUDENT_CHARGE' | 'STUDENT_COLLECTION';
    sourceId: string;
    description: string;
    debit: string;
    credit: string;
    currencyCode: string;
    journalEntryId: string | null;
    userId: string;
  }
): Promise<void> {
  const debit = normalizeMoneyInput(params.debit);
  const credit = normalizeMoneyInput(params.credit);
  if (
    (moneyIsZero(debit) && moneyIsZero(credit)) ||
    (moneyIsPositive(debit) && moneyIsPositive(credit))
  ) {
    throw new AccountsHttpError('قيد دفتر الطالب يجب أن يكون مديناً أو دائناً فقط', 400);
  }
  await txQuery(
    client,
    `INSERT INTO accounts.student_ledger_entries (
       student_account_id, student_id, entry_date, entry_type,
       source_type, source_id, description,
       debit_amount, credit_amount, currency_code,
       journal_entry_id, created_by
     ) VALUES (
       $1::uuid,$2::uuid,$3::date,$4,
       $5,$6::uuid,$7,
       $8::numeric,$9::numeric,$10,
       $11::uuid,$12::uuid
     )`,
    [
      params.account.id,
      params.account.student_id,
      pgDateOnly(params.entryDate),
      params.entryType,
      params.sourceType,
      params.sourceId,
      params.description,
      debit,
      credit,
      params.currencyCode,
      params.journalEntryId,
      params.userId,
    ]
  );
}

function resolveChargeStatusAfterAllocation(
  original: string,
  outstanding: string
): StudentChargeStatus {
  if (moneyIsZero(outstanding)) return 'SETTLED';
  if (moneyEquals(outstanding, original)) return 'POSTED';
  return 'PARTIALLY_SETTLED';
}

export async function applyChargeAllocation(
  client: TxClient,
  params: { chargeId: string; allocatedAmount: string }
): Promise<StudentChargeRow> {
  const allocated = normalizeMoneyInput(params.allocatedAmount);
  if (!moneyIsPositive(allocated)) {
    throw new AccountsHttpError('مبلغ التخصيص يجب أن يكون أكبر من صفر', 400);
  }

  const charge = await loadStudentCharge(client, params.chargeId, true);
  if (
    charge.status !== 'POSTED' &&
    charge.status !== 'PARTIALLY_SETTLED' &&
    charge.status !== 'SETTLED'
  ) {
    throw new AccountsHttpError('لا يمكن تخصيص تحصيل على مطالبة غير مرحّلة', 409);
  }

  const original = normalizeMoneyInput(charge.original_amount);
  const outstanding = normalizeMoneyInput(charge.outstanding_amount);
  const newOutstandingMillis =
    moneyToMillis(outstanding) - moneyToMillis(allocated);
  if (newOutstandingMillis < BigInt(0)) {
    throw new AccountsHttpError(
      'مبلغ التخصيص يتجاوز الرصيد المتبقي للمطالبة',
      409
    );
  }

  const newOutstanding = millisToMoney(newOutstandingMillis);
  const newStatus = resolveChargeStatusAfterAllocation(original, newOutstanding);

  const upd = await txQuery<StudentChargeRow>(
    client,
    `UPDATE accounts.student_charges SET
       outstanding_amount = $2::numeric,
       status = $3,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [charge.id, newOutstanding, newStatus]
  );
  return upd.rows[0];
}

export async function reverseChargeAllocation(
  client: TxClient,
  params: { chargeId: string; allocatedAmount: string }
): Promise<StudentChargeRow> {
  const allocated = normalizeMoneyInput(params.allocatedAmount);
  if (!moneyIsPositive(allocated)) {
    throw new AccountsHttpError('مبلغ عكس التخصيص يجب أن يكون أكبر من صفر', 400);
  }

  const charge = await loadStudentCharge(client, params.chargeId, true);
  if (
    charge.status !== 'POSTED' &&
    charge.status !== 'PARTIALLY_SETTLED' &&
    charge.status !== 'SETTLED'
  ) {
    throw new AccountsHttpError('لا يمكن عكس تخصيص على مطالبة غير مرحّلة', 409);
  }

  const original = normalizeMoneyInput(charge.original_amount);
  const outstanding = normalizeMoneyInput(charge.outstanding_amount);
  const newOutstandingMillis =
    moneyToMillis(outstanding) + moneyToMillis(allocated);
  if (newOutstandingMillis > moneyToMillis(original)) {
    throw new AccountsHttpError(
      'عكس التخصيص يتجاوز مبلغ المطالبة الأصلي',
      409
    );
  }

  const newOutstanding = millisToMoney(newOutstandingMillis);
  const newStatus = resolveChargeStatusAfterAllocation(original, newOutstanding);

  const upd = await txQuery<StudentChargeRow>(
    client,
    `UPDATE accounts.student_charges SET
       outstanding_amount = $2::numeric,
       status = $3,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [charge.id, newOutstanding, newStatus]
  );
  return upd.rows[0];
}

export async function getStudentAccountReceivableBalance(
  client: TxClient,
  studentAccountId: string
): Promise<string> {
  const r = await txQuery<{ balance: string }>(
    client,
    `SELECT COALESCE(SUM(debit_amount - credit_amount), 0)::text AS balance
     FROM accounts.student_ledger_entries
     WHERE student_account_id = $1::uuid
       AND entry_type <> 'OPENING_REFERENCE'`,
    [studentAccountId]
  );
  return normalizeSignedMoneyInput(r.rows[0]?.balance ?? '0');
}

export async function postStudentCharge(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<{ charge: StudentChargeRow; created: boolean }> {
  const charge = await loadStudentCharge(client, params.id, true);

  if (charge.status === 'POSTED' && charge.journal_entry_id) {
    return { charge, created: false };
  }
  if (charge.status === 'VOID') {
    throw new AccountsHttpError('لا يمكن ترحيل مطالبة ملغاة', 409);
  }
  if (charge.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن ترحيل المسودات فقط', 409);
  }
  assertOptimistic(charge, params.version, params.updated_at);

  const accountPeek = await loadStudentAccount(
    client,
    charge.student_account_id,
    false
  );
  const feeTypePeek = await loadStudentFeeType(client, charge.fee_type_id, false);

  await acquireAccountingResourceLocks(client, [
    studentChargeLock(charge.id),
    studentAccountLock(charge.student_account_id),
    studentLedgerLock(charge.student_account_id),
    chartAccountLock(accountPeek.receivable_gl_account_id),
    chartAccountLock(feeTypePeek.revenue_gl_account_id),
    journalSourceLock('STUDENT_CHARGE', charge.id),
  ]);

  const account = await loadStudentAccount(
    client,
    charge.student_account_id,
    true
  );
  await assertStudentAccountActiveForCharges(client, account);
  await assertStudentActiveForCharges(client, account.student_id);

  const feeType = await loadStudentFeeType(client, charge.fee_type_id, true);
  if (!feeType.is_active) {
    throw new AccountsHttpError('نوع الرسم غير فعّال', 409);
  }

  const chargeDate = pgDateOnly(charge.charge_date);
  await assertFiscalContextForEntry(client, {
    fiscalYearId: charge.fiscal_year_id,
    fiscalPeriodId: charge.fiscal_period_id,
    entryDate: chargeDate,
  });

  const receivableGl = await assertValidReceivableGlAccount(
    client,
    account.receivable_gl_account_id
  );
  const revenueGl = await assertPostingAccount(
    client,
    feeType.revenue_gl_account_id,
    'حساب الإيراد',
    { invalidStatusCode: 400 }
  );

  let costCenterId = charge.cost_center_id;
  if (
    (feeType.requires_cost_center ||
      receivableGl.requires_cost_center ||
      revenueGl.requires_cost_center) &&
    !costCenterId
  ) {
    costCenterId = feeType.default_cost_center_id;
  }
  if (
    (feeType.requires_cost_center ||
      receivableGl.requires_cost_center ||
      revenueGl.requires_cost_center) &&
    !costCenterId
  ) {
    throw new AccountsHttpError('أحد الحسابات يتطلب مركز كلفة', 409);
  }
  if (costCenterId) await assertCostCenterActive(client, costCenterId);

  const amount = normalizeMoneyInput(charge.original_amount);

  const linesInput = [
    {
      account_id: account.receivable_gl_account_id,
      cost_center_id: costCenterId,
      debit_amount: amount,
      credit_amount: '0',
      description: `ذمم طلبة — ${charge.charge_number}`,
    },
    {
      account_id: feeType.revenue_gl_account_id,
      cost_center_id: costCenterId,
      debit_amount: '0',
      credit_amount: amount,
      description: charge.description,
    },
  ];

  const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
    client,
    linesInput,
    'strict'
  );

  const entryNumber = await allocateJournalEntryNumber(
    client,
    charge.fiscal_year_id
  );

  const jeDesc = [
    'مطالبة مالية طالب',
    charge.charge_number,
    feeType.name_ar,
    charge.description,
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
      ($1, $2::uuid, $3::uuid, $4::date, 'STUDENT_FEE',
       'STUDENT_CHARGE', $5::uuid, $6, $7,
       $8::numeric, $9::numeric, 'POSTED',
       1, $10::uuid, $10::uuid, $10::uuid, NOW())
     RETURNING id`,
    [
      entryNumber,
      charge.fiscal_year_id,
      charge.fiscal_period_id,
      chargeDate,
      charge.id,
      charge.external_reference || charge.charge_number,
      jeDesc,
      totalDebit,
      totalCredit,
      params.userId,
    ]
  );
  const journalId = jeIns.rows[0].id as string;
  await replaceJournalLines(client, journalId, lines);

  await insertLedgerCharge(client, {
    account,
    charge,
    entryType: 'CHARGE',
    debit: amount,
    credit: '0',
    journalEntryId: journalId,
    userId: params.userId,
    description: jeDesc,
  });

  const posted = await txQuery<StudentChargeRow>(
    client,
    `UPDATE accounts.student_charges SET
       status = 'POSTED',
       outstanding_amount = original_amount,
       cost_center_id = COALESCE($4::uuid, cost_center_id),
       journal_entry_id = $2::uuid,
       posted_by = $3::uuid,
       posted_at = NOW(),
       updated_by = $3::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [charge.id, journalId, params.userId, costCenterId]
  );
  return { charge: posted.rows[0], created: true };
}

export async function voidStudentCharge(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason?: unknown;
  }
): Promise<StudentChargeRow> {
  const charge = await loadStudentCharge(client, params.id, true);
  assertOptimistic(charge, params.version, params.updated_at);

  if (charge.status === 'VOID') {
    return charge;
  }

  if (
    charge.status === 'PARTIALLY_SETTLED' ||
    charge.status === 'SETTLED'
  ) {
    throw new AccountsHttpError(
      'لا يمكن إلغاء مطالبة مسددة جزئياً أو كلياً في هذه المرحلة',
      409
    );
  }

  if (charge.status === 'DRAFT' || charge.status === 'POSTED') {
    const activeAlloc = await txQuery(
      client,
      `SELECT 1
       FROM accounts.student_collection_allocations sca
       JOIN accounts.student_collections sc ON sc.id = sca.collection_id
       WHERE sca.student_charge_id = $1::uuid
         AND sc.status IN ('DRAFT', 'POSTED')
       LIMIT 1`,
      [charge.id]
    );
    if (activeAlloc.rows[0]) {
      throw new AccountsHttpError(
        'لا يمكن إلغاء مطالبة لوجود تخصيصات تحصيل نشطة عليها',
        409
      );
    }
  }

  const accountPeek = await loadStudentAccount(
    client,
    charge.student_account_id,
    false
  );
  const feeTypePeek = await loadStudentFeeType(client, charge.fee_type_id, false);

  await acquireAccountingResourceLocks(client, [
    studentChargeLock(charge.id),
    studentAccountLock(charge.student_account_id),
    studentLedgerLock(charge.student_account_id),
    chartAccountLock(accountPeek.receivable_gl_account_id),
    chartAccountLock(feeTypePeek.revenue_gl_account_id),
    journalSourceLock('STUDENT_CHARGE', charge.id),
    journalSourceLock('STUDENT_CHARGE_REVERSAL', charge.id),
  ]);

  const account = await loadStudentAccount(
    client,
    charge.student_account_id,
    true
  );
  if (account.status === 'CLOSED') {
    throw new AccountsHttpError(
      'لا يمكن إلغاء مطالبة مرتبطة بحساب مالي مغلق',
      409
    );
  }

  if (charge.status === 'DRAFT') {
    const upd = await txQuery<StudentChargeRow>(
      client,
      `UPDATE accounts.student_charges SET
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
        charge.id,
        optText(params.reason, 2000) ?? 'إلغاء مسودة',
        params.userId,
      ]
    );
    return upd.rows[0];
  }

  if (charge.status !== 'POSTED' || !charge.journal_entry_id) {
    throw new AccountsHttpError('حالة المطالبة لا تسمح بالإلغاء', 409);
  }

  const reason = String(params.reason ?? '').trim();
  if (!reason) {
    throw new AccountsHttpError('سبب الإلغاء مطلوب للمطالبات المرحّلة', 400);
  }

  const original = await loadJournalEntry(client, charge.journal_entry_id);
  const reversalDate = pgDateOnly(charge.charge_date);
  const reversal = await createReversalEntry(client, {
    original,
    reversalDate,
    reason: `إلغاء مطالبة ${charge.charge_number}: ${reason}`,
    userId: params.userId,
  });

  await txQuery(
    client,
    `UPDATE accounts.journal_entries
     SET source_type = 'STUDENT_CHARGE_REVERSAL',
         source_id = $2::uuid,
         status = 'POSTED',
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1::uuid`,
    [reversal.id, charge.id]
  );

  // الأصل يبقى POSTED مع ربط العكس — أثر صافٍ صفر على GL
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

  const amount = normalizeMoneyInput(charge.original_amount);
  await insertLedgerCharge(client, {
    account,
    charge,
    entryType: 'CHARGE_REVERSAL',
    debit: '0',
    credit: amount,
    journalEntryId: reversal.id,
    userId: params.userId,
    description: `عكس مطالبة ${charge.charge_number}: ${reason}`,
  });

  const upd = await txQuery<StudentChargeRow>(
    client,
    `UPDATE accounts.student_charges SET
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
    [charge.id, reversal.id, reason.slice(0, 2000), params.userId]
  );
  return upd.rows[0];
}

export async function getStudentLedger(
  client: TxClient,
  params: {
    studentAccountId: string;
    page?: number;
    page_size?: number;
    date_from?: string | null;
    date_to?: string | null;
  }
): Promise<{
  rows: StudentLedgerEntryRow[];
  total: number;
  page: number;
  page_size: number;
  balance: string;
}> {
  await loadStudentAccount(client, params.studentAccountId);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.page_size ?? 50));
  const offset = (page - 1) * pageSize;
  const dateFrom = params.date_from || null;
  const dateTo = params.date_to || null;

  const count = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total
     FROM accounts.student_ledger_entries
     WHERE student_account_id = $1::uuid
       AND ($2::date IS NULL OR entry_date >= $2::date)
       AND ($3::date IS NULL OR entry_date <= $3::date)`,
    [params.studentAccountId, dateFrom, dateTo]
  );

  const list = await txQuery<StudentLedgerEntryRow>(
    client,
    `SELECT le.*,
            sc.charge_number
     FROM accounts.student_ledger_entries le
     LEFT JOIN accounts.student_charges sc
       ON sc.id = le.source_id AND le.source_type = 'STUDENT_CHARGE'
     WHERE le.student_account_id = $1::uuid
       AND ($2::date IS NULL OR le.entry_date >= $2::date)
       AND ($3::date IS NULL OR le.entry_date <= $3::date)
     ORDER BY le.entry_date ASC, le.created_at ASC
     LIMIT $4 OFFSET $5`,
    [params.studentAccountId, dateFrom, dateTo, pageSize, offset]
  );

  const balance = await getStudentAccountBalance(client, params.studentAccountId);

  return {
    rows: list.rows,
    total: count.rows[0]?.total ?? 0,
    page,
    page_size: pageSize,
    balance,
  };
}

export async function getStudentAccountSummary(
  client: TxClient,
  studentAccountId: string
): Promise<{
  account_id: string;
  balance: string;
  charges_total: string;
  counts: {
    draft: number;
    posted: number;
    void: number;
    partially_settled: number;
    settled: number;
  };
  amounts: {
    draft: string;
    posted: string;
    void: string;
  };
}> {
  await loadStudentAccount(client, studentAccountId);
  const balance = await getStudentAccountBalance(client, studentAccountId);

  const agg = await txQuery<{
    draft_count: number;
    posted_count: number;
    void_count: number;
    partial_count: number;
    settled_count: number;
    draft_amount: string;
    posted_amount: string;
    void_amount: string;
    charges_total: string;
  }>(
    client,
    `SELECT
       COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft_count,
       COUNT(*) FILTER (WHERE status = 'POSTED')::int AS posted_count,
       COUNT(*) FILTER (WHERE status = 'VOID')::int AS void_count,
       COUNT(*) FILTER (WHERE status = 'PARTIALLY_SETTLED')::int AS partial_count,
       COUNT(*) FILTER (WHERE status = 'SETTLED')::int AS settled_count,
       COALESCE(SUM(original_amount) FILTER (WHERE status = 'DRAFT'), 0)::text AS draft_amount,
       COALESCE(SUM(original_amount) FILTER (WHERE status = 'POSTED'), 0)::text AS posted_amount,
       COALESCE(SUM(original_amount) FILTER (WHERE status = 'VOID'), 0)::text AS void_amount,
       COALESCE(SUM(original_amount) FILTER (
         WHERE status IN ('POSTED', 'PARTIALLY_SETTLED', 'SETTLED')
       ), 0)::text AS charges_total
     FROM accounts.student_charges
     WHERE student_account_id = $1::uuid`,
    [studentAccountId]
  );

  const row = agg.rows[0];
  return {
    account_id: studentAccountId,
    balance,
    charges_total: normalizeMoneyInput(row?.charges_total ?? '0'),
    counts: {
      draft: row?.draft_count ?? 0,
      posted: row?.posted_count ?? 0,
      void: row?.void_count ?? 0,
      partially_settled: row?.partial_count ?? 0,
      settled: row?.settled_count ?? 0,
    },
    amounts: {
      draft: normalizeMoneyInput(row?.draft_amount ?? '0'),
      posted: normalizeMoneyInput(row?.posted_amount ?? '0'),
      void: normalizeMoneyInput(row?.void_amount ?? '0'),
    },
  };
}

export async function listStudentCharges(
  client: TxClient,
  filters: {
    q?: string;
    status?: string | null;
    student_account_id?: string | null;
    student_id?: string | null;
    fee_type_id?: string | null;
    page?: number;
    page_size?: number;
  }
): Promise<{
  rows: Array<
    StudentChargeRow & {
      fee_type_code?: string | null;
      fee_type_name_ar?: string | null;
      account_number?: string | null;
      student_full_name_ar?: string | null;
    }
  >;
  total: number;
  page: number;
  page_size: number;
}> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.page_size ?? 20));
  const offset = (page - 1) * pageSize;
  const q = (filters.q ?? '').trim();

  const where = `
    WHERE ($1 = '' OR sc.charge_number ILIKE '%'||$1||'%'
           OR sc.description ILIKE '%'||$1||'%'
           OR COALESCE(sc.external_reference,'') ILIKE '%'||$1||'%')
      AND ($2::text IS NULL OR sc.status = $2)
      AND ($3::uuid IS NULL OR sc.student_account_id = $3::uuid)
      AND ($4::uuid IS NULL OR sc.student_id = $4::uuid)
      AND ($5::uuid IS NULL OR sc.fee_type_id = $5::uuid)
  `;
  const params = [
    q,
    filters.status || null,
    filters.student_account_id || null,
    filters.student_id || null,
    filters.fee_type_id || null,
  ];

  const count = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total
     FROM accounts.student_charges sc
     ${where}`,
    params
  );

  const list = await txQuery(
    client,
    `SELECT sc.*,
            ft.code AS fee_type_code,
            ft.name_ar AS fee_type_name_ar,
            sa.account_number,
            COALESCE(s.full_name_ar, s.full_name) AS student_full_name_ar
     FROM accounts.student_charges sc
     JOIN accounts.student_fee_types ft ON ft.id = sc.fee_type_id
     JOIN accounts.student_accounts sa ON sa.id = sc.student_account_id
     JOIN student_affairs.students s ON s.id = sc.student_id
     ${where}
     ORDER BY sc.charge_date DESC, sc.created_at DESC
     LIMIT $6 OFFSET $7`,
    [...params, pageSize, offset]
  );

  return {
    rows: list.rows as Array<
      StudentChargeRow & {
        fee_type_code?: string | null;
        fee_type_name_ar?: string | null;
        account_number?: string | null;
        student_full_name_ar?: string | null;
      }
    >,
    total: count.rows[0]?.total ?? 0,
    page,
    page_size: pageSize,
  };
}
