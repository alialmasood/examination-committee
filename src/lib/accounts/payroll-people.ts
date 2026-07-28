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
  academic_title: string | null;
  degree: string | null;
  phone: string | null;
  job_title: string | null;
  university_id: string | null;
  affiliation: string | null;
  job_classification: string | null;
  workplace: string | null;
  commencement_order_no: string | null;
  status: string;
  effective_from: string | Date;
  effective_to: string | Date | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  department_name_ar?: string | null;
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

export const ACADEMIC_TITLES = ['معيد', 'مدرس', 'مدرس مساعد', 'استاذ', 'استاذ مساعد'] as const;
export const DEGREES = [
  'يقرأ ويكتب',
  'ابتدائية',
  'متوسطة',
  'اعدادية',
  'دبلوم',
  'دبلوم عالي',
  'بكالوريوس',
  'ماجستير',
  'دكتوراه',
] as const;
export const JOB_CLASSIFICATIONS = ['فني', 'اداري', 'خدمي', 'حرفي'] as const;

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
    academic_title?: unknown;
    degree?: unknown;
    phone?: unknown;
    job_title?: unknown;
    university_id?: unknown;
    affiliation?: unknown;
    job_classification?: unknown;
    workplace?: unknown;
    commencement_order_no?: unknown;
    effective_from?: unknown;
    effective_to?: unknown;
    created_by: string;
  }
): Promise<PayrollPersonRow> {
  const from = requiredDate(
    input.effective_from ?? new Date().toISOString().slice(0, 10),
    'تاريخ المباشرة'
  );
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
        bank_account_name, bank_account_identifier_masked,
        academic_title, degree, phone, job_title, university_id, affiliation,
        job_classification, workplace, commencement_order_no,
        effective_from, effective_to, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9,$10,$11,$12,
             $13,$14,$15,$16,$17,$18,$19,$20,$21,$22::date,$23::date,$24::uuid,$24::uuid)
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
      optionalOneOf(input.academic_title, ACADEMIC_TITLES, 'اللقب العلمي'),
      optionalOneOf(input.degree, DEGREES, 'الشهادة'),
      textOrNull(input.phone, 40),
      textOrNull(input.job_title, 200),
      textOrNull(input.university_id, 64),
      textOrNull(input.affiliation, 200),
      optionalOneOf(input.job_classification, JOB_CLASSIFICATIONS, 'التوصيف الوظيفي'),
      textOrNull(input.workplace, 200),
      textOrNull(input.commencement_order_no, 100),
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
    academic_title?: unknown;
    degree?: unknown;
    phone?: unknown;
    job_title?: unknown;
    university_id?: unknown;
    affiliation?: unknown;
    job_classification?: unknown;
    workplace?: unknown;
    commencement_order_no?: unknown;
    effective_from?: unknown;
    effective_to?: unknown;
  }
): Promise<PayrollPersonRow> {
  await acquirePayrollLocks(client, [payrollPersonLock(p.id)]);
  const row = await loadPayrollPerson(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);

  const from = p.effective_from === undefined ? dateStr(row.effective_from)! : requiredDate(p.effective_from, 'تاريخ المباشرة');
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
       bank_account_identifier_masked=$12,
       academic_title=$13, degree=$14, phone=$15, job_title=$16, university_id=$17,
       affiliation=$18, job_classification=$19, workplace=$20, commencement_order_no=$21,
       effective_from=$22::date, effective_to=$23::date,
       updated_by=$24::uuid, updated_at=NOW(), version=version+1
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
      p.academic_title === undefined ? row.academic_title : optionalOneOf(p.academic_title, ACADEMIC_TITLES, 'اللقب العلمي'),
      p.degree === undefined ? row.degree : optionalOneOf(p.degree, DEGREES, 'الشهادة'),
      p.phone === undefined ? row.phone : textOrNull(p.phone, 40),
      p.job_title === undefined ? row.job_title : textOrNull(p.job_title, 200),
      p.university_id === undefined ? row.university_id : textOrNull(p.university_id, 64),
      p.affiliation === undefined ? row.affiliation : textOrNull(p.affiliation, 200),
      p.job_classification === undefined
        ? row.job_classification
        : optionalOneOf(p.job_classification, JOB_CLASSIFICATIONS, 'التوصيف الوظيفي'),
      p.workplace === undefined ? row.workplace : textOrNull(p.workplace, 200),
      p.commencement_order_no === undefined
        ? row.commencement_order_no
        : textOrNull(p.commencement_order_no, 100),
      from,
      to,
      p.userId,
    ]
  );
  return r.rows[0];
}

