/** سجل أشخاص الرواتب — 9.A.1 (مستقل عن HR) */
import { AccountsHttpError } from './auth';
import { payrollPersonLock } from './accounting-locks';
import { acquirePayrollLocks } from './payroll-locks';
import {
  PAYROLL_ENUMS,
  assertEffectiveRange,
  assertOptionalCostCenter,
  assertPayrollCodeAvailable,
  assertPayrollConcurrency,
  currencyCode,
  dateStr,
  iso,
  nextPayrollNumber,
  oneOf,
  optionalDate,
  optionalOneOf,
  payrollCode,
  requiredDate,
  requiredReason,
  requiredText,
  textOrNull,
} from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PayrollPersonRow = {
  id: string;
  person_code: string;
  full_name_ar: string;
  full_name_en: string | null;
  person_type: string;
  hr_person_id: string | null;
  user_id: string | null;
  department_id: string | null;
  default_cost_center_id: string | null;
  default_currency_code: string;
  payment_method: string | null;
  bank_account_name: string | null;
  bank_account_identifier_masked: string | null;
  status: string;
  effective_from: string | Date;
  effective_to: string | Date | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

/** إخفاء المعرّف المصرفي: يُبقى آخر 4 خانات فقط */
function maskBankIdentifier(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const clean = s.replace(/\s+/g, '');
  if (clean.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, clean.length - 4))}${clean.slice(-4)}`.slice(0, 60);
}

/** تسلسل كامل (تفاصيل الشخص) — يتضمن الحقول المصرفية المقنّعة فقط */
export function serializePayrollPerson(row: PayrollPersonRow) {
  return {
    ...row,
    effective_from: dateStr(row.effective_from)!,
    effective_to: dateStr(row.effective_to),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

/** تسلسل القائمة — لا يُرجِع أي بيانات مصرفية إطلاقاً */
export function serializePayrollPersonListItem(row: PayrollPersonRow) {
  const full = serializePayrollPerson(row);
  const {
    bank_account_name: _bankName,
    bank_account_identifier_masked: _bankId,
    ...rest
  } = full;
  void _bankName;
  void _bankId;
  return rest;
}

export async function loadPayrollPerson(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<PayrollPersonRow> {
  const r = await txQuery<PayrollPersonRow>(
    client,
    `SELECT * FROM accounts.payroll_people WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('الشخص غير موجود', 404);
  return r.rows[0];
}

async function assertOptionalUser(client: TxClient, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const r = await txQuery<{ id: string; is_active: boolean }>(
    client,
    `SELECT id, is_active FROM student_affairs.users WHERE id=$1::uuid`,
    [userId]
  );
  if (!r.rows[0]) throw new AccountsHttpError('المستخدم المرتبط غير موجود', 404);
  if (!r.rows[0].is_active) throw new AccountsHttpError('المستخدم المرتبط غير نشط', 400);
  return r.rows[0].id;
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

function optionalUuid(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)) {
    throw new AccountsHttpError('معرّف غير صالح', 400);
  }
  return s;
}

