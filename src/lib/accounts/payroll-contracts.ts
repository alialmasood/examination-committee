/** عقود الرواتب — 9.A.1 (عقد أساسي واحد فعّال لكل شخص) */
import { AccountsHttpError } from './auth';
import { payrollContractLock, payrollPersonLock } from './accounting-locks';
import { acquirePayrollLocks } from './payroll-locks';
import { loadPayrollPerson } from './payroll-people';
import {
  PAYROLL_ENUMS,
  assertEffectiveRange,
  assertOptionalCostCenter,
  assertOptionalPostingAccount,
  assertPayrollCodeAvailable,
  assertPayrollConcurrency,
  currencyCode,
  dateStr,
  iso,
  nextPayrollNumber,
  nonNegativeMoney,
  oneOf,
  optionalDate,
  optionalNonNegativeMoney,
  payrollCode,
  requiredDate,
  textOrNull,
} from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PayrollContractRow = {
  id: string;
  payroll_person_id: string;
  contract_number: string;
  compensation_basis: string;
  base_amount: string;
  rate_amount: string | null;
  currency_code: string;
  effective_from: string | Date;
  effective_to: string | Date | null;
  status: string;
  default_expense_account_id: string | null;
  payable_account_id: string | null;
  default_cost_center_id: string | null;
  notes: string | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export function serializePayrollContract(row: PayrollContractRow) {
  return {
    ...row,
    effective_from: dateStr(row.effective_from)!,
    effective_to: dateStr(row.effective_to),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export async function loadPayrollContract(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<PayrollContractRow> {
  const r = await txQuery<PayrollContractRow>(
    client,
    `SELECT * FROM accounts.payroll_contracts WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('العقد غير موجود', 404);
  return r.rows[0];
}

function optionalUuid(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)) {
    throw new AccountsHttpError('معرّف غير صالح', 400);
  }
  return s;
}

async function assertNoOtherActiveContract(
  client: TxClient,
  personId: string,
  exceptContractId: string | null
): Promise<void> {
  const r = await txQuery<{ id: string }>(
    client,
    `SELECT id FROM accounts.payroll_contracts
     WHERE payroll_person_id=$1::uuid AND status='ACTIVE'
       AND ($2::uuid IS NULL OR id<>$2::uuid)
     LIMIT 1`,
    [personId, exceptContractId]
  );
  if (r.rows[0]) {
    throw new AccountsHttpError('يوجد عقد أساسي فعّال آخر لهذا الشخص', 409);
  }
}

export async function createPayrollContract(
  client: TxClient,
  input: {
    payroll_person_id: unknown;
    contract_number?: unknown;
    compensation_basis: unknown;
    base_amount?: unknown;
    rate_amount?: unknown;
    currency_code?: unknown;
    effective_from: unknown;
    effective_to?: unknown;
    default_expense_account_id?: unknown;
    payable_account_id?: unknown;
    default_cost_center_id?: unknown;
    notes?: unknown;
    created_by: string;
  }
): Promise<PayrollContractRow> {
  const personId = optionalUuid(input.payroll_person_id);
  if (!personId) throw new AccountsHttpError('الشخص مطلوب', 400);
  await acquirePayrollLocks(client, [payrollPersonLock(personId)]);
  await loadPayrollPerson(client, personId); // 404 إن لم يوجد

  const from = requiredDate(input.effective_from, 'تاريخ بداية السريان');
  const to = optionalDate(input.effective_to, 'تاريخ نهاية السريان');
  assertEffectiveRange(from, to);

  const number = input.contract_number == null || String(input.contract_number).trim() === ''
    ? await nextPayrollNumber(client, 'PAYROLL_CONTRACT', 'PYC')
    : payrollCode(input.contract_number, 'رقم العقد');
  await assertPayrollCodeAvailable(client, 'payroll_contracts', 'contract_number', number, 'رقم العقد');

  const expenseId = await assertOptionalPostingAccount(client, optionalUuid(input.default_expense_account_id), 'حساب المصروف');
  const payableId = await assertOptionalPostingAccount(client, optionalUuid(input.payable_account_id), 'حساب الذمم الدائنة');
  const costCenterId = await assertOptionalCostCenter(client, optionalUuid(input.default_cost_center_id));

  const r = await txQuery<PayrollContractRow>(
    client,
    `INSERT INTO accounts.payroll_contracts
       (payroll_person_id, contract_number, compensation_basis, base_amount, rate_amount,
        currency_code, effective_from, effective_to, status,
        default_expense_account_id, payable_account_id, default_cost_center_id, notes,
        created_by, updated_by)
     VALUES ($1::uuid,$2,$3,$4::numeric,$5::numeric,$6,$7::date,$8::date,'DRAFT',
             $9::uuid,$10::uuid,$11::uuid,$12,$13::uuid,$13::uuid)
     RETURNING *`,
    [
      personId,
      number,
      oneOf(input.compensation_basis, PAYROLL_ENUMS.COMPENSATION_BASIS, 'أساس الاستحقاق'),
      nonNegativeMoney(input.base_amount, 'المبلغ الأساسي'),
      optionalNonNegativeMoney(input.rate_amount, 'المعدّل'),
      currencyCode(input.currency_code),
      from,
      to,
      expenseId,
      payableId,
      costCenterId,
      textOrNull(input.notes, 4000),
      input.created_by,
    ]
  );
  return r.rows[0];
}

export async function updatePayrollContract(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    compensation_basis?: unknown;
    base_amount?: unknown;
    rate_amount?: unknown;
    currency_code?: unknown;
    effective_from?: unknown;
    effective_to?: unknown;
    default_expense_account_id?: unknown;
    payable_account_id?: unknown;
    default_cost_center_id?: unknown;
    notes?: unknown;
  }
): Promise<PayrollContractRow> {
  const existing = await loadPayrollContract(client, p.id);
  await acquirePayrollLocks(client, [payrollPersonLock(existing.payroll_person_id), payrollContractLock(p.id)]);
  const row = await loadPayrollContract(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);
  if (row.status === 'CANCELLED' || row.status === 'TERMINATED' || row.status === 'EXPIRED') {
    throw new AccountsHttpError('لا يمكن تعديل عقد في حالة نهائية', 409);
  }

  const from = p.effective_from === undefined ? dateStr(row.effective_from)! : requiredDate(p.effective_from, 'تاريخ بداية السريان');
  const to = p.effective_to === undefined ? dateStr(row.effective_to) : optionalDate(p.effective_to, 'تاريخ نهاية السريان');
  assertEffectiveRange(from, to);

  const expenseId = p.default_expense_account_id === undefined ? row.default_expense_account_id : await assertOptionalPostingAccount(client, optionalUuid(p.default_expense_account_id), 'حساب المصروف');
  const payableId = p.payable_account_id === undefined ? row.payable_account_id : await assertOptionalPostingAccount(client, optionalUuid(p.payable_account_id), 'حساب الذمم الدائنة');
  const costCenterId = p.default_cost_center_id === undefined ? row.default_cost_center_id : await assertOptionalCostCenter(client, optionalUuid(p.default_cost_center_id));

  const r = await txQuery<PayrollContractRow>(
    client,
    `UPDATE accounts.payroll_contracts SET
       compensation_basis=$2, base_amount=$3::numeric, rate_amount=$4::numeric, currency_code=$5,
       effective_from=$6::date, effective_to=$7::date,
       default_expense_account_id=$8::uuid, payable_account_id=$9::uuid, default_cost_center_id=$10::uuid,
       notes=$11, updated_by=$12::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [
      row.id,
      p.compensation_basis === undefined ? row.compensation_basis : oneOf(p.compensation_basis, PAYROLL_ENUMS.COMPENSATION_BASIS, 'أساس الاستحقاق'),
      p.base_amount === undefined ? row.base_amount : nonNegativeMoney(p.base_amount, 'المبلغ الأساسي'),
      p.rate_amount === undefined ? row.rate_amount : optionalNonNegativeMoney(p.rate_amount, 'المعدّل'),
      p.currency_code === undefined ? row.currency_code : currencyCode(p.currency_code),
      from,
      to,
      expenseId,
      payableId,
      costCenterId,
      p.notes === undefined ? row.notes : textOrNull(p.notes, 4000),
      p.userId,
    ]
  );
  return r.rows[0];
}

type ContractAction = 'activate' | 'suspend' | 'terminate' | 'cancel';

const TARGET_STATUS: Record<ContractAction, string> = {
  activate: 'ACTIVE',
  suspend: 'SUSPENDED',
  terminate: 'TERMINATED',
  cancel: 'CANCELLED',
};

const CONTRACT_TRANSITIONS: Record<string, ContractAction[]> = {
  DRAFT: ['activate', 'cancel'],
  ACTIVE: ['suspend', 'terminate'],
  SUSPENDED: ['activate', 'terminate', 'cancel'],
  EXPIRED: ['cancel'],
  TERMINATED: [],
  CANCELLED: [],
};

export async function transitionPayrollContract(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    action: ContractAction;
  }
): Promise<PayrollContractRow> {
  const existing = await loadPayrollContract(client, p.id);
  await acquirePayrollLocks(client, [payrollPersonLock(existing.payroll_person_id), payrollContractLock(p.id)]);
  const row = await loadPayrollContract(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);

  const allowed = CONTRACT_TRANSITIONS[row.status] ?? [];
  if (!allowed.includes(p.action)) {
    throw new AccountsHttpError(`لا يمكن تنفيذ (${p.action}) على عقد في حالة ${row.status}`, 409);
  }

  if (p.action === 'activate') {
    const person = await loadPayrollPerson(client, row.payroll_person_id);
    if (person.status !== 'ACTIVE') {
      throw new AccountsHttpError('لا يمكن تفعيل عقد لشخص غير فعّال', 409);
    }
    // إعادة الفحص بعد حيازة قفل الشخص لمنع تفعيل عقدين متزامنين
    await assertNoOtherActiveContract(client, row.payroll_person_id, row.id);
  }

  const r = await txQuery<PayrollContractRow>(
    client,
    `UPDATE accounts.payroll_contracts SET status=$2, updated_by=$3::uuid,
       updated_at=NOW(), version=version+1 WHERE id=$1::uuid RETURNING *`,
    [row.id, TARGET_STATUS[p.action], p.userId]
  );
  return r.rows[0];
}

export async function listPayrollContracts(
  client: TxClient,
  p: {
    payroll_person_id?: string;
    status?: string;
    compensation_basis?: string;
    q?: string;
    page?: number;
    page_size?: number;
  }
): Promise<{ rows: PayrollContractRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(200, Math.max(1, p.page_size ?? 50));
  const person = (p.payroll_person_id ?? '').trim();
  const status = (p.status ?? '').trim().toUpperCase();
  const basis = (p.compensation_basis ?? '').trim().toUpperCase();
  const q = (p.q ?? '').trim();
  const values: unknown[] = [person, status, basis, q];
  const where = `WHERE ($1='' OR payroll_person_id=$1::uuid)
     AND ($2='' OR status=$2)
     AND ($3='' OR compensation_basis=$3)
     AND ($4='' OR contract_number ILIKE '%'||$4||'%')`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.payroll_contracts ${where}`,
    values
  );
  const r = await txQuery<PayrollContractRow>(
    client,
    `SELECT * FROM accounts.payroll_contracts ${where} ORDER BY contract_number LIMIT $5 OFFSET $6`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
