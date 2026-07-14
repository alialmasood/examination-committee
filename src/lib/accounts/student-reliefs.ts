/**
 * طلبات التخفيض والمنح والإعفاء — 5.C.1
 *
 * قرار محاسبي: عند POST → Dr Relief EXPENSE GL / Cr Student Receivables GL.
 * لا CONTRA_REVENUE — التمييز عبر relief_kind على النوع.
 */
import {
  acquireAccountingResourceLocks,
  chartAccountLock,
  journalSourceLock,
  studentAccountLock,
  studentBillingPlanLock,
  studentChargeLock,
  studentInstallmentLock,
  studentLedgerLock,
  studentReliefLock,
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
  moneyIsPositive,
  moneyIsZero,
  moneyToMillis,
  millisToMoney,
  normalizeMoneyInput,
  sumMoney,
} from './money';
import { assertPostingAccount } from './posting-account';
import { loadStudentAccount, type StudentAccountRow } from './student-accounts';
import {
  applyChargeRelief,
  loadStudentCharge,
  reverseChargeRelief,
  writeStudentLedgerEntry,
  type StudentChargeRow,
} from './student-charges';
import {
  loadStudentReliefType,
  type ReliefCalculationType,
  type StudentReliefTypeRow,
} from './student-relief-types';
import {
  recalculateStudentBillingPlanSettlement,
  recalculateStudentInstallmentSettlement,
} from './student-settlement';
import { assertStudentActiveForCharges } from './students-ref';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type StudentReliefStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'POSTED'
  | 'REJECTED'
  | 'VOID';

export type StudentReliefRow = {
  id: string;
  relief_number: string;
  student_account_id: string;
  student_id: string;
  relief_type_id: string;
  billing_plan_id: string | null;
  student_installment_id: string | null;
  student_charge_id: string;
  fiscal_year_id: string;
  fiscal_period_id: string;
  relief_date: string | Date;
  calculation_type: ReliefCalculationType;
  percentage_value: string | null;
  requested_amount: string;
  approved_amount: string | null;
  currency_code: string;
  reason: string;
  external_reference: string | null;
  status: StudentReliefStatus;
  journal_entry_id: string | null;
  reversal_journal_entry_id: string | null;
  requested_by: string;
  approved_by: string | null;
  approved_at: Date | string | null;
  rejected_by: string | null;
  rejected_at: Date | string | null;
  rejection_reason: string | null;
  posted_by: string | null;
  posted_at: Date | string | null;
  voided_by: string | null;
  voided_at: Date | string | null;
  void_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  version: number;
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

function requireReason(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) throw new AccountsHttpError('سبب التخفيض مطلوب', 400);
  return s.slice(0, 4000);
}

function assertIqdOnly(value: unknown): string {
  const code = normalizeCurrencyCode(value, 'IQD');
  if (code !== 'IQD') {
    throw new AccountsHttpError('عملة التخفيضات في المرحلة الحالية IQD فقط', 400);
  }
  return code;
}