export async function createPayrollPerson(
  client: TxClient,
  input: {
    person_code?: unknown;
    full_name_ar: unknown;
    full_name_en?: unknown;
    person_type: unknown;
    hr_person_id?: unknown;
    user_id?: unknown;
    department_id?: unknown;
    default_cost_center_id?: unknown;
    default_currency_code?: unknown;
    payment_method?: unknown;
    bank_account_name?: unknown;
    bank_account_identifier?: unknown;
    bank_account_identifier_masked?: unknown;
    effective_from: unknown;
    effective_to?: unknown;
    created_by: string;
  }
): Promise<PayrollPersonRow> {
  const from = requiredDate(input.effective_from, 'تاريخ بداية السريان');
  const to = optionalDate(input.effective_to, 'تاريخ نهاية السريان');
  assertEffectiveRange(from, to);

  const code = input.person_code == null || String(input.person_code).trim() === ''
    ? await nextPayrollNumber(client, 'PAYROLL_PERSON', 'PYP')
    : payrollCode(input.person_code, 'رمز الشخص');
  await assertPayrollCodeAvailable(client, 'payroll_people', 'person_code', code, 'رمز الشخص');

  const userId = await assertOptionalUser(client, optionalUuid(input.user_id));
  const departmentId = await assertOptionalDepartment(client, optionalUuid(input.department_id));
  const costCenterId = await assertOptionalCostCenter(client, optionalUuid(input.default_cost_center_id));

  const maskedFromRaw = maskBankIdentifier(input.bank_account_identifier);
  const masked = maskedFromRaw ?? textOrNull(input.bank_account_identifier_masked, 60);

  const r = await txQuery<PayrollPersonRow>(
    client,
    `INSERT INTO accounts.payroll_people
       (person_code, full_name_ar, full_name_en, person_type, hr_person_id, user_id,
        department_id, default_cost_center_id, default_currency_code, payment_method,
        bank_account_name, bank_account_identifier_masked, effective_from, effective_to,
        created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9,$10,$11,$12,$13::date,$14::date,$15::uuid,$15::uuid)
     RETURNING *`,
    [
      code,
      requiredText(input.full_name_ar, 200, 'الاسم بالعربية'),
      textOrNull(input.full_name_en, 200),
      oneOf(input.person_type, PAYROLL_ENUMS.PERSON_TYPE, 'نوع الشخص'),
      optionalUuid(input.hr_person_id),
      userId,
      departmentId,
      costCenterId,
      currencyCode(input.default_currency_code),
      optionalOneOf(input.payment_method, PAYROLL_ENUMS.PAYMENT_METHOD, 'طريقة الدفع'),
      textOrNull(input.bank_account_name, 200),
      masked,
      from,
      to,
      input.created_by,
    ]
  );
  return r.rows[0];
}

