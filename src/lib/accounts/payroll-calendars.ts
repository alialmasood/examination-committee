/** تقويمات الرواتب — 9.A.1 (بنية تأسيسية، D12) */
import { AccountsHttpError } from './auth';
import {
  PAYROLL_ENUMS,
  assertEffectiveRange,
  assertPayrollCodeAvailable,
  assertPayrollConcurrency,
  currencyCode,
  dateStr,
  iso,
  optionalDate,
  oneOf,
  payrollCode,
  requiredDate,
  requiredText,
  textOrNull,
} from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PayrollCalendarRow = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  calendar_type: string;
  currency_code: string;
  is_active: boolean;
  effective_from: string | Date;
  effective_to: string | Date | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export function serializePayrollCalendar(row: PayrollCalendarRow) {
  return {
    ...row,
    effective_from: dateStr(row.effective_from)!,
    effective_to: dateStr(row.effective_to),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export async function loadPayrollCalendar(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<PayrollCalendarRow> {
  const r = await txQuery<PayrollCalendarRow>(
    client,
    `SELECT * FROM accounts.payroll_calendars WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('تقويم الرواتب غير موجود', 404);
  return r.rows[0];
}

export async function createPayrollCalendar(
  client: TxClient,
  input: {
    code: unknown;
    name_ar: unknown;
    name_en?: unknown;
    calendar_type: unknown;
    currency_code?: unknown;
    effective_from: unknown;
    effective_to?: unknown;
    created_by: string;
  }
): Promise<PayrollCalendarRow> {
  const code = payrollCode(input.code, 'رمز التقويم');
  await assertPayrollCodeAvailable(client, 'payroll_calendars', 'code', code, 'رمز التقويم');
  const from = requiredDate(input.effective_from, 'تاريخ بداية السريان');
  const to = optionalDate(input.effective_to, 'تاريخ نهاية السريان');
  assertEffectiveRange(from, to);
  const r = await txQuery<PayrollCalendarRow>(
    client,
    `INSERT INTO accounts.payroll_calendars
       (code, name_ar, name_en, calendar_type, currency_code, effective_from, effective_to, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8::uuid,$8::uuid)
     RETURNING *`,
    [
      code,
      requiredText(input.name_ar, 200, 'اسم التقويم بالعربية'),
      textOrNull(input.name_en, 200),
      oneOf(input.calendar_type, PAYROLL_ENUMS.CALENDAR_TYPE, 'نوع التقويم'),
      currencyCode(input.currency_code),
      from,
      to,
      input.created_by,
    ]
  );
  return r.rows[0];
}

export async function updatePayrollCalendar(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    name_ar?: unknown;
    name_en?: unknown;
    calendar_type?: unknown;
    currency_code?: unknown;
    effective_from?: unknown;
    effective_to?: unknown;
  }
): Promise<PayrollCalendarRow> {
  const row = await loadPayrollCalendar(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);
  const from = p.effective_from === undefined ? dateStr(row.effective_from)! : requiredDate(p.effective_from, 'تاريخ بداية السريان');
  const to = p.effective_to === undefined ? dateStr(row.effective_to) : optionalDate(p.effective_to, 'تاريخ نهاية السريان');
  assertEffectiveRange(from, to);
  const r = await txQuery<PayrollCalendarRow>(
    client,
    `UPDATE accounts.payroll_calendars SET
       name_ar=$2, name_en=$3, calendar_type=$4, currency_code=$5,
       effective_from=$6::date, effective_to=$7::date,
       updated_by=$8::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [
      row.id,
      p.name_ar === undefined ? row.name_ar : requiredText(p.name_ar, 200, 'اسم التقويم بالعربية'),
      p.name_en === undefined ? row.name_en : textOrNull(p.name_en, 200),
      p.calendar_type === undefined ? row.calendar_type : oneOf(p.calendar_type, PAYROLL_ENUMS.CALENDAR_TYPE, 'نوع التقويم'),
      p.currency_code === undefined ? row.currency_code : currencyCode(p.currency_code),
      from,
      to,
      p.userId,
    ]
  );
  return r.rows[0];
}

export async function setPayrollCalendarActive(
  client: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown; active: boolean }
): Promise<PayrollCalendarRow> {
  const row = await loadPayrollCalendar(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at);
  if (p.active === row.is_active) return row;
  const r = await txQuery<PayrollCalendarRow>(
    client,
    `UPDATE accounts.payroll_calendars SET is_active=$2, updated_by=$3::uuid,
       updated_at=NOW(), version=version+1 WHERE id=$1::uuid RETURNING *`,
    [row.id, p.active, p.userId]
  );
  return r.rows[0];
}

export async function listPayrollCalendars(
  client: TxClient,
  p: { q?: string; calendar_type?: string; active_only?: boolean; page?: number; page_size?: number }
): Promise<{ rows: PayrollCalendarRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(200, Math.max(1, p.page_size ?? 50));
  const q = (p.q ?? '').trim();
  const type = (p.calendar_type ?? '').trim().toUpperCase();
  const values: unknown[] = [p.active_only ?? false, q, type];
  const where = `WHERE (NOT $1::boolean OR is_active=TRUE)
     AND ($2='' OR code ILIKE '%'||$2||'%' OR name_ar ILIKE '%'||$2||'%')
     AND ($3='' OR calendar_type=$3)`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.payroll_calendars ${where}`,
    values
  );
  const r = await txQuery<PayrollCalendarRow>(
    client,
    `SELECT * FROM accounts.payroll_calendars ${where} ORDER BY code LIMIT $4 OFFSET $5`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