function assertOptimistic(
  row: StudentReliefRow,
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

function assertAccountAllowsRelief(account: StudentAccountRow): void {
  if (account.status === 'CLOSED') {
    throw new AccountsHttpError('لا يمكن إنشاء تخفيض على حساب مغلق', 409);
  }
}

export function serializeStudentRelief(row: StudentReliefRow) {
  return {
    ...row,
    requested_amount: normalizeMoneyInput(row.requested_amount),
    approved_amount:
      row.approved_amount == null
        ? null
        : normalizeMoneyInput(row.approved_amount),
    percentage_value:
      row.percentage_value == null ? null : String(row.percentage_value),
    relief_date: pgDateOnly(row.relief_date),
    approved_at: iso(row.approved_at),
    rejected_at: iso(row.rejected_at),
    posted_at: iso(row.posted_at),
    voided_at: iso(row.voided_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

async function resolveOpenFiscalForDate(
  client: TxClient,
  reliefDate: string
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
    [reliefDate]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError(
      'لا توجد فترة مالية مفتوحة تغطي تاريخ التخفيض',
      409
    );
  }
  return {
    fiscalYearId: r.rows[0].year_id,
    fiscalPeriodId: r.rows[0].period_id,
  };
}

export async function allocateStudentReliefNumber(
  client: TxClient,
  fiscalYearId: string,
  reliefDate: string
): Promise<string> {
  await txQuery(
    client,
    `INSERT INTO accounts.document_sequences
      (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
     SELECT 'STUDENT_RELIEF', $1::uuid, 'SRL', 0, 6, TRUE, TRUE
     WHERE NOT EXISTS (
       SELECT 1 FROM accounts.document_sequences
       WHERE document_type = 'STUDENT_RELIEF' AND fiscal_year_id = $1::uuid
     )`,
    [fiscalYearId]
  );
  try {
    const seq = await nextDocumentNumber(client, {
      documentType: 'STUDENT_RELIEF',
      fiscalYearId,
      yearLabel: yearLabelFromDate(reliefDate),
    });
    return seq.formatted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'تعذر تخصيص رقم التخفيض';
    throw new AccountsHttpError(msg, 409);
  }
}

export async function sumReservedReliefOnCharge(
  client: TxClient,
  chargeId: string,
  excludeReliefId?: string | null
): Promise<string> {
  const r = await txQuery<{ total: string }>(
    client,
    `SELECT COALESCE(SUM(
       CASE
         WHEN status = 'APPROVED' THEN approved_amount
         WHEN status = 'PENDING_APPROVAL' THEN
           COALESCE(approved_amount, requested_amount)
         ELSE 0
       END
     ), 0)::text AS total
     FROM accounts.student_reliefs
     WHERE student_charge_id = $1::uuid
       AND status IN ('APPROVED', 'PENDING_APPROVAL')
       AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [chargeId, excludeReliefId ?? null]
  );
  return normalizeMoneyInput(r.rows[0]?.total ?? '0');
}

export async function calculateReliefEligibleAmount(
  client: TxClient,
  chargeId: string,
  excludeReliefId?: string | null
): Promise<string> {
  const charge = await loadStudentCharge(client, chargeId, false);
  if (charge.status === 'VOID' || charge.status === 'SETTLED') {
    return '0.000';
  }
  if (
    charge.status !== 'POSTED' &&
    charge.status !== 'PARTIALLY_SETTLED'
  ) {
    return '0.000';
  }
  const outstanding = normalizeMoneyInput(charge.outstanding_amount);
  const reserved = await sumReservedReliefOnCharge(
    client,
    chargeId,
    excludeReliefId
  );
  const eligibleMillis =
    moneyToMillis(outstanding) - moneyToMillis(reserved);
  if (eligibleMillis <= BigInt(0)) return '0.000';
  return millisToMoney(eligibleMillis);
}

function calculateRequestedFromType(
  charge: StudentChargeRow,
  reliefType: StudentReliefTypeRow,
  calculationType: ReliefCalculationType,
  input: {
    requested_amount?: unknown;
    percentage_value?: unknown;
  }
): { requested: string; percentage: string | null } {
  const chargeOriginal = normalizeMoneyInput(charge.original_amount);
  let percentage: string | null = null;
  let requested: string;

  if (calculationType === 'PERCENTAGE') {
    const pctRaw = input.percentage_value ?? reliefType.default_value;
    if (pctRaw == null || pctRaw === '') {
      throw new AccountsHttpError('نسبة التخفيض مطلوبة', 400);
    }
    const pctStr = String(pctRaw).trim();
    if (!/^\d+(\.\d{1,4})?$/.test(pctStr)) {
      throw new AccountsHttpError(
        'نسبة التخفيض غير صالحة (حتى 4 منازل عشرية)',
        400
      );
    }
    const [wholePart, fracPart = ''] = pctStr.split('.');
    // مقياس 1e4 لوحدات النسبة → 100% = 1_000_000
    const pctScaled =
      BigInt(wholePart) * BigInt(10000) +
      BigInt((fracPart + '0000').slice(0, 4));
    if (pctScaled <= BigInt(0) || pctScaled > BigInt(1000000)) {
      throw new AccountsHttpError('نسبة التخفيض يجب أن تكون بين 0 و100', 400);
    }
    percentage = pctStr;
    // requested = original * pct / 100 (حساب صحيح بدون float)
    const millis =
      (moneyToMillis(chargeOriginal) * pctScaled) / BigInt(1000000);
    requested = millisToMoney(millis);
  } else {
    const amtRaw = input.requested_amount ?? reliefType.default_value;
    if (amtRaw == null || amtRaw === '') {
      throw new AccountsHttpError('مبلغ التخفيض مطلوب', 400);
    }
    requested = normalizeMoneyInput(amtRaw);
    percentage = null;
  }

  if (!moneyIsPositive(requested)) {
    throw new AccountsHttpError('مبلغ التخفيض يجب أن يكون أكبر من صفر', 400);
  }

  if (reliefType.max_value != null) {
    const max = normalizeMoneyInput(reliefType.max_value);
    if (moneyToMillis(requested) > moneyToMillis(max)) {
      requested = max;
    }
  }

  return { requested, percentage };
}

async function resolveChargeLinks(
  client: TxClient,
  chargeId: string
): Promise<{
  billing_plan_id: string | null;
  student_installment_id: string | null;
}> {
  const r = await txQuery<{
    billing_plan_id: string;
    id: string;
  }>(
    client,
    `SELECT billing_plan_id, id
     FROM accounts.student_installments
     WHERE student_charge_id = $1::uuid
     LIMIT 1`,
    [chargeId]
  );
  if (!r.rows[0]) {
    return { billing_plan_id: null, student_installment_id: null };
  }
  return {
    billing_plan_id: r.rows[0].billing_plan_id,
    student_installment_id: r.rows[0].id,
  };
}

export async function loadStudentRelief(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<StudentReliefRow> {
  const r = await txQuery<StudentReliefRow>(
    client,
    `SELECT * FROM accounts.student_reliefs WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('طلب التخفيض غير موجود', 404);
  return r.rows[0];
}

export async function createStudentRelief(
  client: TxClient,
  input: {
    student_charge_id: unknown;
    relief_type_id: unknown;
    relief_date?: unknown;
    calculation_type?: unknown;
    requested_amount?: unknown;
    percentage_value?: unknown;
    reason: unknown;
    external_reference?: unknown;
    requested_by: string;
  }
): Promise<StudentReliefRow> {
  const chargeId = String(input.student_charge_id ?? '').trim();
  if (!chargeId) throw new AccountsHttpError('المطالبة المالية مطلوبة', 400);

  const charge = await loadStudentCharge(client, chargeId, true);
  if (charge.status === 'VOID' || charge.status === 'SETTLED') {
    throw new AccountsHttpError(
      'لا يمكن إنشاء تخفيض على مطالبة ملغاة أو مسددة بالكامل',
      409
    );
  }
  if (charge.status !== 'POSTED' && charge.status !== 'PARTIALLY_SETTLED') {
    throw new AccountsHttpError(
      'يجب أن تكون المطالبة مرحّلة أو مسددة جزئياً',
      409
    );
  }

  const account = await loadStudentAccount(client, charge.student_account_id, true);
  assertAccountAllowsRelief(account);
  await assertStudentActiveForCharges(client, account.student_id);

  const reliefType = await loadStudentReliefType(
    client,
    String(input.relief_type_id ?? ''),
    true
  );
  if (!reliefType.is_active) {
    throw new AccountsHttpError('نوع التخفيض غير فعّال', 409);
  }

  const calculationType = (input.calculation_type
    ? String(input.calculation_type).trim().toUpperCase()
    : reliefType.calculation_type) as ReliefCalculationType;

  const { requested, percentage } = calculateRequestedFromType(
    charge,
    reliefType,
    calculationType,
    input
  );

  const eligible = await calculateReliefEligibleAmount(client, chargeId);
  if (
    moneyToMillis(requested) > moneyToMillis(eligible) ||
    moneyIsZero(eligible)
  ) {
    throw new AccountsHttpError(
      'مبلغ التخفيض يتجاوز الرصيد المؤهل للمطالبة',
      409
    );
  }

  const reliefDate =
    input.relief_date != null && String(input.relief_date).trim() !== ''
      ? pgDateOnly(String(input.relief_date).trim())
      : pgDateOnly(charge.charge_date);
  const fiscal = await resolveOpenFiscalForDate(client, reliefDate);
  const reliefNumber = await allocateStudentReliefNumber(
    client,
    fiscal.fiscalYearId,
    reliefDate
  );
  const links = await resolveChargeLinks(client, chargeId);

  const ins = await txQuery<StudentReliefRow>(
    client,
    `INSERT INTO accounts.student_reliefs (
       relief_number, student_account_id, student_id, relief_type_id,
       billing_plan_id, student_installment_id, student_charge_id,
       fiscal_year_id, fiscal_period_id, relief_date,
       calculation_type, percentage_value, requested_amount,
       currency_code, reason, external_reference, status, requested_by
     ) VALUES (
       $1,$2::uuid,$3::uuid,$4::uuid,
       $5::uuid,$6::uuid,$7::uuid,
       $8::uuid,$9::uuid,$10::date,
       $11,$12::numeric,$13::numeric,
       $14,$15,$16,'DRAFT',$17::uuid
     ) RETURNING *`,
    [
      reliefNumber,
      charge.student_account_id,
      charge.student_id,
      reliefType.id,
      links.billing_plan_id,
      links.student_installment_id,
      chargeId,
      fiscal.fiscalYearId,
      fiscal.fiscalPeriodId,
      reliefDate,
      calculationType,
      percentage,
      requested,
      assertIqdOnly(charge.currency_code),
      requireReason(input.reason),
      optText(input.external_reference, 100),
      input.requested_by,
    ]
  );
  return ins.rows[0];
}

export async function updateStudentRelief(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    relief_type_id?: unknown;
    relief_date?: unknown;
    calculation_type?: unknown;
    requested_amount?: unknown;
    percentage_value?: unknown;
    reason?: unknown;
    external_reference?: unknown;
  }
): Promise<StudentReliefRow> {
  const row = await loadStudentRelief(client, params.id, true);
  if (row.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن تعديل المسودات فقط', 409);
  }
  assertOptimistic(row, params.version, params.updated_at);

  const charge = await loadStudentCharge(client, row.student_charge_id, true);
  let reliefType = await loadStudentReliefType(client, row.relief_type_id, false);
  if (params.relief_type_id) {
    reliefType = await loadStudentReliefType(
      client,
      String(params.relief_type_id),
      true
    );
    if (!reliefType.is_active) {
      throw new AccountsHttpError('نوع التخفيض غير فعّال', 409);
    }
  }

  const calculationType = (params.calculation_type
    ? String(params.calculation_type).trim().toUpperCase()
    : row.calculation_type) as ReliefCalculationType;

  const { requested, percentage } = calculateRequestedFromType(
    charge,
    reliefType,
    calculationType,
    {
      requested_amount: params.requested_amount ?? row.requested_amount,
      percentage_value:
        params.percentage_value ?? row.percentage_value ?? undefined,
    }
  );

  const eligible = await calculateReliefEligibleAmount(
    client,
    row.student_charge_id,
    row.id
  );
  if (moneyToMillis(requested) > moneyToMillis(eligible)) {
    throw new AccountsHttpError(
      'مبلغ التخفيض يتجاوز الرصيد المؤهل للمطالبة',
      409
    );
  }

  const reliefDate =
    params.relief_date != null && String(params.relief_date).trim() !== ''
      ? pgDateOnly(String(params.relief_date).trim())
      : pgDateOnly(row.relief_date);

  const fiscal =
    reliefDate !== pgDateOnly(row.relief_date)
      ? await resolveOpenFiscalForDate(client, reliefDate)
      : {
          fiscalYearId: row.fiscal_year_id,
          fiscalPeriodId: row.fiscal_period_id,
        };

  const upd = await txQuery<StudentReliefRow>(
    client,
    `UPDATE accounts.student_reliefs SET
       relief_type_id = $2::uuid,
       relief_date = $3::date,
       fiscal_year_id = $4::uuid,
       fiscal_period_id = $5::uuid,
       calculation_type = $6,
       percentage_value = $7::numeric,
       requested_amount = $8::numeric,
       reason = $9,
       external_reference = $10,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      row.id,
      reliefType.id,
      reliefDate,
      fiscal.fiscalYearId,
      fiscal.fiscalPeriodId,
      calculationType,
      percentage,
      requested,
      params.reason !== undefined
        ? requireReason(params.reason)
        : row.reason,
      params.external_reference !== undefined
        ? optText(params.external_reference, 100)
        : row.external_reference,
    ]
  );
  return upd.rows[0];
}

export async function submitStudentRelief(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<StudentReliefRow> {
  const peek = await loadStudentRelief(client, params.id, false);
  if (peek.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن إرسال المسودات فقط', 409);
  }

  await acquireAccountingResourceLocks(client, [
    studentReliefLock(peek.id),
    studentChargeLock(peek.student_charge_id),
  ]);

  const row = await loadStudentRelief(client, params.id, true);
  if (row.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن إرسال المسودات فقط', 409);
  }
  assertOptimistic(row, params.version, params.updated_at);

  const reliefType = await loadStudentReliefType(client, row.relief_type_id, true);
  if (!reliefType.is_active) {
    throw new AccountsHttpError('نوع التخفيض غير فعّال', 409);
  }

  const charge = await loadStudentCharge(client, row.student_charge_id, true);
  if (charge.status === 'VOID' || charge.status === 'SETTLED') {
    throw new AccountsHttpError(
      'لا يمكن إرسال تخفيض على مطالبة ملغاة أو مسددة بالكامل',
      409
    );
  }

  const eligible = await calculateReliefEligibleAmount(
    client,
    row.student_charge_id,
    row.id
  );
  if (
    moneyToMillis(row.requested_amount) > moneyToMillis(eligible) ||
    moneyIsZero(eligible)
  ) {
    throw new AccountsHttpError(
      'لا يمكن اعتماد التخفيض لأن قيمته تتجاوز الرصيد المستحق على المطالبة.',
      409
    );
  }

  const newStatus: StudentReliefStatus = reliefType.requires_approval
    ? 'PENDING_APPROVAL'
    : 'APPROVED';

  const upd = await txQuery<StudentReliefRow>(
    client,
    `UPDATE accounts.student_reliefs SET
       status = $2::varchar,
       approved_amount = CASE WHEN $2::varchar = 'APPROVED' THEN requested_amount ELSE approved_amount END,
       approved_by = CASE WHEN $2::varchar = 'APPROVED' THEN $3::uuid ELSE approved_by END,
       approved_at = CASE WHEN $2::varchar = 'APPROVED' THEN NOW() ELSE approved_at END,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [row.id, newStatus, params.userId]
  );
  return upd.rows[0];
}

export async function approveStudentRelief(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    approved_amount?: unknown;
  }
): Promise<StudentReliefRow> {
  const peek = await loadStudentRelief(client, params.id, false);
  if (peek.status !== 'PENDING_APPROVAL') {
    throw new AccountsHttpError('يمكن اعتماد الطلبات قيد الانتظار فقط', 409);
  }

  await acquireAccountingResourceLocks(client, [
    studentReliefLock(peek.id),
    studentChargeLock(peek.student_charge_id),
  ]);

  const row = await loadStudentRelief(client, params.id, true);
  if (row.status !== 'PENDING_APPROVAL') {
    throw new AccountsHttpError('يمكن اعتماد الطلبات قيد الانتظار فقط', 409);
  }
  assertOptimistic(row, params.version, params.updated_at);

  const reliefType = await loadStudentReliefType(client, row.relief_type_id, true);
  if (!reliefType.is_active) {
    throw new AccountsHttpError('نوع التخفيض غير فعّال', 409);
  }

  const approved = normalizeMoneyInput(
    params.approved_amount ?? row.requested_amount
  );
  if (!moneyIsPositive(approved)) {
    throw new AccountsHttpError('المبلغ المعتمد يجب أن يكون أكبر من صفر', 400);
  }
  if (moneyToMillis(approved) > moneyToMillis(row.requested_amount)) {
    throw new AccountsHttpError(
      'المبلغ المعتمد لا يمكن أن يتجاوز المبلغ المطلوب',
      400
    );
  }

  const eligible = await calculateReliefEligibleAmount(
    client,
    row.student_charge_id,
    row.id
  );
  if (moneyToMillis(approved) > moneyToMillis(eligible)) {
    throw new AccountsHttpError(
      'لا يمكن اعتماد التخفيض لأن قيمته تتجاوز الرصيد المستحق على المطالبة.',
      409
    );
  }

  const upd = await txQuery<StudentReliefRow>(
    client,
    `UPDATE accounts.student_reliefs SET
       status = 'APPROVED',
       approved_amount = $2::numeric,
       approved_by = $3::uuid,
       approved_at = NOW(),
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [row.id, approved, params.userId]
  );
  return upd.rows[0];
}

export async function rejectStudentRelief(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason?: unknown;
  }
): Promise<StudentReliefRow> {
  const row = await loadStudentRelief(client, params.id, true);
  if (row.status !== 'PENDING_APPROVAL') {
    throw new AccountsHttpError('يمكن رفض الطلبات قيد الانتظار فقط', 409);
  }
  assertOptimistic(row, params.version, params.updated_at);

  const reason = String(params.reason ?? '').trim();
  if (!reason) {
    throw new AccountsHttpError('سبب الرفض مطلوب', 400);
  }

  const upd = await txQuery<StudentReliefRow>(
    client,
    `UPDATE accounts.student_reliefs SET
       status = 'REJECTED',
       rejected_by = $2::uuid,
       rejected_at = NOW(),
       rejection_reason = $3,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [row.id, params.userId, reason.slice(0, 2000)]
  );
  return upd.rows[0];
}

export async function postStudentRelief(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
  }
): Promise<{ relief: StudentReliefRow; created: boolean }> {
  const reliefPeek = await loadStudentRelief(client, params.id, false);
  if (reliefPeek.status === 'POSTED' && reliefPeek.journal_entry_id) {
    return { relief: reliefPeek, created: false };
  }

  const chargePeek = await loadStudentCharge(
    client,
    reliefPeek.student_charge_id,
    false
  );
  const reliefTypePeek = await loadStudentReliefType(
    client,
    reliefPeek.relief_type_id,
    false
  );
  const accountPeek = await loadStudentAccount(
    client,
    reliefPeek.student_account_id,
    false
  );

  await acquireAccountingResourceLocks(client, [
    studentReliefLock(reliefPeek.id),
    studentChargeLock(chargePeek.id),
    studentAccountLock(accountPeek.id),
    studentLedgerLock(accountPeek.id),
    chartAccountLock(accountPeek.receivable_gl_account_id),
    chartAccountLock(reliefTypePeek.gl_account_id),
    journalSourceLock('STUDENT_RELIEF', reliefPeek.id),
  ]);

  const relief = await loadStudentRelief(client, params.id, true);
  assertOptimistic(relief, params.version, params.updated_at);

  if (relief.status !== 'APPROVED') {
    throw new AccountsHttpError('يمكن ترحيل الطلبات المعتمدة فقط', 409);
  }
  if (!relief.approved_amount) {
    throw new AccountsHttpError('المبلغ المعتمد مطلوب قبل الترحيل', 409);
  }

  const charge = await loadStudentCharge(client, relief.student_charge_id, true);
  if (charge.status === 'VOID' || charge.status === 'SETTLED') {
    throw new AccountsHttpError('حالة المطالبة لا تسمح بالترحيل', 409);
  }

  const outstanding = normalizeMoneyInput(charge.outstanding_amount);
  const amount = normalizeMoneyInput(relief.approved_amount);
  if (moneyToMillis(amount) > moneyToMillis(outstanding)) {
    throw new AccountsHttpError(
      'مبلغ التخفيض يتجاوز الرصيد المتبقي للمطالبة (تحقق متزامن)',
      409
    );
  }

  const account = await loadStudentAccount(
    client,
    relief.student_account_id,
    true
  );
  assertAccountAllowsRelief(account);

  const reliefType = await loadStudentReliefType(client, relief.relief_type_id, true);
  if (!reliefType.is_active) {
    throw new AccountsHttpError('نوع التخفيض غير فعّال', 409);
  }

  const reliefDate = pgDateOnly(relief.relief_date);
  await assertFiscalContextForEntry(client, {
    fiscalYearId: relief.fiscal_year_id,
    fiscalPeriodId: relief.fiscal_period_id,
    entryDate: reliefDate,
  });

  const receivableGl = await assertPostingAccount(
    client,
    account.receivable_gl_account_id,
    'حساب الذمم',
    { invalidStatusCode: 400 }
  );
  const expenseGl = await assertPostingAccount(
    client,
    reliefType.gl_account_id,
    'حساب مصروف التخفيض',
    { invalidStatusCode: 400 }
  );

  // Dr Relief EXPENSE / Cr Receivable — EXPENSE فقط (لا CONTRA_REVENUE)
  const linesInput = [
    {
      account_id: reliefType.gl_account_id,
      cost_center_id: null,
      debit_amount: amount,
      credit_amount: '0',
      description: `تخفيض طالب — ${relief.relief_number}`,
    },
    {
      account_id: account.receivable_gl_account_id,
      cost_center_id: null,
      debit_amount: '0',
      credit_amount: amount,
      description: relief.reason,
    },
  ];

  const { lines, totalDebit, totalCredit } = await normalizeAndValidateLines(
    client,
    linesInput,
    'strict'
  );

  const entryNumber = await allocateJournalEntryNumber(
    client,
    relief.fiscal_year_id
  );

  const jeDesc = [
    'تخفيض/منحة طالب',
    relief.relief_number,
    reliefType.name_ar,
    relief.reason,
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
       'STUDENT_RELIEF', $5::uuid, $6, $7,
       $8::numeric, $9::numeric, 'POSTED',
       1, $10::uuid, $10::uuid, $10::uuid, NOW())
     RETURNING id`,
    [
      entryNumber,
      relief.fiscal_year_id,
      relief.fiscal_period_id,
      reliefDate,
      relief.id,
      relief.external_reference || relief.relief_number,
      jeDesc,
      totalDebit,
      totalCredit,
      params.userId,
    ]
  );
  const journalId = jeIns.rows[0].id as string;
  await replaceJournalLines(client, journalId, lines);

  await writeStudentLedgerEntry(client, {
    account,
    entryDate: reliefDate,
    entryType: 'RELIEF',
    sourceType: 'STUDENT_RELIEF',
    sourceId: relief.id,
    description: jeDesc,
    debit: '0',
    credit: amount,
    currencyCode: relief.currency_code,
    journalEntryId: journalId,
    userId: params.userId,
  });

  await applyChargeRelief(client, {
    chargeId: charge.id,
    reliefAmount: amount,
  });

  let installmentId = relief.student_installment_id;
  let planId = relief.billing_plan_id;
  if (!installmentId || !planId) {
    const links = await resolveChargeLinks(client, charge.id);
    installmentId = installmentId ?? links.student_installment_id;
    planId = planId ?? links.billing_plan_id;
    if (installmentId || planId) {
      await txQuery(
        client,
        `UPDATE accounts.student_reliefs SET
           student_installment_id = COALESCE(student_installment_id, $2::uuid),
           billing_plan_id = COALESCE(billing_plan_id, $3::uuid)
         WHERE id = $1::uuid`,
        [relief.id, installmentId, planId]
      );
    }
  }

  const posted = await txQuery<StudentReliefRow>(
    client,
    `UPDATE accounts.student_reliefs SET
       status = 'POSTED',
       journal_entry_id = $2::uuid,
       posted_by = $3::uuid,
       posted_at = NOW(),
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [relief.id, journalId, params.userId]
  );

  if (installmentId) {
    await acquireAccountingResourceLocks(client, [
      studentInstallmentLock(installmentId),
    ]);
    await recalculateStudentInstallmentSettlement(
      client,
      installmentId,
      reliefDate
    );
  }

  if (planId) {
    await acquireAccountingResourceLocks(client, [
      studentBillingPlanLock(planId),
    ]);
    await recalculateStudentBillingPlanSettlement(client, planId);
  }

  void receivableGl;
  void expenseGl;
  return { relief: posted.rows[0], created: true };
}

