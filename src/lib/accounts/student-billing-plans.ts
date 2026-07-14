/**
 * خطط رسوم الطلبة والأقساط — المرحلة 5.B
 */
import {
  acquireAccountingResourceLocks,
  studentAccountLock,
  studentBillingPlanLock,
  studentChargeLock,
  studentInstallmentLock,
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
import { assertFiscalContextForEntry } from './journal-entries';
import {
  moneyEquals,
  moneyIsPositive,
  moneyIsZero,
  moneyToMillis,
  millisToMoney,
  normalizeMoneyInput,
  sumMoney,
} from './money';
import {
  deriveInstallmentStatus,
  type StudentInstallmentStatus,
} from './student-installment-status';
import {
  createStudentCharge,
  loadStudentCharge,
  postStudentCharge,
  voidStudentCharge,
} from './student-charges';
import {
  assertStudentAccountActiveForCharges,
  loadStudentAccount,
} from './student-accounts';
import { loadStudentFeeType } from './student-fee-types';
import { assertStudentActiveForCharges } from './students-ref';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type StudentBillingPlanStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED';

export type { StudentInstallmentStatus };

export type StudentBillingPlanRow = {
  id: string;
  plan_number: string;
  student_account_id: string;
  student_id: string;
  fee_type_id: string;
  academic_year_id: string | null;
  academic_year: string | null;
  fiscal_year_id: string;
  currency_code: string;
  total_amount: string;
  installment_count: number;
  status: StudentBillingPlanStatus;
  description: string;
  external_reference: string | null;
  activated_at: Date | string | null;
  activated_by: string | null;
  cancelled_at: Date | string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  version: number;
};

export type StudentInstallmentRow = {
  id: string;
  billing_plan_id: string;
  student_account_id: string;
  installment_number: number;
  due_date: string | Date;
  amount: string;
  paid_amount: string;
  relief_amount: string;
  credit_note_amount: string;
  outstanding_amount: string;
  status: StudentInstallmentStatus;
  student_charge_id: string | null;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type InstallmentDraftInput = {
  installment_number: number;
  due_date: string;
  amount: string;
  notes?: string | null;
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
  if (!s) throw new AccountsHttpError('بيان الخطة مطلوب', 400);
  return s.slice(0, 4000);
}

function assertIqdOnly(value: unknown): string {
  const code = normalizeCurrencyCode(value, 'IQD');
  if (code !== 'IQD') {
    throw new AccountsHttpError('عملة خطط الرسوم في المرحلة الحالية IQD فقط', 400);
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

function addMonths(dateStr: string, months: number): string {
  const d = new Date(`${pgDateOnly(dateStr)}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function serializeStudentBillingPlan(row: StudentBillingPlanRow) {
  return {
    ...row,
    total_amount: normalizeMoneyInput(row.total_amount),
    activated_at: iso(row.activated_at),
    cancelled_at: iso(row.cancelled_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export function serializeStudentInstallment(row: StudentInstallmentRow) {
  const dueDate = pgDateOnly(row.due_date);
  const relief = normalizeMoneyInput(row.relief_amount ?? '0');
  const creditNote = normalizeMoneyInput(row.credit_note_amount ?? '0');
  const base = {
    ...row,
    amount: normalizeMoneyInput(row.amount),
    paid_amount: normalizeMoneyInput(row.paid_amount),
    relief_amount: relief,
    credit_note_amount: creditNote,
    outstanding_amount: normalizeMoneyInput(row.outstanding_amount),
    due_date: dueDate,
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
  const terminal: StudentInstallmentStatus[] = [
    'CANCELLED',
    'PAID',
    'PARTIALLY_PAID',
  ];
  if (!terminal.includes(row.status)) {
    return {
      ...base,
      status: deriveInstallmentStatus(
        row.paid_amount,
        row.amount,
        dueDate,
        undefined,
        row.outstanding_amount
      ),
    };
  }
  return base;
}

export function generateEqualInstallments(
  total: string,
  count: number,
  firstDueDate: string
): InstallmentDraftInput[] {
  const n = Number(count);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AccountsHttpError('عدد الأقساط يجب أن يكون عدداً صحيحاً موجباً', 400);
  }
  let totalNorm: string;
  try {
    totalNorm = normalizeMoneyInput(total);
  } catch {
    throw new AccountsHttpError('إجمالي الخطة غير صالح', 400);
  }
  if (!moneyIsPositive(totalNorm)) {
    throw new AccountsHttpError('إجمالي الخطة يجب أن يكون أكبر من صفر', 400);
  }

  const firstDue = pgDateOnly(firstDueDate);
  const totalMillis = moneyToMillis(totalNorm);
  const baseMillis = totalMillis / BigInt(n);
  const remainder = totalMillis - baseMillis * BigInt(n);

  const installments: InstallmentDraftInput[] = [];
  for (let i = 0; i < n; i += 1) {
    let amountMillis = baseMillis;
    if (i === n - 1) amountMillis += remainder;
    installments.push({
      installment_number: i + 1,
      due_date: addMonths(firstDue, i),
      amount: millisToMoney(amountMillis),
    });
  }
  return installments;
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
      'لا توجد فترة مالية مفتوحة تغطي التاريخ المحدد',
      409
    );
  }
  return {
    fiscalYearId: r.rows[0].year_id,
    fiscalPeriodId: r.rows[0].period_id,
  };
}

export async function allocateStudentBillingPlanNumber(
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
     SELECT 'STUDENT_BILLING_PLAN', $1::uuid, 'SBP', 0, 6, TRUE, TRUE
     WHERE NOT EXISTS (
       SELECT 1 FROM accounts.document_sequences
       WHERE document_type = 'STUDENT_BILLING_PLAN' AND fiscal_year_id = $1::uuid
     )`,
    [fiscalYearId]
  );
  try {
    const seq = await nextDocumentNumber(client, {
      documentType: 'STUDENT_BILLING_PLAN',
      fiscalYearId,
      yearLabel: yearLabelFromDate(year.rows[0].start_date),
    });
    return seq.formatted;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'تعذر تخصيص رقم خطة الرسوم';
    throw new AccountsHttpError(msg, 409);
  }
}

function normalizeInstallmentDrafts(
  drafts: InstallmentDraftInput[],
  totalAmount: string
): InstallmentDraftInput[] {
  if (!drafts.length) {
    throw new AccountsHttpError('يجب تحديد قسط واحد على الأقل', 400);
  }
  const sorted = [...drafts].sort(
    (a, b) => a.installment_number - b.installment_number
  );
  const numbers = new Set<number>();
  const normalized: InstallmentDraftInput[] = [];
  for (const d of sorted) {
    const num = Number(d.installment_number);
    if (!Number.isInteger(num) || num <= 0) {
      throw new AccountsHttpError('رقم القسط غير صالح', 400);
    }
    if (numbers.has(num)) {
      throw new AccountsHttpError('أرقام الأقساط مكررة', 400);
    }
    numbers.add(num);
    let amount: string;
    try {
      amount = normalizeMoneyInput(d.amount);
    } catch {
      throw new AccountsHttpError(`مبلغ القسط ${num} غير صالح`, 400);
    }
    if (!moneyIsPositive(amount)) {
      throw new AccountsHttpError(`مبلغ القسط ${num} يجب أن يكون أكبر من صفر`, 400);
    }
    normalized.push({
      installment_number: num,
      due_date: pgDateOnly(d.due_date),
      amount,
      notes: optText(d.notes, 2000),
    });
  }
  const sum = sumMoney(normalized.map((i) => i.amount));
  if (!moneyEquals(sum, totalAmount)) {
    throw new AccountsHttpError(
      'مجموع مبالغ الأقساط لا يساوي إجمالي الخطة',
      400
    );
  }
  return normalized;
}

async function insertInstallments(
  client: TxClient,
  plan: StudentBillingPlanRow,
  drafts: InstallmentDraftInput[]
): Promise<StudentInstallmentRow[]> {
  const rows: StudentInstallmentRow[] = [];
  for (const d of drafts) {
    const ins = await txQuery<StudentInstallmentRow>(
      client,
      `INSERT INTO accounts.student_installments (
         billing_plan_id, student_account_id, installment_number,
         due_date, amount, paid_amount, outstanding_amount, status, notes
       ) VALUES (
         $1::uuid, $2::uuid, $3,
         $4::date, $5::numeric, 0, $5::numeric, 'PENDING', $6
       ) RETURNING *`,
      [
        plan.id,
        plan.student_account_id,
        d.installment_number,
        d.due_date,
        d.amount,
        d.notes,
      ]
    );
    rows.push(ins.rows[0]);
  }
  return rows;
}

export async function loadStudentBillingPlan(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<StudentBillingPlanRow> {
  const r = await txQuery<StudentBillingPlanRow>(
    client,
    `SELECT * FROM accounts.student_billing_plans WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('خطة الرسوم غير موجودة', 404);
  }
  return r.rows[0];
}

export async function loadStudentInstallment(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<StudentInstallmentRow> {
  const r = await txQuery<StudentInstallmentRow>(
    client,
    `SELECT * FROM accounts.student_installments WHERE id = $1::uuid ${
      forUpdate ? 'FOR UPDATE' : ''
    }`,
    [id]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError('قسط الخطة غير موجود', 404);
  }
  return r.rows[0];
}

export async function listPlanInstallments(
  client: TxClient,
  planId: string
): Promise<StudentInstallmentRow[]> {
  const r = await txQuery<StudentInstallmentRow>(
    client,
    `SELECT * FROM accounts.student_installments
     WHERE billing_plan_id = $1::uuid
     ORDER BY installment_number ASC`,
    [planId]
  );
  return r.rows;
}

export async function createStudentBillingPlan(
  client: TxClient,
  input: {
    student_account_id: unknown;
    fee_type_id: unknown;
    total_amount?: unknown;
    installment_count?: unknown;
    first_due_date?: unknown;
    installments?: InstallmentDraftInput[];
    fiscal_year_id?: unknown;
    academic_year_id?: unknown;
    academic_year?: unknown;
    description?: unknown;
    external_reference?: unknown;
    currency_code?: unknown;
    created_by: string;
  }
): Promise<{ plan: StudentBillingPlanRow; installments: StudentInstallmentRow[] }> {
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
  if (currency !== account.currency_code || currency !== feeType.currency_code) {
    throw new AccountsHttpError('عملة الخطة لا تطابق حساب الطالب أو نوع الرسم', 409);
  }

  let totalAmount: string;
  if (input.total_amount != null && input.total_amount !== '') {
    try {
      totalAmount = normalizeMoneyInput(input.total_amount);
    } catch {
      throw new AccountsHttpError('إجمالي الخطة غير صالح', 400);
    }
  } else if (input.installments?.length) {
    totalAmount = sumMoney(
      input.installments.map((i) => normalizeMoneyInput(i.amount))
    );
  } else {
    throw new AccountsHttpError('إجمالي الخطة مطلوب', 400);
  }
  if (!moneyIsPositive(totalAmount)) {
    throw new AccountsHttpError('إجمالي الخطة يجب أن يكون أكبر من صفر', 400);
  }

  let installmentDrafts: InstallmentDraftInput[];
  if (input.installments?.length) {
    installmentDrafts = normalizeInstallmentDrafts(input.installments, totalAmount);
  } else {
    const count = Number(input.installment_count);
    const firstDue = input.first_due_date;
    if (!Number.isInteger(count) || count <= 0) {
      throw new AccountsHttpError('عدد الأقساط مطلوب للتوليد التلقائي', 400);
    }
    if (firstDue == null || firstDue === '') {
      throw new AccountsHttpError('تاريخ استحقاق أول قسط مطلوب', 400);
    }
    installmentDrafts = generateEqualInstallments(
      totalAmount,
      count,
      String(firstDue)
    );
  }

  const refDate = installmentDrafts[0]?.due_date ?? pgDateOnly(new Date());
  let fiscalYearId =
    input.fiscal_year_id != null && input.fiscal_year_id !== ''
      ? String(input.fiscal_year_id).trim()
      : '';
  if (!fiscalYearId) {
    const resolved = await resolveOpenFiscalForDate(client, refDate);
    fiscalYearId = resolved.fiscalYearId;
  }

  await assertFiscalContextForEntry(client, {
    fiscalYearId,
    fiscalPeriodId: (await resolveOpenFiscalForDate(client, refDate)).fiscalPeriodId,
    entryDate: refDate,
  });

  const planNumber = await allocateStudentBillingPlanNumber(client, fiscalYearId);
  const description =
    input.description != null && String(input.description).trim()
      ? requireDescription(input.description)
      : `خطة رسوم — ${feeType.name_ar}`;

  const ins = await txQuery<StudentBillingPlanRow>(
    client,
    `INSERT INTO accounts.student_billing_plans (
       plan_number, student_account_id, student_id, fee_type_id,
       academic_year_id, academic_year, fiscal_year_id, currency_code,
       total_amount, installment_count, status, description,
       external_reference, created_by, updated_by
     ) VALUES (
       $1, $2::uuid, $3::uuid, $4::uuid,
       $5::uuid, $6, $7::uuid, $8,
       $9::numeric, $10, 'DRAFT', $11,
       $12, $13::uuid, $13::uuid
     ) RETURNING *`,
    [
      planNumber,
      account.id,
      account.student_id,
      feeType.id,
      input.academic_year_id != null && input.academic_year_id !== ''
        ? String(input.academic_year_id).trim()
        : null,
      optText(input.academic_year, 20) ?? account.academic_year,
      fiscalYearId,
      currency,
      totalAmount,
      installmentDrafts.length,
      description,
      optText(input.external_reference, 100),
      input.created_by,
    ]
  );
  const plan = ins.rows[0];
  const installments = await insertInstallments(client, plan, installmentDrafts);
  return { plan, installments };
}

export async function updateStudentBillingPlan(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    fee_type_id?: unknown;
    academic_year_id?: unknown;
    academic_year?: unknown;
    description?: unknown;
    external_reference?: unknown;
  }
): Promise<StudentBillingPlanRow> {
  const plan = await loadStudentBillingPlan(client, params.id, true);
  assertOptimistic(plan, params.version, params.updated_at);
  if (plan.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن تعديل خطط المسودة فقط', 409);
  }

  let feeTypeId = plan.fee_type_id;
  if (params.fee_type_id !== undefined && params.fee_type_id !== '') {
    feeTypeId = String(params.fee_type_id).trim();
    const feeType = await loadStudentFeeType(client, feeTypeId, true);
    if (!feeType.is_active) {
      throw new AccountsHttpError('نوع الرسم غير فعّال', 409);
    }
  }

  const upd = await txQuery<StudentBillingPlanRow>(
    client,
    `UPDATE accounts.student_billing_plans SET
       fee_type_id = $2::uuid,
       academic_year_id = $3::uuid,
       academic_year = $4,
       description = $5,
       external_reference = $6,
       updated_by = $7::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [
      plan.id,
      feeTypeId,
      params.academic_year_id !== undefined
        ? params.academic_year_id === null || params.academic_year_id === ''
          ? null
          : String(params.academic_year_id).trim()
        : plan.academic_year_id,
      params.academic_year !== undefined
        ? optText(params.academic_year, 20)
        : plan.academic_year,
      params.description !== undefined
        ? requireDescription(params.description)
        : plan.description,
      params.external_reference !== undefined
        ? optText(params.external_reference, 100)
        : plan.external_reference,
      params.userId,
    ]
  );
  return upd.rows[0];
}

export async function replaceInstallments(
  client: TxClient,
  params: {
    planId: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    installments: InstallmentDraftInput[];
    total_amount?: unknown;
  }
): Promise<{ plan: StudentBillingPlanRow; installments: StudentInstallmentRow[] }> {
  const plan = await loadStudentBillingPlan(client, params.planId, true);
  assertOptimistic(plan, params.version, params.updated_at);
  if (plan.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن تعديل أقساط خطط المسودة فقط', 409);
  }

  let totalAmount = normalizeMoneyInput(plan.total_amount);
  if (params.total_amount !== undefined && params.total_amount !== '') {
    try {
      totalAmount = normalizeMoneyInput(params.total_amount);
    } catch {
      throw new AccountsHttpError('إجمالي الخطة غير صالح', 400);
    }
    if (!moneyIsPositive(totalAmount)) {
      throw new AccountsHttpError('إجمالي الخطة يجب أن يكون أكبر من صفر', 400);
    }
  }

  const drafts = normalizeInstallmentDrafts(params.installments, totalAmount);

  await txQuery(
    client,
    `DELETE FROM accounts.student_installments WHERE billing_plan_id = $1::uuid`,
    [plan.id]
  );

  const updPlan = await txQuery<StudentBillingPlanRow>(
    client,
    `UPDATE accounts.student_billing_plans SET
       total_amount = $2::numeric,
       installment_count = $3,
       updated_by = $4::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [plan.id, totalAmount, drafts.length, params.userId]
  );

  const installments = await insertInstallments(client, updPlan.rows[0], drafts);
  return { plan: updPlan.rows[0], installments };
}

function initialInstallmentStatus(
  dueDate: string,
  asOfDate: string
): StudentInstallmentStatus {
  if (dueDate <= asOfDate) return 'DUE';
  return 'PENDING';
}

export async function activateStudentBillingPlan(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    activation_date?: unknown;
  }
): Promise<{
  plan: StudentBillingPlanRow;
  installments: StudentInstallmentRow[];
}> {
  const planPeek = await loadStudentBillingPlan(client, params.id, false);

  const installmentsPeek = await listPlanInstallments(client, params.id);
  const locks = [
    studentBillingPlanLock(params.id),
    studentAccountLock(planPeek.student_account_id),
    studentLedgerLock(planPeek.student_account_id),
    ...installmentsPeek.map((i) => studentInstallmentLock(i.id)),
  ];
  await acquireAccountingResourceLocks(client, locks);

  const plan = await loadStudentBillingPlan(client, params.id, true);
  assertOptimistic(plan, params.version, params.updated_at);
  if (plan.status !== 'DRAFT') {
    throw new AccountsHttpError('يمكن تفعيل خطط المسودة فقط', 409);
  }

  const account = await loadStudentAccount(client, plan.student_account_id, true);
  await assertStudentAccountActiveForCharges(client, account);
  await assertStudentActiveForCharges(client, account.student_id);

  const feeType = await loadStudentFeeType(client, plan.fee_type_id, true);
  if (!feeType.is_active) {
    throw new AccountsHttpError('نوع الرسم غير فعّال', 409);
  }

  const activationDate =
    params.activation_date != null && params.activation_date !== ''
      ? pgDateOnly(String(params.activation_date))
      : pgDateOnly(new Date());

  const installments = await listPlanInstallments(client, plan.id);
  if (!installments.length) {
    throw new AccountsHttpError('الخطة بلا أقساط', 409);
  }

  const sum = sumMoney(installments.map((i) => normalizeMoneyInput(i.amount)));
  if (!moneyEquals(sum, normalizeMoneyInput(plan.total_amount))) {
    throw new AccountsHttpError(
      'مجموع الأقساط لا يساوي إجمالي الخطة',
      409
    );
  }

  const updatedInstallments: StudentInstallmentRow[] = [];

  for (const inst of installments) {
    await acquireAccountingResourceLocks(client, [studentInstallmentLock(inst.id)]);

    const chargeDesc = `${plan.description} — قسط ${inst.installment_number}`;
    const charge = await createStudentCharge(client, {
      student_account_id: account.id,
      fee_type_id: plan.fee_type_id,
      charge_date: activationDate,
      due_date: pgDateOnly(inst.due_date),
      original_amount: inst.amount,
      fiscal_year_id: plan.fiscal_year_id,
      academic_year: plan.academic_year,
      description: chargeDesc,
      external_reference: plan.external_reference
        ? `${plan.external_reference}-${inst.installment_number}`
        : null,
      currency_code: plan.currency_code,
      created_by: params.userId,
    });

    await acquireAccountingResourceLocks(client, [studentChargeLock(charge.id)]);

    const posted = await postStudentCharge(client, {
      id: charge.id,
      userId: params.userId,
      version: charge.version,
      updated_at: charge.updated_at,
    });

    const instStatus = initialInstallmentStatus(
      pgDateOnly(inst.due_date),
      activationDate
    );

    const updInst = await txQuery<StudentInstallmentRow>(
      client,
      `UPDATE accounts.student_installments SET
         student_charge_id = $2::uuid,
         outstanding_amount = amount,
         paid_amount = 0,
         status = $3,
         updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING *`,
      [inst.id, posted.charge.id, instStatus]
    );
    updatedInstallments.push(updInst.rows[0]);
  }

  const activated = await txQuery<StudentBillingPlanRow>(
    client,
    `UPDATE accounts.student_billing_plans SET
       status = 'ACTIVE',
       activated_at = NOW(),
       activated_by = $2::uuid,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [plan.id, params.userId]
  );

  return { plan: activated.rows[0], installments: updatedInstallments };
}

/**
 * سياسة إلغاء الخطة (محافظة):
 * 1) CANCELLED → idempotent
 * 2) COMPLETED → 409
 * 3) رفض إذا وُجدت تحصيلات DRAFT/POSTED مخصّصة لأقساط أو مطالبات الخطة
 * 4) DRAFT → إلغاء أقساط PENDING/DUE فقط → CANCELLED (بلا مطالبات)
 * 5) ACTIVE بلا تحصيلات حاجزة → إبطال المطالبات غير المسددة ثم إلغاء كل الأقساط غير الملغاة
 */
export async function cancelStudentBillingPlan(
  client: TxClient,
  params: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    reason?: unknown;
  }
): Promise<StudentBillingPlanRow> {
  const plan = await loadStudentBillingPlan(client, params.id, true);
  assertOptimistic(plan, params.version, params.updated_at);

  if (plan.status === 'CANCELLED') return plan;
  if (plan.status === 'COMPLETED') {
    throw new AccountsHttpError('لا يمكن إلغاء خطة مكتملة', 409);
  }

  const blockingCollections = await txQuery(
    client,
    `SELECT 1
     FROM accounts.student_collection_allocations sca
     JOIN accounts.student_collections sc ON sc.id = sca.collection_id
     LEFT JOIN accounts.student_installments si_inst
       ON si_inst.id = sca.student_installment_id
     WHERE sc.status IN ('DRAFT', 'POSTED')
       AND (
         si_inst.billing_plan_id = $1::uuid
         OR sca.student_charge_id IN (
           SELECT student_charge_id FROM accounts.student_installments
           WHERE billing_plan_id = $1::uuid AND student_charge_id IS NOT NULL
         )
       )
     LIMIT 1`,
    [plan.id]
  );
  if (blockingCollections.rows[0]) {
    throw new AccountsHttpError(
      'لا يمكن إلغاء الخطة لوجود تحصيلات نشطة مخصّصة لأقساطها أو مطالباتها',
      409
    );
  }

  const voidReason = optText(params.reason, 2000) ?? 'إلغاء خطة رسوم';

  if (plan.status === 'DRAFT') {
    await txQuery(
      client,
      `UPDATE accounts.student_installments SET
         status = 'CANCELLED',
         updated_at = NOW()
       WHERE billing_plan_id = $1::uuid
         AND status IN ('PENDING', 'DUE')`,
      [plan.id]
    );
  } else if (plan.status === 'ACTIVE') {
    const installments = await listPlanInstallments(client, plan.id);

    for (const inst of installments) {
      if (!inst.student_charge_id) continue;

      await acquireAccountingResourceLocks(client, [
        studentInstallmentLock(inst.id),
        studentChargeLock(inst.student_charge_id),
      ]);

      const charge = await loadStudentCharge(client, inst.student_charge_id, true);

      if (charge.status === 'VOID') continue;

      if (
        charge.status === 'PARTIALLY_SETTLED' ||
        charge.status === 'SETTLED'
      ) {
        throw new AccountsHttpError(
          'لا يمكن إلغاء الخطة لمطالبة مسددة جزئياً أو كلياً',
          409
        );
      }

      if (charge.status === 'POSTED') {
        const original = normalizeMoneyInput(charge.original_amount);
        const outstanding = normalizeMoneyInput(charge.outstanding_amount);
        if (!moneyEquals(outstanding, original)) {
          throw new AccountsHttpError(
            'لا يمكن إبطال مطالبة عليها أثر تحصيل',
            409
          );
        }
        await voidStudentCharge(client, {
          id: charge.id,
          userId: params.userId,
          version: charge.version,
          updated_at: charge.updated_at,
          reason: voidReason,
        });
      } else if (charge.status === 'DRAFT') {
        await voidStudentCharge(client, {
          id: charge.id,
          userId: params.userId,
          version: charge.version,
          updated_at: charge.updated_at,
          reason: voidReason,
        });
      }
    }

    await txQuery(
      client,
      `UPDATE accounts.student_installments SET
         status = 'CANCELLED',
         updated_at = NOW()
       WHERE billing_plan_id = $1::uuid
         AND status <> 'CANCELLED'`,
      [plan.id]
    );
  }

  const cancelled = await txQuery<StudentBillingPlanRow>(
    client,
    `UPDATE accounts.student_billing_plans SET
       status = 'CANCELLED',
       cancelled_at = NOW(),
       cancelled_by = $2::uuid,
       cancellation_reason = $3,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [plan.id, params.userId, voidReason]
  );
  return cancelled.rows[0];
}

export async function refreshBillingPlanCompletion(
  client: TxClient,
  planId: string
): Promise<void> {
  const plan = await loadStudentBillingPlan(client, planId, true);
  const installments = await listPlanInstallments(client, planId);

  const anyCancelled = installments.some((i) => i.status === 'CANCELLED');
  const allSettled =
    installments.length > 0 &&
    installments.every(
      (i) =>
        i.status === 'PAID' ||
        moneyIsZero(normalizeMoneyInput(i.outstanding_amount))
    );
  const anyNotSettled = installments.some(
    (i) =>
      i.status !== 'PAID' &&
      !moneyIsZero(normalizeMoneyInput(i.outstanding_amount))
  );

  if (allSettled && !anyCancelled) {
    const paidSum = sumMoney(
      installments.map((i) => normalizeMoneyInput(i.paid_amount))
    );
    const reliefSum = sumMoney(
      installments.map((i) => normalizeMoneyInput(i.relief_amount ?? '0'))
    );
    const settledSum = millisToMoney(
      moneyToMillis(paidSum) + moneyToMillis(reliefSum)
    );
    const total = normalizeMoneyInput(plan.total_amount);
    const allOutstandingZero = installments.every((i) =>
      moneyIsZero(normalizeMoneyInput(i.outstanding_amount))
    );
    if (moneyEquals(settledSum, total) && allOutstandingZero) {
      await txQuery(
        client,
        `UPDATE accounts.student_billing_plans SET
           status = 'COMPLETED',
           updated_at = NOW(),
           version = version + 1
         WHERE id = $1::uuid AND status = 'ACTIVE'`,
        [planId]
      );
      return;
    }
  }

  if (anyNotSettled || anyCancelled) {
    await txQuery(
      client,
      `UPDATE accounts.student_billing_plans SET
         status = 'ACTIVE',
         updated_at = NOW(),
         version = version + 1
       WHERE id = $1::uuid AND status = 'COMPLETED'`,
      [planId]
    );
  }
}

export async function getStudentBillingPlan(
  client: TxClient,
  id: string
): Promise<{
  plan: StudentBillingPlanRow;
  installments: StudentInstallmentRow[];
}> {
  const plan = await loadStudentBillingPlan(client, id);
  const installments = await listPlanInstallments(client, id);
  return { plan, installments };
}

export async function listStudentBillingPlans(
  client: TxClient,
  filters: {
    q?: string;
    status?: string | null;
    student_account_id?: string | null;
    student_id?: string | null;
    page?: number;
    page_size?: number;
  }
): Promise<{
  rows: Array<
    StudentBillingPlanRow & {
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
    WHERE ($1 = '' OR p.plan_number ILIKE '%'||$1||'%'
           OR p.description ILIKE '%'||$1||'%'
           OR COALESCE(p.external_reference,'') ILIKE '%'||$1||'%')
      AND ($2::text IS NULL OR p.status = $2)
      AND ($3::uuid IS NULL OR p.student_account_id = $3::uuid)
      AND ($4::uuid IS NULL OR p.student_id = $4::uuid)
  `;
  const params = [
    q,
    filters.status || null,
    filters.student_account_id || null,
    filters.student_id || null,
  ];

  const count = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total
     FROM accounts.student_billing_plans p
     ${where}`,
    params
  );

  const list = await txQuery(
    client,
    `SELECT p.*,
            ft.code AS fee_type_code,
            ft.name_ar AS fee_type_name_ar,
            sa.account_number,
            COALESCE(s.full_name_ar, s.full_name) AS student_full_name_ar
     FROM accounts.student_billing_plans p
     JOIN accounts.student_fee_types ft ON ft.id = p.fee_type_id
     JOIN accounts.student_accounts sa ON sa.id = p.student_account_id
     JOIN student_affairs.students s ON s.id = p.student_id
     ${where}
     ORDER BY p.created_at DESC
     LIMIT $5 OFFSET $6`,
    [...params, pageSize, offset]
  );

  return {
    rows: list.rows as Array<
      StudentBillingPlanRow & {
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

export async function listStudentInstallments(
  client: TxClient,
  filters: {
    status?: string | null;
    q?: string;
    student_account_id?: string | null;
    plan_status?: string | null;
    page?: number;
    page_size?: number;
  }
): Promise<{
  rows: Array<
    StudentInstallmentRow & {
      plan_number?: string | null;
      plan_status?: StudentBillingPlanStatus | null;
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
  const statusFilter = filters.status || null;
  const today = pgDateOnly(new Date());

  const params: unknown[] = [
    q,
    filters.student_account_id || null,
    filters.plan_status || null,
  ];

  let statusClause = 'TRUE';
  if (statusFilter === 'DUE') {
    statusClause = `(si.status = 'DUE' OR (si.status = 'PENDING' AND si.due_date <= $4::date))`;
    params.push(today);
  } else if (statusFilter === 'PENDING') {
    statusClause = `(si.status = 'PENDING' AND si.due_date > $4::date)`;
    params.push(today);
  } else if (statusFilter) {
    statusClause = `si.status = $4`;
    params.push(statusFilter);
  }

  const where = `
    WHERE ($1 = '' OR p.plan_number ILIKE '%'||$1||'%'
           OR COALESCE(s.full_name_ar, s.full_name, '') ILIKE '%'||$1||'%'
           OR sa.account_number ILIKE '%'||$1||'%'
           OR CAST(si.installment_number AS TEXT) ILIKE '%'||$1||'%')
      AND ${statusClause}
      AND ($2::uuid IS NULL OR si.student_account_id = $2::uuid)
      AND ($3::text IS NULL OR p.status = $3)
  `;

  const count = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total
     FROM accounts.student_installments si
     JOIN accounts.student_billing_plans p ON p.id = si.billing_plan_id
     JOIN accounts.student_accounts sa ON sa.id = si.student_account_id
     JOIN student_affairs.students s ON s.id = p.student_id
     ${where}`,
    params
  );

  const list = await txQuery(
    client,
    `SELECT si.*,
            p.plan_number,
            p.status AS plan_status,
            sa.account_number,
            COALESCE(s.full_name_ar, s.full_name) AS student_full_name_ar
     FROM accounts.student_installments si
     JOIN accounts.student_billing_plans p ON p.id = si.billing_plan_id
     JOIN accounts.student_accounts sa ON sa.id = si.student_account_id
     JOIN student_affairs.students s ON s.id = p.student_id
     ${where}
     ORDER BY si.due_date ASC, si.installment_number ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  );

  return {
    rows: list.rows as Array<
      StudentInstallmentRow & {
        plan_number?: string | null;
        plan_status?: StudentBillingPlanStatus | null;
        account_number?: string | null;
        student_full_name_ar?: string | null;
      }
    >,
    total: count.rows[0]?.total ?? 0,
    page,
    page_size: pageSize,
  };
}
