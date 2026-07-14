/**
 * تحصيلات الطلبة والتخصيصات — المرحلة 5.B
 */
import {
  acquireAccountingResourceLocks,
  bankAccountLock,
  cashboxLock,
  cashSessionLock,
  chartAccountLock,
  journalSourceLock,
  studentAccountLock,
  studentBillingPlanLock,
  studentChargeLock,
  studentCollectionLock,
  studentInstallmentLock,
  studentLedgerLock,
} from './accounting-locks';
import { AccountsHttpError } from './auth';
import {
  createBankVoucher,
  loadBankVoucher,
  postBankVoucher,
  voidBankVoucher,
} from './bank-vouchers';
import { assertCashSessionOptimisticConcurrency } from './cash-session-concurrency';
import {
  createCashVoucher,
  loadCashVoucher,
  postCashVoucher,
  voidCashVoucher,
} from './cash-vouchers';
import { normalizeCurrencyCode } from './currency';
import {
  nextDocumentNumber,
  pgDateOnly,
  yearLabelFromDate,
} from './document-sequences';
import { assertFiscalContextForEntry } from './journal-entries';
import {
  moneyEquals,
  moneyIsPositive,
  moneyIsZero,
  moneyToMillis,
  moneyToMillisSigned,
  millisToMoney,
  normalizeMoneyInput,
  sumMoney,
} from './money';
import { deriveInstallmentStatus } from './student-installment-status';
import {
  loadStudentInstallment,
  refreshBillingPlanCompletion,
} from './student-billing-plans';
import {
  applyChargeAllocation,
  getStudentAccountReceivableBalance,
  loadStudentCharge,
  reverseChargeAllocation,
  writeStudentLedgerEntry,
} from './student-charges';
import { loadStudentAccount } from './student-accounts';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type StudentCollectionStatus = 'DRAFT' | 'POSTED' | 'VOID';
export type StudentCollectionPaymentMethod = 'CASH' | 'BANK';

export type StudentCollectionRow = {
  id: string;
  collection_number: string;
  student_account_id: string;
  student_id: string;
  collection_date: string | Date;
  amount: string;
  currency_code: string;
  payment_method: StudentCollectionPaymentMethod;
  cash_box_id: string | null;
  cash_box_session_id: string | null;
  bank_account_id: string | null;
  cash_voucher_id: string | null;
  bank_voucher_id: string | null;
  external_reference: string | null;
  payer_name: string | null;
  description: string;
  status: StudentCollectionStatus;
  fiscal_year_id: string | null;
  fiscal_period_id: string | null;
  posted_at: Date | string | null;
  posted_by: string | null;
  voided_at: Date | string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  version: number;
};

export type StudentCollectionAllocationRow = {
  id: string;
  collection_id: string;
  student_installment_id: string | null;
  student_charge_id: string;
  allocated_amount: string;
  created_by: string;
  created_at: Date | string;
};

export type AllocationDraftInput = {
  student_charge_id: string;
  student_installment_id?: string | null;
  allocated_amount: string;
};

export type AutoAllocationPreviewRow = {
  student_charge_id: string;
  student_installment_id: string | null;
  charge_number: string | null;
  installment_number: number | null;
  due_date: string | null;
  charge_outstanding: string;
  allocated_amount: string;
};

const OVERPAYMENT_MSG =
  'لا يمكن تسجيل مبلغ تحصيل أكبر من الرصيد المستحق على الطالب.';

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
  if (!s) throw new AccountsHttpError('بيان التحصيل مطلوب', 400);
  return s.slice(0, 4000);
}

function assertIqdOnly(value: unknown): string {
  const code = normalizeCurrencyCode(value, 'IQD');
  if (code !== 'IQD') {
    throw new AccountsHttpError('عملة التحصيل في المرحلة الحالية IQD فقط', 400);
  }
  return code;
}