export async function voidStudentRelief(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason?: unknown;
  }
): Promise<StudentReliefRow> {
  const relief = await loadStudentRelief(client, params.id, true);
  assertOptimistic(relief, params.version, params.updated_at);

  if (relief.status === 'VOID') return relief;

  if (
    relief.status === 'DRAFT' ||
    relief.status === 'PENDING_APPROVAL' ||
    relief.status === 'APPROVED' ||
    relief.status === 'REJECTED'
  ) {
    const upd = await txQuery<StudentReliefRow>(
      client,
      `UPDATE accounts.student_reliefs SET
         status = 'VOID',
         void_reason = $2,
         voided_by = $3::uuid,
         voided_at = NOW(),
         updated_at = NOW(),
         version = version + 1
       WHERE id = $1::uuid
       RETURNING *`,
      [
        relief.id,
        optText(params.reason, 2000) ?? 'إلغاء',
        params.userId,
      ]
    );
    return upd.rows[0];
  }

  if (relief.status !== 'POSTED' || !relief.journal_entry_id) {
    throw new AccountsHttpError('حالة التخفيض لا تسمح بالإلغاء', 409);
  }

  const reason = String(params.reason ?? '').trim();
  if (!reason) {
    throw new AccountsHttpError('سبب الإلغاء مطلوب للتخفيضات المرحّلة', 400);
  }

  const chargePeek = await loadStudentCharge(
    client,
    relief.student_charge_id,
    false
  );
  const reliefTypePeek = await loadStudentReliefType(
    client,
    relief.relief_type_id,
    false
  );
  const accountPeek = await loadStudentAccount(
    client,
    relief.student_account_id,
    false
  );

  await acquireAccountingResourceLocks(client, [
    studentReliefLock(relief.id),
    studentChargeLock(chargePeek.id),
    studentAccountLock(accountPeek.id),
    studentLedgerLock(accountPeek.id),
    chartAccountLock(accountPeek.receivable_gl_account_id),
    chartAccountLock(reliefTypePeek.gl_account_id),
    journalSourceLock('STUDENT_RELIEF', relief.id),
    journalSourceLock('STUDENT_RELIEF_REVERSAL', relief.id),
  ]);

  const account = await loadStudentAccount(
    client,
    relief.student_account_id,
    true
  );
  assertAccountAllowsRelief(account);

  const amount = normalizeMoneyInput(relief.approved_amount ?? '0');
  const original = await loadJournalEntry(client, relief.journal_entry_id);
  const reversalDate = pgDateOnly(relief.relief_date);
  const reversal = await createReversalEntry(client, {
    original,
    reversalDate,
    reason: `إلغاء تخفيض ${relief.relief_number}: ${reason}`,
    userId: params.userId,
  });

  await txQuery(
    client,
    `UPDATE accounts.journal_entries
     SET source_type = 'STUDENT_RELIEF_REVERSAL',
         source_id = $2::uuid,
         status = 'POSTED',
         updated_at = NOW(),
         version = version + 1
     WHERE id = $1::uuid`,
    [reversal.id, relief.id]
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

  await writeStudentLedgerEntry(client, {
    account,
    entryDate: reversalDate,
    entryType: 'RELIEF_REVERSAL',
    sourceType: 'STUDENT_RELIEF',
    sourceId: relief.id,
    description: `عكس تخفيض ${relief.relief_number}: ${reason}`,
    debit: amount,
    credit: '0',
    currencyCode: relief.currency_code,
    journalEntryId: reversal.id,
    userId: params.userId,
  });

  await reverseChargeRelief(client, {
    chargeId: relief.student_charge_id,
    reliefAmount: amount,
  });

  const upd = await txQuery<StudentReliefRow>(
    client,
    `UPDATE accounts.student_reliefs SET
       status = 'VOID',
       reversal_journal_entry_id = $2::uuid,
       void_reason = $3,
       voided_by = $4::uuid,
       voided_at = NOW(),
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [relief.id, reversal.id, reason.slice(0, 2000), params.userId]
  );

  let installmentId = relief.student_installment_id;
  let planId = relief.billing_plan_id;
  if (!installmentId || !planId) {
    const links = await resolveChargeLinks(client, relief.student_charge_id);
    installmentId = installmentId ?? links.student_installment_id;
    planId = planId ?? links.billing_plan_id;
  }

  if (installmentId) {
    await acquireAccountingResourceLocks(client, [
      studentInstallmentLock(installmentId),
    ]);
    await recalculateStudentInstallmentSettlement(
      client,
      installmentId,
      reversalDate
    );
  }

  if (planId) {
    await acquireAccountingResourceLocks(client, [
      studentBillingPlanLock(planId),
    ]);
    await recalculateStudentBillingPlanSettlement(client, planId);
  }

  return upd.rows[0];
}

export async function getChargeReliefSummary(
  client: TxClient,
  chargeId: string
): Promise<{
  charge_id: string;
  outstanding_amount: string;
  eligible_amount: string;
  reserved_amount: string;
  posted_relief_total: string;
  reliefs: Array<{
    id: string;
    relief_number: string;
    status: string;
    requested_amount: string;
    approved_amount: string | null;
  }>;
}> {
  const charge = await loadStudentCharge(client, chargeId, false);
  const eligible = await calculateReliefEligibleAmount(client, chargeId);
  const reserved = await sumReservedReliefOnCharge(client, chargeId);
  const posted = await txQuery<{
    id: string;
    relief_number: string;
    status: string;
    requested_amount: string;
    approved_amount: string | null;
  }>(
    client,
    `SELECT id, relief_number, status, requested_amount, approved_amount
     FROM accounts.student_reliefs
     WHERE student_charge_id = $1::uuid
       AND status NOT IN ('VOID')
     ORDER BY created_at DESC`,
    [chargeId]
  );

  const postedTotal = sumMoney(
    posted.rows
      .filter((r) => r.status === 'POSTED')
      .map((r) => normalizeMoneyInput(r.approved_amount ?? '0'))
  );

  return {
    charge_id: chargeId,
    outstanding_amount: normalizeMoneyInput(charge.outstanding_amount),
    eligible_amount: eligible,
    reserved_amount: reserved,
    posted_relief_total: postedTotal,
    reliefs: posted.rows.map((r) => ({
      ...r,
      requested_amount: normalizeMoneyInput(r.requested_amount),
      approved_amount:
        r.approved_amount == null
          ? null
          : normalizeMoneyInput(r.approved_amount),
    })),
  };
}

export async function listStudentReliefs(
  client: TxClient,
  filters: {
    q?: string;
    status?: string | null;
    student_account_id?: string | null;
    student_charge_id?: string | null;
    relief_type_id?: string | null;
    page?: number;
    page_size?: number;
  }
): Promise<{
  rows: Array<
    StudentReliefRow & {
      relief_type_code?: string | null;
      relief_type_name_ar?: string | null;
      account_number?: string | null;
      student_full_name_ar?: string | null;
      charge_number?: string | null;
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
    WHERE ($1 = '' OR sr.relief_number ILIKE '%'||$1||'%'
           OR sr.reason ILIKE '%'||$1||'%'
           OR COALESCE(sr.external_reference,'') ILIKE '%'||$1||'%')
      AND ($2::text IS NULL OR sr.status = $2)
      AND ($3::uuid IS NULL OR sr.student_account_id = $3::uuid)
      AND ($4::uuid IS NULL OR sr.student_charge_id = $4::uuid)
      AND ($5::uuid IS NULL OR sr.relief_type_id = $5::uuid)
  `;
  const params = [
    q,
    filters.status || null,
    filters.student_account_id || null,
    filters.student_charge_id || null,
    filters.relief_type_id || null,
  ];

  const count = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total
     FROM accounts.student_reliefs sr
     ${where}`,
    params
  );

  const list = await txQuery(
    client,
    `SELECT sr.*,
            srt.code AS relief_type_code,
            srt.name_ar AS relief_type_name_ar,
            sa.account_number,
            COALESCE(s.full_name_ar, s.full_name) AS student_full_name_ar,
            sc.charge_number
     FROM accounts.student_reliefs sr
     JOIN accounts.student_relief_types srt ON srt.id = sr.relief_type_id
     JOIN accounts.student_accounts sa ON sa.id = sr.student_account_id
     JOIN student_affairs.students s ON s.id = sr.student_id
     JOIN accounts.student_charges sc ON sc.id = sr.student_charge_id
     ${where}
     ORDER BY sr.relief_date DESC, sr.created_at DESC
     LIMIT $6 OFFSET $7`,
    [...params, pageSize, offset]
  );

  return {
    rows: list.rows as Array<
      StudentReliefRow & {
        relief_type_code?: string | null;
        relief_type_name_ar?: string | null;
        account_number?: string | null;
        student_full_name_ar?: string | null;
        charge_number?: string | null;
      }
    >,
    total: count.rows[0]?.total ?? 0,
    page,
    page_size: pageSize,
  };
}

export async function getStudentRelief(
  client: TxClient,
  id: string
): Promise<
  StudentReliefRow & {
    relief_type_code?: string | null;
    relief_type_name_ar?: string | null;
    relief_kind?: string | null;
    account_number?: string | null;
    student_full_name_ar?: string | null;
    charge_number?: string | null;
    charge_outstanding?: string | null;
  }
> {
  const r = await txQuery(
    client,
    `SELECT sr.*,
            srt.code AS relief_type_code,
            srt.name_ar AS relief_type_name_ar,
            srt.relief_kind,
            sa.account_number,
            COALESCE(s.full_name_ar, s.full_name) AS student_full_name_ar,
            sc.charge_number,
            sc.outstanding_amount AS charge_outstanding
     FROM accounts.student_reliefs sr
     JOIN accounts.student_relief_types srt ON srt.id = sr.relief_type_id
     JOIN accounts.student_accounts sa ON sa.id = sr.student_account_id
     JOIN student_affairs.students s ON s.id = sr.student_id
     JOIN accounts.student_charges sc ON sc.id = sr.student_charge_id
     WHERE sr.id = $1::uuid`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('طلب التخفيض غير موجود', 404);
  return r.rows[0] as StudentReliefRow & {
    relief_type_code?: string | null;
    relief_type_name_ar?: string | null;
    relief_kind?: string | null;
    account_number?: string | null;
    student_full_name_ar?: string | null;
    charge_number?: string | null;
    charge_outstanding?: string | null;
  };
}

export async function listReliefOptions(
  client: TxClient
): Promise<{
  relief_types: Array<{
    id: string;
    code: string;
    name_ar: string;
    relief_kind: string;
    calculation_type: string;
    default_value: string | null;
    max_value: string | null;
    requires_approval: boolean;
  }>;
  relief_kinds: Array<{ code: string; name_ar: string }>;
  calculation_types: Array<{ code: string; name_ar: string }>;
  statuses: Array<{ code: string; name_ar: string }>;
}> {
  const types = await txQuery(
    client,
    `SELECT id, code, name_ar, relief_kind, calculation_type,
            default_value, max_value, requires_approval
     FROM accounts.student_relief_types
     WHERE is_active = TRUE
     ORDER BY code`
  );

  return {
    relief_types: (types.rows as Array<Record<string, unknown>>).map((t) => ({
      id: t.id as string,
      code: t.code as string,
      name_ar: t.name_ar as string,
      relief_kind: t.relief_kind as string,
      calculation_type: t.calculation_type as string,
      default_value:
        t.default_value == null
          ? null
          : normalizeMoneyInput(String(t.default_value)),
      max_value:
        t.max_value == null ? null : normalizeMoneyInput(String(t.max_value)),
      requires_approval: Boolean(t.requires_approval),
    })),
    relief_kinds: [
      { code: 'DISCOUNT', name_ar: 'خصم' },
      { code: 'SCHOLARSHIP', name_ar: 'منحة' },
      { code: 'WAIVER', name_ar: 'إعفاء' },
    ],
    calculation_types: [
      { code: 'FIXED_AMOUNT', name_ar: 'مبلغ ثابت' },
      { code: 'PERCENTAGE', name_ar: 'نسبة مئوية' },
    ],
    statuses: [
      { code: 'DRAFT', name_ar: 'مسودة' },
      { code: 'PENDING_APPROVAL', name_ar: 'بانتظار الاعتماد' },
      { code: 'APPROVED', name_ar: 'معتمد' },
      { code: 'POSTED', name_ar: 'مرحّل' },
      { code: 'REJECTED', name_ar: 'مرفوض' },
      { code: 'VOID', name_ar: 'ملغى' },
    ],
  };
}
