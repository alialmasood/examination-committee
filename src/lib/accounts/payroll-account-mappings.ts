/** خرائط الحسابات المحاسبية للرواتب — 9.A.1 (Mapping مرن بلا GL Hardcoded) */
import { AccountsHttpError } from './auth';
import { payrollMappingLock } from './accounting-locks';
import { acquirePayrollLocks } from './payroll-locks';
import {
  PAYROLL_ENUMS,
  assertEffectiveRange,
  assertOptionalCostCenter,
  assertOptionalPostingAccount,
  assertPayrollCodeAvailable,
  assertPayrollConcurrency,
  dateStr,
  iso,
  oneOf,
  optionalDate,
  optionalOneOf,
  optionalPositiveInt,
  payrollCode,
  requiredDate,
} from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PayrollAccountMappingRow = {
  id: string;
  mapping_code: string;
  mapping_scope: string;
  payroll_component_id: string | null;
  person_type: string | null;
  payroll_calendar_id: string | null;
  expense_account_id: string | null;
  liability_account_id: string | null;
  payable_account_id: string | null;
  rounding_account_id: string | null;
  cost_center_id: string | null;
  priority: number;
  effective_from: string | Date;
  effective_to: string | Date | null;
  is_active: boolean;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export function serializePayrollAccountMapping(row: PayrollAccountMappingRow) {
  return {
    ...row,
    effective_from: dateStr(row.effective_from)!,
    effective_to: dateStr(row.effective_to),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export async function loadPayrollAccountMapping(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<PayrollAccountMappingRow> {
  const r = await txQuery<PayrollAccountMappingRow>(
    client,
    `SELECT * FROM accounts.payroll_account_mappings WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('خريطة الحساب غير موجودة', 404);
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

type ResolvedFields = {
  scope: string;
  componentId: string | null;
  personType: string | null;
  calendarId: string | null;
  expenseId: string | null;
  liabilityId: string | null;
  payableId: string | null;
  roundingId: string | null;
};

/** يفرض متطلبات كل نطاق دون أي منطق مرتبط بأسماء المكوّنات أو أنواع الأشخاص */
function assertScopeShape(f: ResolvedFields): void {
  switch (f.scope) {
    case 'COMPONENT':
      if (!f.componentId) throw new AccountsHttpError('نطاق COMPONENT يتطلب مكوّناً', 400);
      break;
    case 'PERSON_TYPE':
      if (!f.personType) throw new AccountsHttpError('نطاق PERSON_TYPE يتطلب نوع شخص', 400);
      break;
    case 'CALENDAR':
      if (!f.calendarId) throw new AccountsHttpError('نطاق CALENDAR يتطلب تقويماً', 400);
      break;
    case 'ROUNDING':
      if (!f.roundingId) throw new AccountsHttpError('نطاق ROUNDING يتطلب حساب فروقات تقريب', 400);
      break;
    case 'DEFAULT':
      break;
  }
  const hasAnyAccount = Boolean(f.expenseId || f.liabilityId || f.payableId || f.roundingId);
  if (!hasAnyAccount) {
    throw new AccountsHttpError('يجب تحديد حساب محاسبي واحد على الأقل في الخريطة', 400);
  }
}

/** يمنع خريطة غامضة: نفس النطاق والمميّزات والأولوية مع فترة متداخلة */
async function assertNotAmbiguous(
  client: TxClient,
  f: ResolvedFields,
  priority: number,
  from: string,
  to: string | null,
  exceptId: string | null
): Promise<void> {
  const r = await txQuery<{ id: string }>(
    client,
    `SELECT id FROM accounts.payroll_account_mappings
     WHERE is_active=TRUE
       AND mapping_scope=$1
       AND priority=$2
       AND COALESCE(payroll_component_id,'00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(person_type,'') = COALESCE($4,'')
       AND COALESCE(payroll_calendar_id,'00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE($5::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
       AND ($6::uuid IS NULL OR id<>$6::uuid)
       AND daterange(effective_from, effective_to, '[]')
           && daterange($7::date, $8::date, '[]')
     LIMIT 1`,
    [f.scope, priority, f.componentId, f.personType, f.calendarId, exceptId, from, to]
  );
  if (r.rows[0]) {
    throw new AccountsHttpError(
      'خريطة غامضة: توجد خريطة فعّالة بنفس النطاق والمميّزات والأولوية وفترة متداخلة',
      409
    );
  }
}

async function resolveAndValidate(
  client: TxClient,
  scope: string,
  raw: {
    payroll_component_id?: unknown;
    person_type?: unknown;
    payroll_calendar_id?: unknown;
    expense_account_id?: unknown;
    liability_account_id?: unknown;
    payable_account_id?: unknown;
    rounding_account_id?: unknown;
    cost_center_id?: unknown;
  }
): Promise<ResolvedFields & { costCenterId: string | null }> {
  const componentId = optionalUuid(raw.payroll_component_id);
  const personType = optionalOneOf(raw.person_type, PAYROLL_ENUMS.PERSON_TYPE, 'نوع الشخص');
  const calendarId = optionalUuid(raw.payroll_calendar_id);
  if (componentId) {
    const c = await txQuery(client, `SELECT 1 FROM accounts.payroll_components WHERE id=$1::uuid`, [componentId]);
    if (!c.rows[0]) throw new AccountsHttpError('المكوّن المرتبط غير موجود', 404);
  }
  if (calendarId) {
    const c = await txQuery(client, `SELECT 1 FROM accounts.payroll_calendars WHERE id=$1::uuid`, [calendarId]);
    if (!c.rows[0]) throw new AccountsHttpError('التقويم المرتبط غير موجود', 404);
  }
  const expenseId = await assertOptionalPostingAccount(client, optionalUuid(raw.expense_account_id), 'حساب المصروف');
  const liabilityId = await assertOptionalPostingAccount(client, optionalUuid(raw.liability_account_id), 'حساب الالتزام');
  const payableId = await assertOptionalPostingAccount(client, optionalUuid(raw.payable_account_id), 'حساب الذمم الدائنة');
  const roundingId = await assertOptionalPostingAccount(client, optionalUuid(raw.rounding_account_id), 'حساب فروقات التقريب');
  const costCenterId = await assertOptionalCostCenter(client, optionalUuid(raw.cost_center_id));
  const fields: ResolvedFields = {
    scope,
    componentId,
    personType,
    calendarId,
    expenseId,
    liabilityId,
    payableId,
    roundingId,
  };
  assertScopeShape(fields);
  return { ...fields, costCenterId };
}

export async function createPayrollAccountMapping(
  client: TxClient,
  input: {
    mapping_code: unknown;
    mapping_scope: unknown;
    payroll_component_id?: unknown;
    person_type?: unknown;
    payroll_calendar_id?: unknown;
    expense_account_id?: unknown;
    liability_account_id?: unknown;
    payable_account_id?: unknown;
    rounding_account_id?: unknown;
    cost_center_id?: unknown;
    priority?: unknown;
    effective_from: unknown;
    effective_to?: unknown;
    created_by: string;
  }
): Promise<PayrollAccountMappingRow> {
  const scope = oneOf(input.mapping_scope, PAYROLL_ENUMS.MAPPING_SCOPE, 'نطاق الخريطة');
  const code = payrollCode(input.mapping_code, 'رمز الخريطة');
  await assertPayrollCodeAvailable(client, 'payroll_account_mappings', 'mapping_code', code, 'رمز الخريطة');
  const from = requiredDate(input.effective_from, 'تاريخ بداية السريان');
  const to = optionalDate(input.effective_to, 'تاريخ نهاية السريان');
  assertEffectiveRange(from, to);
  const priority = optionalPositiveInt(input.priority, 'الأولوية', 100);

  const f = await resolveAndValidate(client, scope, input);
  await assertNotAmbiguous(client, f, priority, from, to, null);

  const r = await txQuery<PayrollAccountMappingRow>(
    client,
    `INSERT INTO accounts.payroll_account_mappings
       (mapping_code, mapping_scope, payroll_component_id, person_type, payroll_calendar_id,
        expense_account_id, liability_account_id, payable_account_id, rounding_account_id, cost_center_id,
        priority, effective_from, effective_to, created_by, updated_by)
     VALUES ($1,$2,$3::uuid,$4,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9::uuid,$10::uuid,$11,$12::date,$13::date,$14::uuid,$14::uuid)
     RETURNING *`,
    [
      code,
      scope,
      f.componentId,
      f.personType,
      f.calendarId,
      f.expenseId,
      f.liabilityId,
      f.payableId,
      f.roundingId,
      f.costCenterId,
      priority,
      from,
      to,
      input.created_by,
    ]
  );
  return r.rows[0];
}

export async function updatePayrollAccountMapping(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    mapping_scope?: unknown;
    payroll_component_id?: unknown;
    person_type?: unknown;
    payroll_calendar_id?: unknown;
    expense_account_id?: unknown;
    liability_account_id?: unknown;
    payable_account_id?: unknown;
    rounding_account_id?: unknown;
    cost_center_id?: unknown;
    priority?: unknown;
    effective_from?: unknown;
    effective_to?: unknown;
  }
): Promise<PayrollAccountMappingRow> {
  await acquirePayrollLocks(client, [payrollMappingLock(p.id)]);
  const row = await loadPayrollAccountMapping(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);

  const scope = p.mapping_scope === undefined ? row.mapping_scope : oneOf(p.mapping_scope, PAYROLL_ENUMS.MAPPING_SCOPE, 'نطاق الخريطة');
  const from = p.effective_from === undefined ? dateStr(row.effective_from)! : requiredDate(p.effective_from, 'تاريخ بداية السريان');
  const to = p.effective_to === undefined ? dateStr(row.effective_to) : optionalDate(p.effective_to, 'تاريخ نهاية السريان');
  assertEffectiveRange(from, to);
  const priority = p.priority === undefined ? row.priority : optionalPositiveInt(p.priority, 'الأولوية', row.priority);

  const f = await resolveAndValidate(client, scope, {
    payroll_component_id: p.payroll_component_id === undefined ? row.payroll_component_id : p.payroll_component_id,
    person_type: p.person_type === undefined ? row.person_type : p.person_type,
    payroll_calendar_id: p.payroll_calendar_id === undefined ? row.payroll_calendar_id : p.payroll_calendar_id,
    expense_account_id: p.expense_account_id === undefined ? row.expense_account_id : p.expense_account_id,
    liability_account_id: p.liability_account_id === undefined ? row.liability_account_id : p.liability_account_id,
    payable_account_id: p.payable_account_id === undefined ? row.payable_account_id : p.payable_account_id,
    rounding_account_id: p.rounding_account_id === undefined ? row.rounding_account_id : p.rounding_account_id,
    cost_center_id: p.cost_center_id === undefined ? row.cost_center_id : p.cost_center_id,
  });
  await assertNotAmbiguous(client, f, priority, from, to, row.id);

  const r = await txQuery<PayrollAccountMappingRow>(
    client,
    `UPDATE accounts.payroll_account_mappings SET
       mapping_scope=$2, payroll_component_id=$3::uuid, person_type=$4, payroll_calendar_id=$5::uuid,
       expense_account_id=$6::uuid, liability_account_id=$7::uuid, payable_account_id=$8::uuid,
       rounding_account_id=$9::uuid, cost_center_id=$10::uuid, priority=$11,
       effective_from=$12::date, effective_to=$13::date,
       updated_by=$14::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [
      row.id,
      scope,
      f.componentId,
      f.personType,
      f.calendarId,
      f.expenseId,
      f.liabilityId,
      f.payableId,
      f.roundingId,
      f.costCenterId,
      priority,
      from,
      to,
      p.userId,
    ]
  );
  return r.rows[0];
}

export async function setPayrollAccountMappingActive(
  client: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown; active: boolean }
): Promise<PayrollAccountMappingRow> {
  await acquirePayrollLocks(client, [payrollMappingLock(p.id)]);
  const row = await loadPayrollAccountMapping(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);
  if (p.active === row.is_active) return row;
  if (p.active) {
    // إعادة تفعيل قد تُنشئ غموضاً — افحص أولاً
    await assertNotAmbiguous(
      client,
      {
        scope: row.mapping_scope,
        componentId: row.payroll_component_id,
        personType: row.person_type,
        calendarId: row.payroll_calendar_id,
        expenseId: row.expense_account_id,
        liabilityId: row.liability_account_id,
        payableId: row.payable_account_id,
        roundingId: row.rounding_account_id,
      },
      row.priority,
      dateStr(row.effective_from)!,
      dateStr(row.effective_to),
      row.id
    );
  }
  const r = await txQuery<PayrollAccountMappingRow>(
    client,
    `UPDATE accounts.payroll_account_mappings SET is_active=$2, updated_by=$3::uuid,
       updated_at=NOW(), version=version+1 WHERE id=$1::uuid RETURNING *`,
    [row.id, p.active, p.userId]
  );
  return r.rows[0];
}

export async function listPayrollAccountMappings(
  client: TxClient,
  p: {
    q?: string;
    mapping_scope?: string;
    active_only?: boolean;
    page?: number;
    page_size?: number;
  }
): Promise<{ rows: PayrollAccountMappingRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(200, Math.max(1, p.page_size ?? 50));
  const q = (p.q ?? '').trim();
  const scope = (p.mapping_scope ?? '').trim().toUpperCase();
  const values: unknown[] = [q, scope, p.active_only ?? false];
  const where = `WHERE ($1='' OR mapping_code ILIKE '%'||$1||'%')
     AND ($2='' OR mapping_scope=$2)
     AND (NOT $3::boolean OR is_active=TRUE)`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.payroll_account_mappings ${where}`,
    values
  );
  const r = await txQuery<PayrollAccountMappingRow>(
    client,
    `SELECT * FROM accounts.payroll_account_mappings ${where}
     ORDER BY mapping_scope, priority, mapping_code LIMIT $4 OFFSET $5`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