function assertOptimistic(
  row: { version: number; updated_at: Date | string },
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

export function serializeStudentCollection(row: StudentCollectionRow) {
  return {
    ...row,
    amount: normalizeMoneyInput(row.amount),
    collection_date: pgDateOnly(row.collection_date),
    posted_at: iso(row.posted_at),
    voided_at: iso(row.voided_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export function serializeStudentCollectionAllocation(
  row: StudentCollectionAllocationRow
) {
  return {
    ...row,
    allocated_amount: normalizeMoneyInput(row.allocated_amount),
    created_at: iso(row.created_at)!,
  };
}

async function assertCollectionAmountWithinBalance(
  client: TxClient,
  studentAccountId: string,
  amount: string
): Promise<void> {
  const balance = await getStudentAccountReceivableBalance(
    client,
    studentAccountId
  );
  if (
    moneyToMillisSigned(amount) > moneyToMillisSigned(balance) ||
    moneyToMillisSigned(balance) <= BigInt(0)
  ) {
    throw new AccountsHttpError(OVERPAYMENT_MSG, 409);
  }
}

export async function allocateStudentCollectionNumber(
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
     SELECT 'STUDENT_COLLECTION', $1::uuid, 'SCL', 0, 6, TRUE, TRUE
     WHERE NOT EXISTS (
       SELECT 1 FROM accounts.document_sequences
       WHERE document_type = 'STUDENT_COLLECTION' AND fiscal_year_id = $1::uuid
     )`,
    [fiscalYearId]
  );
  try {
    const seq = await nextDocumentNumber(client, {
      documentType: 'STUDENT_COLLECTION',
      fiscalYearId,
      yearLabel: yearLabelFromDate(year.rows[0].start_date),
    });
    return seq.formatted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'تعذر تخصيص رقم التحصيل';
    throw new AccountsHttpError(msg, 409);
  }
}

async function resolveOpenFiscalForDate(
  client: TxClient,
  refDate: string
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
    [refDate]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError(
      'لا توجد فترة مالية مفتوحة تغطي تاريخ التحصيل',
      409
    );
  }
  return {
    fiscalYearId: r.rows[0].year_id,
    fiscalPeriodId: r.rows[0].period_id,
  };
}

function normalizeAllocationDrafts(
  drafts: AllocationDraftInput[],
  collectionAmount: string
): AllocationDraftInput[] {
  if (!drafts.length) {
    throw new AccountsHttpError('يجب تحديد تخصيص واحد على الأقل', 400);
  }
  const chargeIds = new Set<string>();
  const normalized: AllocationDraftInput[] = [];
  for (const d of drafts) {
    const chargeId = String(d.student_charge_id ?? '').trim();
    if (!chargeId) {
      throw new AccountsHttpError('معرّف المطالبة مطلوب في التخصيص', 400);
    }
    if (chargeIds.has(chargeId)) {
      throw new AccountsHttpError('تخصيص مكرر لنفس المطالبة', 400);
    }
    chargeIds.add(chargeId);
    let allocated: string;
    try {
      allocated = normalizeMoneyInput(d.allocated_amount);
    } catch {
      throw new AccountsHttpError('مبلغ التخصيص غير صالح', 400);
    }
    if (!moneyIsPositive(allocated)) {
      throw new AccountsHttpError('مبلغ التخصيص يجب أن يكون أكبر من صفر', 400);
    }
    normalized.push({
      student_charge_id: chargeId,
      student_installment_id:
        d.student_installment_id != null && d.student_installment_id !== ''
          ? String(d.student_installment_id).trim()
          : null,
      allocated_amount: allocated,
    });
  }
  const sum = sumMoney(normalized.map((a) => a.allocated_amount));
  if (!moneyEquals(sum, collectionAmount)) {
    throw new AccountsHttpError(
      'مجموع التخصيصات يجب أن يساوي مبلغ التحصيل',
      400
    );
  }
  return normalized;
}

async function assertAllocationsAgainstCharges(
  client: TxClient,
  studentAccountId: string,
  drafts: AllocationDraftInput[]
): Promise<void> {
  for (const d of drafts) {
    const charge = await loadStudentCharge(client, d.student_charge_id, false);
    if (charge.student_account_id !== studentAccountId) {
      throw new AccountsHttpError(
        'المطالبة المخصصة لا تنتمي لحساب الطالب',
        409
      );
    }
    if (
      charge.status !== 'POSTED' &&
      charge.status !== 'PARTIALLY_SETTLED' &&
      charge.status !== 'SETTLED'
    ) {
      throw new AccountsHttpError(
        'لا يمكن تخصيص تحصيل على مطالبة غير مرحّلة',
        409
      );
    }
    const outstanding = normalizeMoneyInput(charge.outstanding_amount);
    if (
      charge.status === 'SETTLED' &&
      moneyIsZero(outstanding)
    ) {
      throw new AccountsHttpError(
        'لا يمكن تخصيص تحصيل على مطالبة مسددة بالكامل',
        409
      );
    }
    if (
      moneyToMillis(d.allocated_amount) > moneyToMillis(outstanding)
    ) {
      throw new AccountsHttpError(
        `مبلغ التخصيص يتجاوز الرصيد المتبقي للمطالبة ${charge.charge_number}`,
        409
      );
    }
    if (d.student_installment_id) {
      const inst = await loadStudentInstallment(
        client,
        d.student_installment_id,
        false
      );
      if (inst.status === 'CANCELLED') {
        throw new AccountsHttpError(
          'لا يمكن تخصيص تحصيل على قسط ملغى',
          409
        );
      }
      if (inst.student_charge_id !== charge.id) {
        throw new AccountsHttpError(
          'القسط لا يرتبط بالمطالبة المحددة',
          409
        );
      }
      const instOutstanding = normalizeMoneyInput(inst.outstanding_amount);
      if (moneyToMillis(d.allocated_amount) > moneyToMillis(instOutstanding)) {
        throw new AccountsHttpError(
          'مبلغ التخصيص يتجاوز الرصيد المتبقي للقسط',
          409
        );
      }
    }
  }
}

async function insertAllocations(
  client: TxClient,
  collectionId: string,
  drafts: AllocationDraftInput[],
  userId: string
): Promise<StudentCollectionAllocationRow[]> {
  const rows: StudentCollectionAllocationRow[] = [];
  for (const d of drafts) {
    const ins = await txQuery<StudentCollectionAllocationRow>(
      client,
      `INSERT INTO accounts.student_collection_allocations (
         collection_id, student_installment_id, student_charge_id,
         allocated_amount, created_by
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::uuid)
       RETURNING *`,
      [
        collectionId,
        d.student_installment_id,
        d.student_charge_id,
        d.allocated_amount,
        userId,
      ]
    );
    rows.push(ins.rows[0]);
  }
  return rows;
}

export async function loadStudentCollection(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<StudentCollectionRow> {
  const r = await txQuery<StudentCollectionRow>(
    client,
    `SELECT * FROM accounts.student_collections WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('التحصيل غير موجود', 404);
  }
  return r.rows[0];
}

export async function listCollectionAllocations(
  client: TxClient,
  collectionId: string
): Promise<StudentCollectionAllocationRow[]> {
  const r = await txQuery<StudentCollectionAllocationRow>(
    client,
    `SELECT * FROM accounts.student_collection_allocations
     WHERE collection_id = $1::uuid
     ORDER BY created_at ASC`,
    [collectionId]
  );
  return r.rows;
}

type OpenAllocationTarget = {
  student_charge_id: string;
  student_installment_id: string | null;
  charge_number: string;
  installment_number: number | null;
  due_date: string | null;
  charge_date: string;
  outstanding_amount: string;
};

async function loadOpenAllocationTargets(
  client: TxClient,
  studentAccountId: string
): Promise<OpenAllocationTarget[]> {
  const r = await txQuery<OpenAllocationTarget>(
    client,
    `SELECT
       sc.id AS student_charge_id,
       si.id AS student_installment_id,
       sc.charge_number,
       si.installment_number,
       COALESCE(sc.due_date, si.due_date)::text AS due_date,
       sc.charge_date::text AS charge_date,
       sc.outstanding_amount
     FROM accounts.student_charges sc
     LEFT JOIN accounts.student_installments si
       ON si.student_charge_id = sc.id
     WHERE sc.student_account_id = $1::uuid
       AND sc.status IN ('POSTED', 'PARTIALLY_SETTLED')
       AND sc.outstanding_amount > 0
     ORDER BY
       COALESCE(sc.due_date, si.due_date, sc.charge_date) ASC NULLS LAST,
       si.installment_number ASC NULLS LAST,
       sc.charge_date ASC,
       sc.created_at ASC`,
    [studentAccountId]
  );
  return r.rows;
}

export async function previewAutoAllocation(
  client: TxClient,
  studentAccountId: string,
  amount: unknown
): Promise<AutoAllocationPreviewRow[]> {
  await loadStudentAccount(client, studentAccountId);
  let collectionAmount: string;
  try {
    collectionAmount = normalizeMoneyInput(amount);
  } catch {
    throw new AccountsHttpError('مبلغ التحصيل غير صالح', 400);
  }
  if (!moneyIsPositive(collectionAmount)) {
    throw new AccountsHttpError('مبلغ التحصيل يجب أن يكون أكبر من صفر', 400);
  }

  const balance = await getStudentAccountReceivableBalance(
    client,
    studentAccountId
  );
  if (
    moneyToMillisSigned(collectionAmount) > moneyToMillisSigned(balance) ||
    moneyToMillisSigned(balance) <= BigInt(0)
  ) {
    throw new AccountsHttpError(OVERPAYMENT_MSG, 409);
  }

  const targets = await loadOpenAllocationTargets(client, studentAccountId);
  let remaining = moneyToMillis(collectionAmount);
  const preview: AutoAllocationPreviewRow[] = [];

  for (const t of targets) {
    if (remaining <= BigInt(0)) break;
    const outstanding = moneyToMillis(normalizeMoneyInput(t.outstanding_amount));
    if (outstanding <= BigInt(0)) continue;
    const allocMillis = remaining < outstanding ? remaining : outstanding;
    if (allocMillis <= BigInt(0)) continue;
    preview.push({
      student_charge_id: t.student_charge_id,
      student_installment_id: t.student_installment_id,
      charge_number: t.charge_number,
      installment_number: t.installment_number,
      due_date: t.due_date ? pgDateOnly(t.due_date) : null,
      charge_outstanding: normalizeMoneyInput(t.outstanding_amount),
      allocated_amount: millisToMoney(allocMillis),
    });
    remaining -= allocMillis;
  }

  if (remaining > BigInt(0)) {
    throw new AccountsHttpError(OVERPAYMENT_MSG, 409);
  }

  return preview;
}

export async function createStudentCollection(
  client: TxClient,
  input: {
    student_account_id: unknown;
    collection_date?: unknown;
    amount: unknown;
    payment_method: unknown;
    cash_box_id?: unknown;
    cash_box_session_id?: unknown;
    bank_account_id?: unknown;
    payer_name?: unknown;
    external_reference?: unknown;
    description?: unknown;
    currency_code?: unknown;
    allocations?: AllocationDraftInput[];
    auto_allocate?: boolean;
    created_by: string;
  }
): Promise<{
  collection: StudentCollectionRow;
  allocations: StudentCollectionAllocationRow[];
}> {
  const accountId = String(input.student_account_id ?? '').trim();
  if (!accountId) throw new AccountsHttpError('الحساب المالي للطالب مطلوب', 400);

  const account = await loadStudentAccount(client, accountId, true);
  if (account.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن إنشاء تحصيل على حساب مغلق', 409);
  }
  const currency = assertIqdOnly(input.currency_code ?? account.currency_code);
  if (currency !== account.currency_code) {
    throw new AccountsHttpError('عملة التحصيل لا تطابق حساب الطالب', 409);
  }

  let amount: string;
  try {
    amount = normalizeMoneyInput(input.amount);
  } catch {
    throw new AccountsHttpError('مبلغ التحصيل غير صالح', 400);
  }
  if (!moneyIsPositive(amount)) {
    throw new AccountsHttpError('مبلغ التحصيل يجب أن يكون أكبر من صفر', 400);
  }

  await assertCollectionAmountWithinBalance(client, account.id, amount);

  const paymentMethod = String(input.payment_method ?? '').toUpperCase();
  if (paymentMethod !== 'CASH' && paymentMethod !== 'BANK') {
    throw new AccountsHttpError('طريقة الدفع غير صالحة', 400);
  }

  const collectionDate =
    input.collection_date != null && input.collection_date !== ''
      ? pgDateOnly(String(input.collection_date))
      : pgDateOnly(new Date());

  const fiscal = await resolveOpenFiscalForDate(client, collectionDate);
  await assertFiscalContextForEntry(client, {
    fiscalYearId: fiscal.fiscalYearId,
    fiscalPeriodId: fiscal.fiscalPeriodId,
    entryDate: collectionDate,
  });

  let cashBoxId: string | null = null;
  let cashSessionId: string | null = null;
  let bankAccountId: string | null = null;

  if (paymentMethod === 'CASH') {
    cashBoxId = String(input.cash_box_id ?? '').trim() || null;
    cashSessionId = String(input.cash_box_session_id ?? '').trim() || null;
    if (!cashBoxId || !cashSessionId) {
      throw new AccountsHttpError('الصندوق والجلسة مطلوبان للتحصيل النقدي', 400);
    }
  } else {
    bankAccountId = String(input.bank_account_id ?? '').trim() || null;
    if (!bankAccountId) {
      throw new AccountsHttpError('الحساب المصرفي مطلوب للتحصيل المصرفي', 400);
    }
  }

  const collectionNumber = await allocateStudentCollectionNumber(
    client,
    fiscal.fiscalYearId
  );

  const ins = await txQuery<StudentCollectionRow>(
    client,
    `INSERT INTO accounts.student_collections (
       collection_number, student_account_id, student_id,
       collection_date, amount, currency_code, payment_method,
       cash_box_id, cash_box_session_id, bank_account_id,
       external_reference, payer_name, description,
       status, created_by, updated_by
     ) VALUES (
       $1, $2::uuid, $3::uuid,
       $4::date, $5::numeric, $6, $7,
       $8::uuid, $9::uuid, $10::uuid,
       $11, $12, $13,
       'DRAFT', $14::uuid, $14::uuid
     ) RETURNING *`,
    [
      collectionNumber,
      account.id,
      account.student_id,
      collectionDate,
      amount,
      currency,
      paymentMethod,
      cashBoxId,
      cashSessionId,
      bankAccountId,
      optText(input.external_reference, 100),
      optText(input.payer_name, 200),
      requireDescription(input.description ?? `تحصيل من طالب — ${account.account_number}`),
      input.created_by,
    ]
  );

  const collection = ins.rows[0];
  let allocationDrafts: AllocationDraftInput[];

  if (input.auto_allocate) {
    const preview = await previewAutoAllocation(client, account.id, amount);
    allocationDrafts = preview.map((p) => ({
      student_charge_id: p.student_charge_id,
      student_installment_id: p.student_installment_id,
      allocated_amount: p.allocated_amount,
    }));
  } else if (input.allocations?.length) {
    allocationDrafts = normalizeAllocationDrafts(input.allocations, amount);
    await assertAllocationsAgainstCharges(client, account.id, allocationDrafts);
  } else {
    allocationDrafts = [];
  }

  const allocations =
    allocationDrafts.length > 0
      ? await insertAllocations(
          client,
          collection.id,
          allocationDrafts,
          input.created_by
        )
      : [];

  return { collection, allocations };
}

export async function replaceAllocations(
  client: TxClient,
  params: {
    collectionId: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    allocations: AllocationDraftInput[];
  }
): Promise<StudentCollectionAllocationRow[]> {
  const collection = await loadStudentCollection(client, params.collectionId, true);
  assertOptimistic(collection, params.version, params.updated_at);
  if (collection.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن تعديل تخصيصات المسودات فقط', 409);
  }

  const amount = normalizeMoneyInput(collection.amount);
  const drafts = normalizeAllocationDrafts(params.allocations, amount);
  await assertAllocationsAgainstCharges(
    client,
    collection.student_account_id,
    drafts
  );

  await txQuery(
    client,
    `DELETE FROM accounts.student_collection_allocations
     WHERE collection_id = $1::uuid`,
    [collection.id]
  );

  await txQuery(
    client,
    `UPDATE accounts.student_collections SET
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid`,
    [collection.id, params.userId]
  );

  return insertAllocations(client, collection.id, drafts, params.userId);
}

export async function updateStudentCollection(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    collection_date?: unknown;
    amount?: unknown;
    payer_name?: unknown;
    external_reference?: unknown;
    description?: unknown;
  }
): Promise<StudentCollectionRow> {
  const collection = await loadStudentCollection(client, params.id, true);
  assertOptimistic(collection, params.version, params.updated_at);
  if (collection.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن تعديل مسودات التحصيل فقط', 409);
  }

  let collectionDate = pgDateOnly(collection.collection_date);
  if (params.collection_date !== undefined && params.collection_date !== '') {
    collectionDate = pgDateOnly(String(params.collection_date));
  }

  let amount = normalizeMoneyInput(collection.amount);
  if (params.amount !== undefined && params.amount !== '') {
    try {
      amount = normalizeMoneyInput(params.amount);
    } catch {
      throw new AccountsHttpError('مبلغ التحصيل غير صالح', 400);
    }
    if (!moneyIsPositive(amount)) {
      throw new AccountsHttpError('مبلغ التحصيل يجب أن يكون أكبر من صفر', 400);
    }
    await assertCollectionAmountWithinBalance(
      client,
      collection.student_account_id,
      amount
    );
  }

  const existingAllocations = await listCollectionAllocations(client, collection.id);
  if (existingAllocations.length > 0) {
    const sum = sumMoney(
      existingAllocations.map((a) => normalizeMoneyInput(a.allocated_amount))
    );
    if (!moneyEquals(sum, amount)) {
      throw new AccountsHttpError(
        'عند تغيير المبلغ يجب إعادة تحديد التخصيصات',
        409
      );
    }
  }

  const upd = await txQuery<StudentCollectionRow>(
    client,
    `UPDATE accounts.student_collections SET
       collection_date = $2::date,
       amount = $3::numeric,
       payer_name = $4,
       external_reference = $5,
       description = $6,
       updated_by = $7::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      collection.id,
      collectionDate,
      amount,
      params.payer_name !== undefined
        ? optText(params.payer_name, 200)
        : collection.payer_name,
      params.external_reference !== undefined
        ? optText(params.external_reference, 100)
        : collection.external_reference,
      params.description !== undefined
        ? requireDescription(params.description)
        : collection.description,
      params.userId,
    ]
  );
  return upd.rows[0];
}

async function applyInstallmentAllocation(
  client: TxClient,
  installmentId: string,
  allocatedAmount: string,
  asOfDate: string
): Promise<void> {
  const inst = await loadStudentInstallment(client, installmentId, true);
  const paid = millisToMoney(
    moneyToMillis(normalizeMoneyInput(inst.paid_amount)) +
      moneyToMillis(allocatedAmount)
  );
  const relief = normalizeMoneyInput(
    (inst as { relief_amount?: string }).relief_amount ?? '0'
  );
  const creditNote = normalizeMoneyInput(
    (inst as { credit_note_amount?: string }).credit_note_amount ?? '0'
  );
  const outstanding = millisToMoney(
    moneyToMillis(normalizeMoneyInput(inst.amount)) -
      moneyToMillis(paid) -
      moneyToMillis(relief) -
      moneyToMillis(creditNote)
  );
  if (moneyToMillis(outstanding) < BigInt(0)) {
    throw new AccountsHttpError('مبلغ التخصيص يتجاوز رصيد القسط', 409);
  }
  const status = deriveInstallmentStatus(
    paid,
    inst.amount,
    pgDateOnly(inst.due_date),
    asOfDate,
    outstanding
  );
  await txQuery(
    client,
    `UPDATE accounts.student_installments SET
       paid_amount = $2::numeric,
       outstanding_amount = $3::numeric,
       status = $4,
       updated_at = NOW()
     WHERE id = $1::uuid`,
    [inst.id, paid, outstanding, status]
  );
  await refreshBillingPlanCompletion(client, inst.billing_plan_id);
}

async function reverseInstallmentAllocation(
  client: TxClient,
  installmentId: string,
  allocatedAmount: string,
  asOfDate: string
): Promise<void> {
  const inst = await loadStudentInstallment(client, installmentId, true);
  const paidMillis =
    moneyToMillis(normalizeMoneyInput(inst.paid_amount)) -
    moneyToMillis(allocatedAmount);
  if (paidMillis < BigInt(0)) {
    throw new AccountsHttpError('عكس التخصيص يتجاوز المبلغ المدفوع للقسط', 409);
  }
  const paid = millisToMoney(paidMillis);
  const relief = normalizeMoneyInput(
    (inst as { relief_amount?: string }).relief_amount ?? '0'
  );
  const creditNote = normalizeMoneyInput(
    (inst as { credit_note_amount?: string }).credit_note_amount ?? '0'
  );
  const outstanding = millisToMoney(
    moneyToMillis(normalizeMoneyInput(inst.amount)) -
      paidMillis -
      moneyToMillis(relief) -
      moneyToMillis(creditNote)
  );
  const status = deriveInstallmentStatus(
    paid,
    inst.amount,
    pgDateOnly(inst.due_date),
    asOfDate,
    outstanding
  );
  await txQuery(
    client,
    `UPDATE accounts.student_installments SET
       paid_amount = $2::numeric,
       outstanding_amount = $3::numeric,
       status = $4,
       updated_at = NOW()
     WHERE id = $1::uuid`,
    [inst.id, paid, outstanding, status]
  );
  await refreshBillingPlanCompletion(client, inst.billing_plan_id);
}

async function applyCollectionAllocations(
  client: TxClient,
  collection: StudentCollectionRow,
  allocations: StudentCollectionAllocationRow[]
): Promise<void> {
  const asOfDate = pgDateOnly(collection.collection_date);
  const planIds = new Set<string>();

  for (const a of allocations) {
    await acquireAccountingResourceLocks(client, [
      studentChargeLock(a.student_charge_id),
    ]);
    await applyChargeAllocation(client, {
      chargeId: a.student_charge_id,
      allocatedAmount: a.allocated_amount,
    });
    if (a.student_installment_id) {
      await acquireAccountingResourceLocks(client, [
        studentInstallmentLock(a.student_installment_id),
      ]);
      await applyInstallmentAllocation(
        client,
        a.student_installment_id,
        a.allocated_amount,
        asOfDate
      );
      const inst = await loadStudentInstallment(
        client,
        a.student_installment_id,
        false
      );
      planIds.add(inst.billing_plan_id);
    }
  }

  for (const planId of planIds) {
    await acquireAccountingResourceLocks(client, [
      studentBillingPlanLock(planId),
    ]);
    await refreshBillingPlanCompletion(client, planId);
  }
}

async function reverseCollectionAllocations(
  client: TxClient,
  collection: StudentCollectionRow,
  allocations: StudentCollectionAllocationRow[]
): Promise<void> {
  const asOfDate = pgDateOnly(collection.collection_date);
  const planIds = new Set<string>();

  for (const a of allocations) {
    await acquireAccountingResourceLocks(client, [
      studentChargeLock(a.student_charge_id),
    ]);
    await reverseChargeAllocation(client, {
      chargeId: a.student_charge_id,
      allocatedAmount: a.allocated_amount,
    });
    if (a.student_installment_id) {
      await acquireAccountingResourceLocks(client, [
        studentInstallmentLock(a.student_installment_id),
      ]);
      await reverseInstallmentAllocation(
        client,
        a.student_installment_id,
        a.allocated_amount,
        asOfDate
      );
      const inst = await loadStudentInstallment(
        client,
        a.student_installment_id,
        false
      );
      planIds.add(inst.billing_plan_id);
    }
  }

  for (const planId of planIds) {
    await acquireAccountingResourceLocks(client, [
      studentBillingPlanLock(planId),
    ]);
    await refreshBillingPlanCompletion(client, planId);
  }
}

async function buildPostLocks(
  client: TxClient,
  collection: StudentCollectionRow,
  allocations: StudentCollectionAllocationRow[]
): Promise<void> {
  const account = await loadStudentAccount(
    client,
    collection.student_account_id,
    false
  );
  const locks = [
    studentCollectionLock(collection.id),
    studentAccountLock(collection.student_account_id),
    studentLedgerLock(collection.student_account_id),
    chartAccountLock(account.receivable_gl_account_id),
    journalSourceLock('STUDENT_COLLECTION', collection.id),
    journalSourceLock('STUDENT_COLLECTION_REVERSAL', collection.id),
  ];

  if (collection.payment_method === 'CASH') {
    if (collection.cash_box_id) locks.push(cashboxLock(collection.cash_box_id));
    if (collection.cash_box_session_id) {
      locks.push(cashSessionLock(collection.cash_box_session_id));
    }
  } else if (collection.bank_account_id) {
    locks.push(bankAccountLock(collection.bank_account_id));
  }

  for (const a of allocations) {
    locks.push(studentChargeLock(a.student_charge_id));
    if (a.student_installment_id) {
      locks.push(studentInstallmentLock(a.student_installment_id));
    }
  }

  await acquireAccountingResourceLocks(client, locks);
}

export async function postStudentCollection(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<{
  collection: StudentCollectionRow;
  allocations: StudentCollectionAllocationRow[];
}> {
  const collectionPeek = await loadStudentCollection(client, params.id, false);
  const allocationsPeek = await listCollectionAllocations(client, params.id);
  await buildPostLocks(client, collectionPeek, allocationsPeek);

  const collection = await loadStudentCollection(client, params.id, true);
  assertOptimistic(collection, params.version, params.updated_at);

  if (collection.status === 'POSTED') {
    return {
      collection,
      allocations: allocationsPeek,
    };
  }
  if (collection.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن ترحيل مسودات التحصيل فقط', 409);
  }

  const allocations = await listCollectionAllocations(client, collection.id);
  const amount = normalizeMoneyInput(collection.amount);
  const allocSum = sumMoney(
    allocations.map((a) => normalizeMoneyInput(a.allocated_amount))
  );
  if (!moneyEquals(allocSum, amount)) {
    throw new AccountsHttpError(
      'مجموع التخصيصات يجب أن يساوي مبلغ التحصيل قبل الترحيل',
      409
    );
  }
  if (!allocations.length) {
    throw new AccountsHttpError('يجب تحديد تخصيصات قبل ترحيل التحصيل', 409);
  }

  const balance = await getStudentAccountReceivableBalance(
    client,
    collection.student_account_id
  );
  if (
    moneyToMillisSigned(amount) > moneyToMillisSigned(balance) ||
    moneyToMillisSigned(balance) <= BigInt(0)
  ) {
    throw new AccountsHttpError(OVERPAYMENT_MSG, 409);
  }

  await assertAllocationsAgainstCharges(
    client,
    collection.student_account_id,
    allocations.map((a) => ({
      student_charge_id: a.student_charge_id,
      student_installment_id: a.student_installment_id,
      allocated_amount: a.allocated_amount,
    }))
  );

  const account = await loadStudentAccount(
    client,
    collection.student_account_id,
    true
  );
  const collectionDate = pgDateOnly(collection.collection_date);
  const voucherDesc = collection.description;

  let fiscalYearId: string;
  let fiscalPeriodId: string;
  let journalEntryId: string;
  let cashVoucherId: string | null = null;
  let bankVoucherId: string | null = null;

  if (collection.payment_method === 'CASH') {
    const voucher = await createCashVoucher(client, {
      voucher_type: 'CASH_RECEIPT',
      cash_box_id: collection.cash_box_id,
      cash_box_session_id: collection.cash_box_session_id,
      counter_account_id: account.receivable_gl_account_id,
      voucher_date: collectionDate,
      amount,
      party_name: collection.payer_name,
      party_reference: collection.collection_number,
      external_reference: collection.external_reference,
      description: voucherDesc,
      created_by: params.userId,
    });
    const posted = await postCashVoucher(client, {
      id: voucher.id,
      userId: params.userId,
      version: voucher.version,
      updated_at: voucher.updated_at,
    });
    fiscalYearId = posted.voucher.fiscal_year_id;
    fiscalPeriodId = posted.voucher.fiscal_period_id;
    journalEntryId = posted.voucher.journal_entry_id as string;
    cashVoucherId = posted.voucher.id;
  } else {
    const voucher = await createBankVoucher(client, {
      voucher_type: 'BANK_RECEIPT',
      bank_account_id: collection.bank_account_id,
      counter_account_id: account.receivable_gl_account_id,
      voucher_date: collectionDate,
      amount,
      party_name: collection.payer_name,
      party_reference: collection.collection_number,
      external_reference: collection.external_reference,
      description: voucherDesc,
      currency_code: collection.currency_code,
      created_by: params.userId,
    });
    const posted = await postBankVoucher(client, {
      id: voucher.id,
      userId: params.userId,
      version: voucher.version,
      updated_at: voucher.updated_at,
    });
    fiscalYearId = posted.voucher.fiscal_year_id;
    fiscalPeriodId = posted.voucher.fiscal_period_id;
    journalEntryId = posted.voucher.journal_entry_id as string;
    bankVoucherId = posted.voucher.id;
  }

  await assertFiscalContextForEntry(client, {
    fiscalYearId,
    fiscalPeriodId,
    entryDate: collectionDate,
  });

  await writeStudentLedgerEntry(client, {
    account,
    entryDate: collectionDate,
    entryType: 'COLLECTION',
    sourceType: 'STUDENT_COLLECTION',
    sourceId: collection.id,
    description: `${collection.collection_number} — ${voucherDesc}`,
    debit: '0',
    credit: amount,
    currencyCode: collection.currency_code,
    journalEntryId,
    userId: params.userId,
  });

  await applyCollectionAllocations(client, collection, allocations);

  const postedCollection = await txQuery<StudentCollectionRow>(
    client,
    `UPDATE accounts.student_collections SET
       status = 'POSTED',
       fiscal_year_id = $2::uuid,
       fiscal_period_id = $3::uuid,
       cash_voucher_id = $4::uuid,
       bank_voucher_id = $5::uuid,
       posted_by = $6::uuid,
       posted_at = NOW(),
       updated_by = $6::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      collection.id,
      fiscalYearId,
      fiscalPeriodId,
      cashVoucherId,
      bankVoucherId,
      params.userId,
    ]
  );

  return {
    collection: postedCollection.rows[0],
    allocations,
  };
}

export async function createAndPostStudentCashCollection(
  client: TxClient,
  input: Parameters<typeof createStudentCollection>[1]
): Promise<{
  collection: StudentCollectionRow;
  allocations: StudentCollectionAllocationRow[];
}> {
  const { collection } = await createStudentCollection(client, {
    ...input,
    payment_method: 'CASH',
  });
  const posted = await postStudentCollection(client, {
    id: collection.id,
    userId: input.created_by,
    version: collection.version,
    updated_at: collection.updated_at,
  });
  return posted;
}

export async function createAndPostStudentBankCollection(
  client: TxClient,
  input: Parameters<typeof createStudentCollection>[1]
): Promise<{
  collection: StudentCollectionRow;
  allocations: StudentCollectionAllocationRow[];
}> {
  const { collection } = await createStudentCollection(client, {
    ...input,
    payment_method: 'BANK',
  });
  const posted = await postStudentCollection(client, {
    id: collection.id,
    userId: input.created_by,
    version: collection.version,
    updated_at: collection.updated_at,
  });
  return posted;
}

export async function voidStudentCollection(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason?: unknown;
  }
): Promise<StudentCollectionRow> {
  const collection = await loadStudentCollection(client, params.id, true);
  assertOptimistic(collection, params.version, params.updated_at);

  if (collection.status === 'VOID') return collection;

  if (collection.status === 'DRAFT') {
    const reason = optText(params.reason, 2000) ?? 'إلغاء مسودة تحصيل';
    const voided = await txQuery<StudentCollectionRow>(
      client,
      `UPDATE accounts.student_collections SET
         status = 'VOID',
         void_reason = $2,
         voided_by = $3::uuid,
         voided_at = NOW(),
         updated_by = $3::uuid,
         updated_at = NOW(),
         version = version + 1
       WHERE id = $1::uuid
       RETURNING *`,
      [collection.id, reason, params.userId]
    );
    return voided.rows[0];
  }

  if (collection.status !== 'POSTED') {
    throw new AccountsHttpError('حالة التحصيل لا تسمح بالإلغاء', 409);
  }

  const reason = String(params.reason ?? '').trim();
  if (!reason) {
    throw new AccountsHttpError('سبب الإلغاء مطلوب للتحصيل المرحّل', 400);
  }

  const allocations = await listCollectionAllocations(client, collection.id);
  const account = await loadStudentAccount(
    client,
    collection.student_account_id,
    false
  );

  await acquireAccountingResourceLocks(client, [
    studentCollectionLock(collection.id),
    studentAccountLock(collection.student_account_id),
    studentLedgerLock(collection.student_account_id),
    chartAccountLock(account.receivable_gl_account_id),
    journalSourceLock('STUDENT_COLLECTION', collection.id),
    journalSourceLock('STUDENT_COLLECTION_REVERSAL', collection.id),
    ...allocations.flatMap((a) => {
      const locks = [studentChargeLock(a.student_charge_id)];
      if (a.student_installment_id) {
        locks.push(studentInstallmentLock(a.student_installment_id));
      }
      return locks;
    }),
  ]);

  const amount = normalizeMoneyInput(collection.amount);
  const collectionDate = pgDateOnly(collection.collection_date);
  let journalEntryId: string | null = null;

  if (collection.payment_method === 'CASH' && collection.cash_voucher_id) {
    const voucher = await loadCashVoucher(client, collection.cash_voucher_id, true);
    const voided = await voidCashVoucher(client, {
      id: voucher.id,
      userId: params.userId,
      version: voucher.version,
      updated_at: voucher.updated_at,
      reason,
    });
    journalEntryId = voided.reversal_journal_entry_id ?? voided.journal_entry_id;
  } else if (
    collection.payment_method === 'BANK' &&
    collection.bank_voucher_id
  ) {
    const voucher = await loadBankVoucher(client, collection.bank_voucher_id, true);
    const voided = await voidBankVoucher(client, {
      id: voucher.id,
      userId: params.userId,
      version: voucher.version,
      updated_at: voucher.updated_at,
      reason,
    });
    journalEntryId = voided.reversal_journal_entry_id ?? voided.journal_entry_id;
  } else {
    throw new AccountsHttpError('التحصيل المرحّل بلا سند مرتبط', 409);
  }

  const accountLocked = await loadStudentAccount(
    client,
    collection.student_account_id,
    true
  );

  await writeStudentLedgerEntry(client, {
    account: accountLocked,
    entryDate: collectionDate,
    entryType: 'COLLECTION_REVERSAL',
    sourceType: 'STUDENT_COLLECTION',
    sourceId: collection.id,
    description: `عكس تحصيل ${collection.collection_number}: ${reason}`,
    debit: amount,
    credit: '0',
    currencyCode: collection.currency_code,
    journalEntryId,
    userId: params.userId,
  });

  await reverseCollectionAllocations(client, collection, allocations);

  const voided = await txQuery<StudentCollectionRow>(
    client,
    `UPDATE accounts.student_collections SET
       status = 'VOID',
       void_reason = $2,
       voided_by = $3::uuid,
       voided_at = NOW(),
       updated_by = $3::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [collection.id, reason.slice(0, 2000), params.userId]
  );
  return voided.rows[0];
}

export async function getStudentCollection(
  client: TxClient,
  id: string
): Promise<{
  collection: StudentCollectionRow;
  allocations: StudentCollectionAllocationRow[];
}> {
  const collection = await loadStudentCollection(client, id);
  const allocations = await listCollectionAllocations(client, id);
  return { collection, allocations };
}

export async function listStudentCollections(
  client: TxClient,
  filters: {
    q?: string;
    status?: string | null;
    student_account_id?: string | null;
    student_id?: string | null;
    payment_method?: string | null;
    page?: number;
    page_size?: number;
  }
): Promise<{
  rows: Array<
    StudentCollectionRow & {
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
    WHERE ($1 = '' OR c.collection_number ILIKE '%'||$1||'%'
           OR c.description ILIKE '%'||$1||'%'
           OR COALESCE(c.external_reference,'') ILIKE '%'||$1||'%'
           OR COALESCE(c.payer_name,'') ILIKE '%'||$1||'%')
      AND ($2::text IS NULL OR c.status = $2)
      AND ($3::uuid IS NULL OR c.student_account_id = $3::uuid)
      AND ($4::uuid IS NULL OR c.student_id = $4::uuid)
      AND ($5::text IS NULL OR c.payment_method = $5)
  `;
  const params = [
    q,
    filters.status || null,
    filters.student_account_id || null,
    filters.student_id || null,
    filters.payment_method || null,
  ];

  const count = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total
     FROM accounts.student_collections c
     ${where}`,
    params
  );

  const list = await txQuery(
    client,
    `SELECT c.*,
            sa.account_number,
            COALESCE(s.full_name_ar, s.full_name) AS student_full_name_ar
     FROM accounts.student_collections c
     JOIN accounts.student_accounts sa ON sa.id = c.student_account_id
     JOIN student_affairs.students s ON s.id = c.student_id
     ${where}
     ORDER BY c.collection_date DESC, c.created_at DESC
     LIMIT $6 OFFSET $7`,
    [...params, pageSize, offset]
  );

  return {
    rows: list.rows as Array<
      StudentCollectionRow & {
        account_number?: string | null;
        student_full_name_ar?: string | null;
      }
    >,
    total: count.rows[0]?.total ?? 0,
    page,
    page_size: pageSize,
  };
}
