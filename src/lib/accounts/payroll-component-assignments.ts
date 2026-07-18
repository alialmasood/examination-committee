/** إسنادات مكوّنات الرواتب — 9.A.1 (ربط المكوّن بالشخص/العقد/التكليف) */
import { AccountsHttpError } from './auth';
import {
  payrollAssignmentLock,
  payrollComponentAssignmentLock,
  payrollComponentLock,
  payrollContractLock,
  payrollPersonLock,
} from './accounting-locks';
import { acquirePayrollLocks } from './payroll-locks';
import { loadPayrollPerson } from './payroll-people';
import { loadPayrollContract } from './payroll-contracts';
import { loadPayrollAssignment } from './payroll-assignments';
import { loadPayrollComponent } from './payroll-components';
import {
  PAYROLL_ENUMS,
  assertComponentAssignmentUnique,
  assertEffectiveRange,
  assertPayrollConcurrency,
  dateStr,
  iso,
  optionalDate,
  optionalNonNegativeMoney,
  optionalOneOf,
  optionalPercentage,
  optionalPositiveInt,
  rejectCustomFormula,
  requiredDate,
} from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PayrollComponentAssignmentRow = {
  id: string;
  payroll_person_id: string;
  payroll_contract_id: string | null;
  payroll_assignment_id: string | null;
  payroll_component_id: string;
  override_calculation_method: string | null;
  amount: string | null;
  rate: string | null;
  percentage: string | null;
  quantity: string | null;
  effective_from: string | Date;
  effective_to: string | Date | null;
  priority: number;
  is_active: boolean;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export function serializePayrollComponentAssignment(row: PayrollComponentAssignmentRow) {
  return {
    ...row,
    effective_from: dateStr(row.effective_from)!,
    effective_to: dateStr(row.effective_to),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export async function loadPayrollComponentAssignment(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<PayrollComponentAssignmentRow> {
  const r = await txQuery<PayrollComponentAssignmentRow>(
    client,
    `SELECT * FROM accounts.payroll_component_assignments WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('إسناد المكوّن غير موجود', 404);
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

async function validateLinks(
  client: TxClient,
  personId: string,
  contractId: string | null,
  assignmentId: string | null,
  componentId: string
): Promise<void> {
  if (contractId && assignmentId) {
    throw new AccountsHttpError('لا يمكن الربط بعقد وتكليف معاً — اختر مصدراً واحداً', 400);
  }
  await loadPayrollPerson(client, personId);
  await loadPayrollComponent(client, componentId);
  if (contractId) {
    const c = await loadPayrollContract(client, contractId);
    if (c.payroll_person_id !== personId) {
      throw new AccountsHttpError('العقد لا يعود للشخص نفسه', 400);
    }
  }
  if (assignmentId) {
    const a = await loadPayrollAssignment(client, assignmentId);
    if (a.payroll_person_id !== personId) {
      throw new AccountsHttpError('التكليف لا يعود للشخص نفسه', 400);
    }
  }
}

export async function createPayrollComponentAssignment(
  client: TxClient,
  input: {
    payroll_person_id: unknown;
    payroll_contract_id?: unknown;
    payroll_assignment_id?: unknown;
    payroll_component_id: unknown;
    override_calculation_method?: unknown;
    amount?: unknown;
    rate?: unknown;
    percentage?: unknown;
    quantity?: unknown;
    effective_from: unknown;
    effective_to?: unknown;
    priority?: unknown;
    created_by: string;
  }
): Promise<PayrollComponentAssignmentRow> {
  const personId = optionalUuid(input.payroll_person_id);
  if (!personId) throw new AccountsHttpError('الشخص مطلوب', 400);
  const componentId = optionalUuid(input.payroll_component_id);
  if (!componentId) throw new AccountsHttpError('المكوّن مطلوب', 400);
  const contractId = optionalUuid(input.payroll_contract_id);
  const assignmentId = optionalUuid(input.payroll_assignment_id);

  const locks = [payrollPersonLock(personId), payrollComponentLock(componentId)];
  if (contractId) locks.push(payrollContractLock(contractId));
  if (assignmentId) locks.push(payrollAssignmentLock(assignmentId));
  await acquirePayrollLocks(client, locks);

  await validateLinks(client, personId, contractId, assignmentId, componentId);

  const method = optionalOneOf(input.override_calculation_method, PAYROLL_ENUMS.CALCULATION_METHOD, 'طريقة الاحتساب البديلة');
  rejectCustomFormula(method);
  const from = requiredDate(input.effective_from, 'تاريخ بداية السريان');
  const to = optionalDate(input.effective_to, 'تاريخ نهاية السريان');
  assertEffectiveRange(from, to);

  // فحص خدمي مسبق للتكرار (409 نظيف) — القيد الفريد في القاعدة يبقى الحاسم ضد السباق.
  await assertComponentAssignmentUnique(client, {
    personId,
    componentId,
    contractId,
    assignmentId,
    effectiveFrom: from,
  });

  const r = await txQuery<PayrollComponentAssignmentRow>(
    client,
    `INSERT INTO accounts.payroll_component_assignments
       (payroll_person_id, payroll_contract_id, payroll_assignment_id, payroll_component_id,
        override_calculation_method, amount, rate, percentage, quantity,
        effective_from, effective_to, priority, created_by, updated_by)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::numeric,$7::numeric,$8::numeric,$9::numeric,
             $10::date,$11::date,$12,$13::uuid,$13::uuid)
     RETURNING *`,
    [
      personId,
      contractId,
      assignmentId,
      componentId,
      method,
      optionalNonNegativeMoney(input.amount, 'المبلغ'),
      optionalNonNegativeMoney(input.rate, 'المعدّل'),
      optionalPercentage(input.percentage, 'النسبة'),
      optionalNonNegativeMoney(input.quantity, 'الكمية'),
      from,
      to,
      optionalPositiveInt(input.priority, 'الأولوية', 100),
      input.created_by,
    ]
  );
  return r.rows[0];
}

export async function updatePayrollComponentAssignment(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    override_calculation_method?: unknown;
    amount?: unknown;
    rate?: unknown;
    percentage?: unknown;
    quantity?: unknown;
    effective_from?: unknown;
    effective_to?: unknown;
    priority?: unknown;
  }
): Promise<PayrollComponentAssignmentRow> {
  const existing = await loadPayrollComponentAssignment(client, p.id);
  await acquirePayrollLocks(client, [
    payrollPersonLock(existing.payroll_person_id),
    payrollComponentAssignmentLock(p.id),
  ]);
  const row = await loadPayrollComponentAssignment(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);

  const method = p.override_calculation_method === undefined
    ? row.override_calculation_method
    : optionalOneOf(p.override_calculation_method, PAYROLL_ENUMS.CALCULATION_METHOD, 'طريقة الاحتساب البديلة');
  rejectCustomFormula(method);
  const from = p.effective_from === undefined ? dateStr(row.effective_from)! : requiredDate(p.effective_from, 'تاريخ بداية السريان');
  const to = p.effective_to === undefined ? dateStr(row.effective_to) : optionalDate(p.effective_to, 'تاريخ نهاية السريان');
  assertEffectiveRange(from, to);

  const r = await txQuery<PayrollComponentAssignmentRow>(
    client,
    `UPDATE accounts.payroll_component_assignments SET
       override_calculation_method=$2, amount=$3::numeric, rate=$4::numeric, percentage=$5::numeric,
       quantity=$6::numeric, effective_from=$7::date, effective_to=$8::date, priority=$9,
       updated_by=$10::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [
      row.id,
      method,
      p.amount === undefined ? row.amount : optionalNonNegativeMoney(p.amount, 'المبلغ'),
      p.rate === undefined ? row.rate : optionalNonNegativeMoney(p.rate, 'المعدّل'),
      p.percentage === undefined ? row.percentage : optionalPercentage(p.percentage, 'النسبة'),
      p.quantity === undefined ? row.quantity : optionalNonNegativeMoney(p.quantity, 'الكمية'),
      from,
      to,
      p.priority === undefined ? row.priority : optionalPositiveInt(p.priority, 'الأولوية', row.priority),
      p.userId,
    ]
  );
  return r.rows[0];
}

export async function setPayrollComponentAssignmentActive(
  client: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown; active: boolean }
): Promise<PayrollComponentAssignmentRow> {
  const existing = await loadPayrollComponentAssignment(client, p.id);
  await acquirePayrollLocks(client, [
    payrollPersonLock(existing.payroll_person_id),
    payrollComponentAssignmentLock(p.id),
  ]);
  const row = await loadPayrollComponentAssignment(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);
  if (p.active === row.is_active) return row;
  const r = await txQuery<PayrollComponentAssignmentRow>(
    client,
    `UPDATE accounts.payroll_component_assignments SET is_active=$2, updated_by=$3::uuid,
       updated_at=NOW(), version=version+1 WHERE id=$1::uuid RETURNING *`,
    [row.id, p.active, p.userId]
  );
  return r.rows[0];
}

export async function listPayrollComponentAssignments(
  client: TxClient,
  p: {
    payroll_person_id?: string;
    payroll_component_id?: string;
    payroll_contract_id?: string;
    payroll_assignment_id?: string;
    active_only?: boolean;
    page?: number;
    page_size?: number;
  }
): Promise<{ rows: PayrollComponentAssignmentRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(200, Math.max(1, p.page_size ?? 50));
  const person = (p.payroll_person_id ?? '').trim();
  const component = (p.payroll_component_id ?? '').trim();
  const contract = (p.payroll_contract_id ?? '').trim();
  const assignment = (p.payroll_assignment_id ?? '').trim();
  const values: unknown[] = [person, component, contract, assignment, p.active_only ?? false];
  const where = `WHERE ($1='' OR payroll_person_id=$1::uuid)
     AND ($2='' OR payroll_component_id=$2::uuid)
     AND ($3='' OR payroll_contract_id=$3::uuid)
     AND ($4='' OR payroll_assignment_id=$4::uuid)
     AND (NOT $5::boolean OR is_active=TRUE)`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.payroll_component_assignments ${where}`,
    values
  );
  const r = await txQuery<PayrollComponentAssignmentRow>(
    client,
    `SELECT * FROM accounts.payroll_component_assignments ${where}
     ORDER BY priority, created_at LIMIT $6 OFFSET $7`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