/** حذف شخص رواتب — يُمنع عند وجود تشغيلات؛ يُنظَّف إسناد المكوّنات غير التشغيلي تلقائياً */
export async function deletePayrollPerson(
  client: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<PayrollPersonRow> {
  await acquirePayrollLocks(client, [payrollPersonLock(p.id)]);
  const row = await loadPayrollPerson(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);

  const refs = await txQuery<{ src: string; n: number }>(
    client,
    `SELECT 'contracts' AS src, COUNT(*)::int AS n FROM accounts.payroll_contracts WHERE payroll_person_id=$1::uuid
     UNION ALL
     SELECT 'assignments', COUNT(*)::int FROM accounts.payroll_assignments WHERE payroll_person_id=$1::uuid
     UNION ALL
     SELECT 'component_assignments', COUNT(*)::int FROM accounts.payroll_component_assignments WHERE payroll_person_id=$1::uuid
     UNION ALL
     SELECT 'run_people', COUNT(*)::int FROM accounts.payroll_run_people WHERE payroll_person_id=$1::uuid
     UNION ALL
     SELECT 'run_scope', COUNT(*)::int FROM accounts.payroll_run_scope_members WHERE payroll_person_id=$1::uuid`,
    [p.id]
  );
  const countOf = (src: string) => refs.rows.find((x) => x.src === src)?.n ?? 0;

  const hasRuns = countOf('run_people') > 0 || countOf('run_scope') > 0;
  if (hasRuns) {
    const kindLabel: Record<string, string> = {
      TEACHING_STAFF: 'التدريسي',
      EXTERNAL_LECTURER: 'المحاضر',
      EMPLOYEE: 'الموظف',
      DAILY_WORKER: 'العامل اليومي',
      SERVICE_WORKER: 'عامل الخدمة',
    };
    const who = kindLabel[row.person_type] ?? 'الشخص';
    throw new AccountsHttpError(
      `لا يمكن حذف ${who} لوجود تشغيلات رواتب مرتبطة به. استخدم إنهاء الخدمة بدلاً من الحذف.`,
      409
    );
  }

  // لا توجد تشغيلات تاريخية: تنظيف إعدادات الرواتب التابعة قبل حذف الشخص.
  // الترتيب مهم بسبب مفاتيح FK: المكوّنات ← التكليفات ← العقود ← الشخص.
  if (countOf('component_assignments') > 0) {
    await txQuery(
      client,
      `DELETE FROM accounts.payroll_component_assignments WHERE payroll_person_id=$1::uuid`,
      [p.id]
    );
  }
  if (countOf('assignments') > 0) {
    await txQuery(
      client,
      `DELETE FROM accounts.payroll_assignments WHERE payroll_person_id=$1::uuid`,
      [p.id]
    );
  }
  if (countOf('contracts') > 0) {
    await txQuery(
      client,
      `DELETE FROM accounts.payroll_contracts WHERE payroll_person_id=$1::uuid`,
      [p.id]
    );
  }

  await txQuery(client, `DELETE FROM accounts.payroll_people WHERE id=$1::uuid`, [p.id]);
  return row;
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
  const where = `WHERE ($1='' OR p.person_code ILIKE '%'||$1||'%' OR p.full_name_ar ILIKE '%'||$1||'%'
        OR COALESCE(p.university_id,'') ILIKE '%'||$1||'%' OR COALESCE(p.phone,'') ILIKE '%'||$1||'%')
     AND ($2='' OR p.person_type=$2)
     AND ($3='' OR p.status=$3)
     AND (NOT $4::boolean OR p.status='ACTIVE')`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.payroll_people p ${where}`,
    values
  );
  const r = await txQuery<PayrollPersonRow>(
    client,
    `SELECT p.*, d.name_ar AS department_name_ar
     FROM accounts.payroll_people p
     LEFT JOIN student_affairs.departments d ON d.id = p.department_id
     ${where}
     ORDER BY p.created_at DESC, p.person_code
     LIMIT $5 OFFSET $6`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