export async function updatePayrollPerson(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    full_name_ar?: unknown;
    full_name_en?: unknown;
    person_type?: unknown;
    hr_person_id?: unknown;
    user_id?: unknown;
    department_id?: unknown;
    default_cost_center_id?: unknown;
    default_currency_code?: unknown;
    payment_method?: unknown;
    bank_account_name?: unknown;
    bank_account_identifier?: unknown;
    bank_account_identifier_masked?: unknown;
    effective_from?: unknown;
    effective_to?: unknown;
  }
): Promise<PayrollPersonRow> {
  await acquirePayrollLocks(client, [payrollPersonLock(p.id)]);
  const row = await loadPayrollPerson(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);

  const from = p.effective_from === undefined ? dateStr(row.effective_from)! : requiredDate(p.effective_from, 'تاريخ بداية السريان');
  const to = p.effective_to === undefined ? dateStr(row.effective_to) : optionalDate(p.effective_to, 'تاريخ نهاية السريان');
  assertEffectiveRange(from, to);

  const userId = p.user_id === undefined ? row.user_id : await assertOptionalUser(client, optionalUuid(p.user_id));
  const departmentId = p.department_id === undefined ? row.department_id : await assertOptionalDepartment(client, optionalUuid(p.department_id));
  const costCenterId = p.default_cost_center_id === undefined ? row.default_cost_center_id : await assertOptionalCostCenter(client, optionalUuid(p.default_cost_center_id));

  let masked = row.bank_account_identifier_masked;
  if (p.bank_account_identifier !== undefined) {
    masked = maskBankIdentifier(p.bank_account_identifier);
  } else if (p.bank_account_identifier_masked !== undefined) {
    masked = textOrNull(p.bank_account_identifier_masked, 60);
  }

  const r = await txQuery<PayrollPersonRow>(
    client,
    `UPDATE accounts.payroll_people SET
       full_name_ar=$2, full_name_en=$3, person_type=$4, hr_person_id=$5::uuid,
       user_id=$6::uuid, department_id=$7::uuid, default_cost_center_id=$8::uuid,
       default_currency_code=$9, payment_method=$10, bank_account_name=$11,
       bank_account_identifier_masked=$12, effective_from=$13::date, effective_to=$14::date,
       updated_by=$15::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [
      row.id,
      p.full_name_ar === undefined ? row.full_name_ar : requiredText(p.full_name_ar, 200, 'الاسم بالعربية'),
      p.full_name_en === undefined ? row.full_name_en : textOrNull(p.full_name_en, 200),
      p.person_type === undefined ? row.person_type : oneOf(p.person_type, PAYROLL_ENUMS.PERSON_TYPE, 'نوع الشخص'),
      p.hr_person_id === undefined ? row.hr_person_id : optionalUuid(p.hr_person_id),
      userId,
      departmentId,
      costCenterId,
      p.default_currency_code === undefined ? row.default_currency_code : currencyCode(p.default_currency_code),
      p.payment_method === undefined ? row.payment_method : optionalOneOf(p.payment_method, PAYROLL_ENUMS.PAYMENT_METHOD, 'طريقة الدفع'),
      p.bank_account_name === undefined ? row.bank_account_name : textOrNull(p.bank_account_name, 200),
      masked,
      from,
      to,
      p.userId,
    ]
  );
  return r.rows[0];
}

/** انتقالات الحالة المسموح بها */
const PERSON_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ['SUSPENDED', 'TERMINATED', 'INACTIVE'],
  SUSPENDED: ['ACTIVE', 'TERMINATED', 'INACTIVE'],
  INACTIVE: ['ACTIVE', 'TERMINATED'],
  TERMINATED: [],
};

export async function setPayrollPersonStatus(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    target: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED' | 'INACTIVE';
    reason?: unknown;
  }
): Promise<PayrollPersonRow> {
  // إنهاء الخدمة فعل حساس — السبب إلزامي (H2). يُسجَّل في Audit فقط.
  if (p.target === 'TERMINATED') requiredReason(p.reason, 'سبب إنهاء الخدمة');
  await acquirePayrollLocks(client, [payrollPersonLock(p.id)]);
  const row = await loadPayrollPerson(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);
  if (row.status === p.target) return row;
  const allowed = PERSON_TRANSITIONS[row.status] ?? [];
  if (!allowed.includes(p.target)) {
    throw new AccountsHttpError(`لا يمكن نقل الحالة من ${row.status} إلى ${p.target}`, 409);
  }
  const r = await txQuery<PayrollPersonRow>(
    client,
    `UPDATE accounts.payroll_people SET status=$2, updated_by=$3::uuid,
       updated_at=NOW(), version=version+1 WHERE id=$1::uuid RETURNING *`,
    [row.id, p.target, p.userId]
  );
  return r.rows[0];
}

export async function listPayrollPeople(
  client: TxClient,
  p: {
    q?: string;
    person_type?: string;
    status?: string;
    active_only?: boolean;
    page?: number;
    page_size?: number;
  }
): Promise<{ rows: PayrollPersonRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(200, Math.max(1, p.page_size ?? 50));
  const q = (p.q ?? '').trim();
  const type = (p.person_type ?? '').trim().toUpperCase();
  const status = (p.status ?? '').trim().toUpperCase();
  const values: unknown[] = [q, type, status, p.active_only ?? false];
  const where = `WHERE ($1='' OR person_code ILIKE '%'||$1||'%' OR full_name_ar ILIKE '%'||$1||'%')
     AND ($2='' OR person_type=$2)
     AND ($3='' OR status=$3)
     AND (NOT $4::boolean OR status='ACTIVE')`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.payroll_people ${where}`,
    values
  );
  const r = await txQuery<PayrollPersonRow>(
    client,
    `SELECT * FROM accounts.payroll_people ${where} ORDER BY person_code LIMIT $5 OFFSET $6`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
