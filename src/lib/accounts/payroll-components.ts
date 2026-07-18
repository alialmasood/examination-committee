/** مكوّنات الرواتب — 9.A.1 (Component Configuration مصدر السلوك) */
import { AccountsHttpError } from './auth';
import { payrollComponentLock } from './accounting-locks';
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
  optionalNonNegativeMoney,
  optionalPercentage,
  payrollCode,
  rejectCustomFormula,
  requiredText,
  textOrNull,
} from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PayrollComponentRow = {
  id: string;
  component_code: string;
  name_ar: string;
  name_en: string | null;
  component_type: string;
  calculation_method: string;
  default_amount: string | null;
  default_rate: string | null;
  default_percentage: string | null;
  expense_account_id: string | null;
  liability_account_id: string | null;
  default_cost_center_id: string | null;
  is_taxable: boolean;
  is_pensionable: boolean;
  show_on_payslip: boolean;
  allow_manual_override: boolean;
  is_system_seeded: boolean;
  is_active: boolean;
  effective_from: string | Date;
  effective_to: string | Date | null;
  minimum_amount: string | null;
  maximum_amount: string | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export function serializePayrollComponent(row: PayrollComponentRow) {
  return {
    ...row,
    effective_from: dateStr(row.effective_from)!,
    effective_to: dateStr(row.effective_to),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export async function loadPayrollComponent(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<PayrollComponentRow> {
  const r = await txQuery<PayrollComponentRow>(
    client,
    `SELECT * FROM accounts.payroll_components WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('المكوّن غير موجود', 404);
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

function bool(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function assertMinMax(min: string | null, max: string | null): void {
  if (min != null && max != null && Number(max) < Number(min)) {
    throw new AccountsHttpError('الحد الأقصى لا يمكن أن يكون أقل من الحد الأدنى', 400);
  }
}

export async function createPayrollComponent(
  client: TxClient,
  input: {
    component_code: unknown;
    name_ar: unknown;
    name_en?: unknown;
    component_type: unknown;
    calculation_method: unknown;
    default_amount?: unknown;
    default_rate?: unknown;
    default_percentage?: unknown;
    expense_account_id?: unknown;
    liability_account_id?: unknown;
    default_cost_center_id?: unknown;
    is_taxable?: unknown;
    is_pensionable?: unknown;
    show_on_payslip?: unknown;
    allow_manual_override?: unknown;
    is_system_seeded?: boolean;
    effective_from: unknown;
    effective_to?: unknown;
    minimum_amount?: unknown;
    maximum_amount?: unknown;
    created_by: string;
  }
): Promise<PayrollComponentRow> {
  const method = oneOf(input.calculation_method, PAYROLL_ENUMS.CALCULATION_METHOD, 'طريقة الاحتساب');
  rejectCustomFormula(method);
  const componentCode = payrollCode(input.component_code, 'رمز المكوّن');
  await assertPayrollCodeAvailable(client, 'payroll_components', 'component_code', componentCode, 'رمز المكوّن');
  const from = oneOfDate(input.effective_from);
  const to = optionalDate(input.effective_to, 'تاريخ نهاية السريان');
  assertEffectiveRange(from, to);
  const min = optionalNonNegativeMoney(input.minimum_amount, 'الحد الأدنى');
  const max = optionalNonNegativeMoney(input.maximum_amount, 'الحد الأقصى');
  assertMinMax(min, max);

  const expenseId = await assertOptionalPostingAccount(client, optionalUuid(input.expense_account_id), 'حساب المصروف');
  const liabilityId = await assertOptionalPostingAccount(client, optionalUuid(input.liability_account_id), 'حساب الالتزام');
  const costCenterId = await assertOptionalCostCenter(client, optionalUuid(input.default_cost_center_id));

  const r = await txQuery<PayrollComponentRow>(
    client,
    `INSERT INTO accounts.payroll_components
       (component_code, name_ar, name_en, component_type, calculation_method,
        default_amount, default_rate, default_percentage, expense_account_id, liability_account_id,
        default_cost_center_id, is_taxable, is_pensionable, show_on_payslip, allow_manual_override,
        is_system_seeded, effective_from, effective_to, minimum_amount, maximum_amount,
        created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8::numeric,$9::uuid,$10::uuid,
             $11::uuid,$12,$13,$14,$15,$16,$17::date,$18::date,$19::numeric,$20::numeric,$21::uuid,$21::uuid)
     RETURNING *`,
    [
      componentCode,
      requiredText(input.name_ar, 200, 'اسم المكوّن بالعربية'),
      textOrNull(input.name_en, 200),
      oneOf(input.component_type, PAYROLL_ENUMS.COMPONENT_TYPE, 'نوع المكوّن'),
      method,
      optionalNonNegativeMoney(input.default_amount, 'المبلغ الافتراضي'),
      optionalNonNegativeMoney(input.default_rate, 'المعدّل الافتراضي'),
      optionalPercentage(input.default_percentage, 'النسبة الافتراضية'),
      expenseId,
      liabilityId,
      costCenterId,
      bool(input.is_taxable, false),
      bool(input.is_pensionable, false),
      bool(input.show_on_payslip, true),
      bool(input.allow_manual_override, false),
      input.is_system_seeded === true,
      from,
      to,
      min,
      max,
      input.created_by,
    ]
  );
  return r.rows[0];
}

function oneOfDate(v: unknown): string {
  const s = String(v ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(s).getTime())) {
    throw new AccountsHttpError('تاريخ بداية السريان غير صالح (الصيغة YYYY-MM-DD)', 400);
  }
  return s;
}

export async function updatePayrollComponent(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    name_ar?: unknown;
    name_en?: unknown;
    component_type?: unknown;
    calculation_method?: unknown;
    default_amount?: unknown;
    default_rate?: unknown;
    default_percentage?: unknown;
    expense_account_id?: unknown;
    liability_account_id?: unknown;
    default_cost_center_id?: unknown;
    is_taxable?: unknown;
    is_pensionable?: unknown;
    show_on_payslip?: unknown;
    allow_manual_override?: unknown;
    effective_from?: unknown;
    effective_to?: unknown;
    minimum_amount?: unknown;
    maximum_amount?: unknown;
  }
): Promise<PayrollComponentRow> {
  await acquirePayrollLocks(client, [payrollComponentLock(p.id)]);
  const row = await loadPayrollComponent(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);

  const method = p.calculation_method === undefined ? row.calculation_method : oneOf(p.calculation_method, PAYROLL_ENUMS.CALCULATION_METHOD, 'طريقة الاحتساب');
  rejectCustomFormula(method);
  const from = p.effective_from === undefined ? dateStr(row.effective_from)! : oneOfDate(p.effective_from);
  const to = p.effective_to === undefined ? dateStr(row.effective_to) : optionalDate(p.effective_to, 'تاريخ نهاية السريان');
  assertEffectiveRange(from, to);
  const min = p.minimum_amount === undefined ? row.minimum_amount : optionalNonNegativeMoney(p.minimum_amount, 'الحد الأدنى');
  const max = p.maximum_amount === undefined ? row.maximum_amount : optionalNonNegativeMoney(p.maximum_amount, 'الحد الأقصى');
  assertMinMax(min, max);

  const expenseId = p.expense_account_id === undefined ? row.expense_account_id : await assertOptionalPostingAccount(client, optionalUuid(p.expense_account_id), 'حساب المصروف');
  const liabilityId = p.liability_account_id === undefined ? row.liability_account_id : await assertOptionalPostingAccount(client, optionalUuid(p.liability_account_id), 'حساب الالتزام');
  const costCenterId = p.default_cost_center_id === undefined ? row.default_cost_center_id : await assertOptionalCostCenter(client, optionalUuid(p.default_cost_center_id));

  const r = await txQuery<PayrollComponentRow>(
    client,
    `UPDATE accounts.payroll_components SET
       name_ar=$2, name_en=$3, component_type=$4, calculation_method=$5,
       default_amount=$6::numeric, default_rate=$7::numeric, default_percentage=$8::numeric,
       expense_account_id=$9::uuid, liability_account_id=$10::uuid, default_cost_center_id=$11::uuid,
       is_taxable=$12, is_pensionable=$13, show_on_payslip=$14, allow_manual_override=$15,
       effective_from=$16::date, effective_to=$17::date, minimum_amount=$18::numeric, maximum_amount=$19::numeric,
       updated_by=$20::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [
      row.id,
      p.name_ar === undefined ? row.name_ar : requiredText(p.name_ar, 200, 'اسم المكوّن بالعربية'),
      p.name_en === undefined ? row.name_en : textOrNull(p.name_en, 200),
      p.component_type === undefined ? row.component_type : oneOf(p.component_type, PAYROLL_ENUMS.COMPONENT_TYPE, 'نوع المكوّن'),
      method,
      p.default_amount === undefined ? row.default_amount : optionalNonNegativeMoney(p.default_amount, 'المبلغ الافتراضي'),
      p.default_rate === undefined ? row.default_rate : optionalNonNegativeMoney(p.default_rate, 'المعدّل الافتراضي'),
      p.default_percentage === undefined ? row.default_percentage : optionalPercentage(p.default_percentage, 'النسبة الافتراضية'),
      expenseId,
      liabilityId,
      costCenterId,
      p.is_taxable === undefined ? row.is_taxable : bool(p.is_taxable, row.is_taxable),
      p.is_pensionable === undefined ? row.is_pensionable : bool(p.is_pensionable, row.is_pensionable),
      p.show_on_payslip === undefined ? row.show_on_payslip : bool(p.show_on_payslip, row.show_on_payslip),
      p.allow_manual_override === undefined ? row.allow_manual_override : bool(p.allow_manual_override, row.allow_manual_override),
      from,
      to,
      min,
      max,
      p.userId,
    ]
  );
  return r.rows[0];
}

export async function setPayrollComponentActive(
  client: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown; active: boolean }
): Promise<PayrollComponentRow> {
  await acquirePayrollLocks(client, [payrollComponentLock(p.id)]);
  const row = await loadPayrollComponent(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);
  if (p.active === row.is_active) return row;
  const r = await txQuery<PayrollComponentRow>(
    client,
    `UPDATE accounts.payroll_components SET is_active=$2, updated_by=$3::uuid,
       updated_at=NOW(), version=version+1 WHERE id=$1::uuid RETURNING *`,
    [row.id, p.active, p.userId]
  );
  return r.rows[0];
}

export async function listPayrollComponents(
  client: TxClient,
  p: {
    q?: string;
    component_type?: string;
    calculation_method?: string;
    active_only?: boolean;
    page?: number;
    page_size?: number;
  }
): Promise<{ rows: PayrollComponentRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(200, Math.max(1, p.page_size ?? 50));
  const q = (p.q ?? '').trim();
  const type = (p.component_type ?? '').trim().toUpperCase();
  const method = (p.calculation_method ?? '').trim().toUpperCase();
  const values: unknown[] = [q, type, method, p.active_only ?? false];
  const where = `WHERE ($1='' OR component_code ILIKE '%'||$1||'%' OR name_ar ILIKE '%'||$1||'%')
     AND ($2='' OR component_type=$2)
     AND ($3='' OR calculation_method=$3)
     AND (NOT $4::boolean OR is_active=TRUE)`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.payroll_components ${where}`,
    values
  );
  const r = await txQuery<PayrollComponentRow>(
    client,
    `SELECT * FROM accounts.payroll_components ${where} ORDER BY component_code LIMIT $5 OFFSET $6`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
