/** تكليفات الرواتب — 9.A.1 (مصادر استحقاق ومسؤوليات، ليست عقداً ثانياً) */
import { AccountsHttpError } from './auth';
import { payrollAssignmentLock, payrollContractLock, payrollPersonLock } from './accounting-locks';
import { acquirePayrollLocks } from './payroll-locks';
import { loadPayrollPerson } from './payroll-people';
import { loadPayrollContract } from './payroll-contracts';
import {
  PAYROLL_ENUMS,
  assertEffectiveRange,
  assertOptionalCostCenter,
  assertPayrollCodeAvailable,
  assertPayrollConcurrency,
  dateStr,
  iso,
  nextPayrollNumber,
  oneOf,
  optionalDate,
  payrollCode,
  requiredDate,
  requiredText,
  textOrNull,
} from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PayrollAssignmentRow = {
  id: string;
  payroll_person_id: string;
  payroll_contract_id: string | null;
  assignment_code: string;
  assignment_type: string;
  title_ar: string;
  title_en: string | null;
  department_id: string | null;
  cost_center_id: string | null;
  reference_type: string | null;
  reference_id: string | null;
  effective_from: string | Date;
  effective_to: string | Date | null;
  status: string;
  metadata_json: unknown;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export function serializePayrollAssignment(row: PayrollAssignmentRow) {
  return {
    ...row,
    effective_from: dateStr(row.effective_from)!,
    effective_to: dateStr(row.effective_to),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export async function loadPayrollAssignment(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<PayrollAssignmentRow> {
  const r = await txQuery<PayrollAssignmentRow>(
    client,
    `SELECT * FROM accounts.payroll_assignments WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('التكليف غير موجود', 404);
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

function metadataJson(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    try {
      JSON.parse(v);
      return v;
    } catch {
      throw new AccountsHttpError('metadata_json ليست JSON صالحة', 400);
    }
  }
  try {
    return JSON.stringify(v);
  } catch {
    throw new AccountsHttpError('metadata_json غير صالحة', 400);
  }
}

/** يتحقق أن العقد (إن وُجد) يعود للشخص نفسه وأنه صالح زمنياً للتكليف */
async function assertContractForPerson(
  client: TxClient,
  contractId: string | null,
  personId: string,
  from: string,
  to: string | null
): Promise<string | null> {
  if (!contractId) return null;
  const c = await loadPayrollContract(client, contractId);
  if (c.payroll_person_id !== personId) {
    throw new AccountsHttpError('العقد لا يعود للشخص نفسه', 400);
  }
  const cFrom = dateStr(c.effective_from)!;
  const cTo = dateStr(c.effective_to);
  if (from < cFrom) {
    throw new AccountsHttpError('تاريخ بداية التكليف يسبق بداية العقد', 400);
  }
  if (cTo != null && (to == null || to > cTo)) {
    throw new AccountsHttpError('فترة التكليف تتجاوز فترة صلاحية العقد', 400);
  }
  return c.id;
}

async function assertOptionalDepartment(
  client: TxClient,
  departmentId: string | null
): Promise<string | null> {
  if (!departmentId) return null;
  const r = await txQuery<{ id: string }>(
    client,
    `SELECT id FROM student_affairs.departments WHERE id=$1::uuid`,
    [departmentId]
  );
  if (!r.rows[0]) throw new AccountsHttpError('القسم المرتبط غير موجود', 404);
  return r.rows[0].id;
}

export async function createPayrollAssignment(
  client: TxClient,
  input: {
    payroll_person_id: unknown;
    payroll_contract_id?: unknown;
    assignment_code?: unknown;
    assignment_type: unknown;
    title_ar: unknown;
    title_en?: unknown;
    department_id?: unknown;
    cost_center_id?: unknown;
    reference_type?: unknown;
    reference_id?: unknown;
    effective_from: unknown;
    effective_to?: unknown;
    metadata_json?: unknown;
    created_by: string;
  }
): Promise<PayrollAssignmentRow> {
  const personId = optionalUuid(input.payroll_person_id);
  if (!personId) throw new AccountsHttpError('الشخص مطلوب', 400);
  const contractId = optionalUuid(input.payroll_contract_id);

  const locks = [payrollPersonLock(personId)];
  if (contractId) locks.push(payrollContractLock(contractId));
  await acquirePayrollLocks(client, locks);
  await loadPayrollPerson(client, personId);

  const from = requiredDate(input.effective_from, 'تاريخ بداية السريان');
  const to = optionalDate(input.effective_to, 'تاريخ نهاية السريان');
  assertEffectiveRange(from, to);
  const linkedContract = await assertContractForPerson(client, contractId, personId, from, to);

  const code = input.assignment_code == null || String(input.assignment_code).trim() === ''
    ? await nextPayrollNumber(client, 'PAYROLL_ASSIGNMENT', 'PYA')
    : payrollCode(input.assignment_code, 'رمز التكليف');
  await assertPayrollCodeAvailable(client, 'payroll_assignments', 'assignment_code', code, 'رمز التكليف');

  const departmentId = await assertOptionalDepartment(client, optionalUuid(input.department_id));
  const costCenterId = await assertOptionalCostCenter(client, optionalUuid(input.cost_center_id));

  const r = await txQuery<PayrollAssignmentRow>(
    client,
    `INSERT INTO accounts.payroll_assignments
       (payroll_person_id, payroll_contract_id, assignment_code, assignment_type, title_ar, title_en,
        department_id, cost_center_id, reference_type, reference_id, effective_from, effective_to,
        status, metadata_json, created_by, updated_by)
     VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8::uuid,$9,$10::uuid,$11::date,$12::date,
             'DRAFT',$13::jsonb,$14::uuid,$14::uuid)
     RETURNING *`,
    [
      personId,
      linkedContract,
      code,
      oneOf(input.assignment_type, PAYROLL_ENUMS.ASSIGNMENT_TYPE, 'نوع التكليف'),
      requiredText(input.title_ar, 200, 'عنوان التكليف بالعربية'),
      textOrNull(input.title_en, 200),
      departmentId,
      costCenterId,
      textOrNull(input.reference_type, 40),
      optionalUuid(input.reference_id),
      from,
      to,
      metadataJson(input.metadata_json),
      input.created_by,
    ]
  );
  return r.rows[0];
}

export async function updatePayrollAssignment(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    payroll_contract_id?: unknown;
    assignment_type?: unknown;
    title_ar?: unknown;
    title_en?: unknown;
    department_id?: unknown;
    cost_center_id?: unknown;
    reference_type?: unknown;
    reference_id?: unknown;
    effective_from?: unknown;
    effective_to?: unknown;
    metadata_json?: unknown;
  }
): Promise<PayrollAssignmentRow> {
  const existing = await loadPayrollAssignment(client, p.id);
  await acquirePayrollLocks(client, [payrollPersonLock(existing.payroll_person_id), payrollAssignmentLock(p.id)]);
  const row = await loadPayrollAssignment(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);

  const from = p.effective_from === undefined ? dateStr(row.effective_from)! : requiredDate(p.effective_from, 'تاريخ بداية السريان');
  const to = p.effective_to === undefined ? dateStr(row.effective_to) : optionalDate(p.effective_to, 'تاريخ نهاية السريان');
  assertEffectiveRange(from, to);

  const contractId = p.payroll_contract_id === undefined ? row.payroll_contract_id : optionalUuid(p.payroll_contract_id);
  const linkedContract = await assertContractForPerson(client, contractId, row.payroll_person_id, from, to);
  const departmentId = p.department_id === undefined ? row.department_id : await assertOptionalDepartment(client, optionalUuid(p.department_id));
  const costCenterId = p.cost_center_id === undefined ? row.cost_center_id : await assertOptionalCostCenter(client, optionalUuid(p.cost_center_id));

  const r = await txQuery<PayrollAssignmentRow>(
    client,
    `UPDATE accounts.payroll_assignments SET
       payroll_contract_id=$2::uuid, assignment_type=$3, title_ar=$4, title_en=$5,
       department_id=$6::uuid, cost_center_id=$7::uuid, reference_type=$8, reference_id=$9::uuid,
       effective_from=$10::date, effective_to=$11::date, metadata_json=$12::jsonb,
       updated_by=$13::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [
      row.id,
      linkedContract,
      p.assignment_type === undefined ? row.assignment_type : oneOf(p.assignment_type, PAYROLL_ENUMS.ASSIGNMENT_TYPE, 'نوع التكليف'),
      p.title_ar === undefined ? row.title_ar : requiredText(p.title_ar, 200, 'عنوان التكليف بالعربية'),
      p.title_en === undefined ? row.title_en : textOrNull(p.title_en, 200),
      departmentId,
      costCenterId,
      p.reference_type === undefined ? row.reference_type : textOrNull(p.reference_type, 40),
      p.reference_id === undefined ? row.reference_id : optionalUuid(p.reference_id),
      from,
      to,
      p.metadata_json === undefined ? (row.metadata_json == null ? null : JSON.stringify(row.metadata_json)) : metadataJson(p.metadata_json),
      p.userId,
    ]
  );
  return r.rows[0];
}

const ASSIGNMENT_TRANSITIONS: Record<string, Record<'activate' | 'deactivate', string | undefined>> = {
  DRAFT: { activate: 'ACTIVE', deactivate: 'ENDED' },
  ACTIVE: { activate: undefined, deactivate: 'SUSPENDED' },
  SUSPENDED: { activate: 'ACTIVE', deactivate: 'ENDED' },
  ENDED: { activate: undefined, deactivate: undefined },
};

export async function transitionPayrollAssignment(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    action: 'activate' | 'deactivate';
  }
): Promise<PayrollAssignmentRow> {
  const existing = await loadPayrollAssignment(client, p.id);
  await acquirePayrollLocks(client, [payrollPersonLock(existing.payroll_person_id), payrollAssignmentLock(p.id)]);
  const row = await loadPayrollAssignment(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);
  const target = ASSIGNMENT_TRANSITIONS[row.status]?.[p.action];
  if (!target) {
    throw new AccountsHttpError(`لا يمكن تنفيذ (${p.action}) على تكليف في حالة ${row.status}`, 409);
  }
  const r = await txQuery<PayrollAssignmentRow>(
    client,
    `UPDATE accounts.payroll_assignments SET status=$2, updated_by=$3::uuid,
       updated_at=NOW(), version=version+1 WHERE id=$1::uuid RETURNING *`,
    [row.id, target, p.userId]
  );
  return r.rows[0];
}

export async function listPayrollAssignments(
  client: TxClient,
  p: {
    payroll_person_id?: string;
    payroll_contract_id?: string;
    assignment_type?: string;
    status?: string;
    q?: string;
    page?: number;
    page_size?: number;
  }
): Promise<{ rows: PayrollAssignmentRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(200, Math.max(1, p.page_size ?? 50));
  const person = (p.payroll_person_id ?? '').trim();
  const contract = (p.payroll_contract_id ?? '').trim();
  const type = (p.assignment_type ?? '').trim().toUpperCase();
  const status = (p.status ?? '').trim().toUpperCase();
  const q = (p.q ?? '').trim();
  const values: unknown[] = [person, contract, type, status, q];
  const where = `WHERE ($1='' OR payroll_person_id=$1::uuid)
     AND ($2='' OR payroll_contract_id=$2::uuid)
     AND ($3='' OR assignment_type=$3)
     AND ($4='' OR status=$4)
     AND ($5='' OR assignment_code ILIKE '%'||$5||'%' OR title_ar ILIKE '%'||$5||'%')`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.payroll_assignments ${where}`,
    values
  );
  const r = await txQuery<PayrollAssignmentRow>(
    client,
    `SELECT * FROM accounts.payroll_assignments ${where} ORDER BY assignment_code LIMIT $6 OFFSET $7`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
