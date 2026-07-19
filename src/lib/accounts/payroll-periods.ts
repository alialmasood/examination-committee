/**
 * فترات الرواتب — 9.A.2.1 (Payroll Periods).
 *
 * دورة الحياة: OPEN → (CLOSED ⇄ reopen) / CANCELLED. لا PROCESSING تلقائي.
 * منع التداخل لنفس التقويم عبر حارس خدمي داخل قفل PAYROLL_CALENDAR (Q4 — بلا btree_gist).
 * لا احتساب ولا لقطات هنا — طبقة تنظيمية فقط.
 */
import { AccountsHttpError } from './auth';
import { payrollCalendarLock, payrollPeriodLock } from './accounting-locks';
import { loadPayrollCalendar } from './payroll-calendars';
import { acquirePayrollLocks } from './payroll-locks';
import {
  assertPayrollConcurrency,
  currencyCode,
  dateStr,
  iso,
  nextPayrollNumber,
  optionalDate,
  optionalPayrollUuid,
  requiredDate,
  requiredReason,
  requiredText,
  requirePayrollUuid,
  textOrNull,
} from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PayrollPeriodRow = {
  id: string;
  period_code: string;
  payroll_calendar_id: string;
  name_ar: string;
  name_en: string | null;
  start_date: string | Date;
  end_date: string | Date;
  calculation_date: string | Date;
  payment_due_date: string | Date | null;
  status: string;
  currency_code: string;
  fiscal_year_id: string;
  fiscal_period_id: string | null;
  transition_reason: string | null;
  opened_at: Date | string | null;
  opened_by: string | null;
  closed_at: Date | string | null;
  closed_by: string | null;
  cancelled_at: Date | string | null;
  cancelled_by: string | null;
  reopened_at: Date | string | null;
  reopened_by: string | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export function serializePayrollPeriod(row: PayrollPeriodRow) {
  return {
    ...row,
    start_date: dateStr(row.start_date)!,
    end_date: dateStr(row.end_date)!,
    calculation_date: dateStr(row.calculation_date)!,
    payment_due_date: dateStr(row.payment_due_date),
    opened_at: iso(row.opened_at),
    closed_at: iso(row.closed_at),
    cancelled_at: iso(row.cancelled_at),
    reopened_at: iso(row.reopened_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export async function loadPayrollPeriod(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<PayrollPeriodRow> {
  const periodId = requirePayrollUuid(id, 'معرّف الفترة');
  const r = await txQuery<PayrollPeriodRow>(
    client,
    `SELECT * FROM accounts.payroll_periods WHERE id=$1::uuid ${forUpdate ? 'FOR UPDATE' : ''}`,
    [periodId]
  );
  if (!r.rows[0]) throw new AccountsHttpError('فترة الرواتب غير موجودة', 404);
  return r.rows[0];
}

/** فترة تُنشأ ضمن تقويم فعّال ساري عند بداية الفترة، وبعملة التقويم نفسها. */
async function resolveCalendarForPeriod(
  client: TxClient,
  calendarId: string,
  startDate: string,
  endDate: string
): Promise<{ id: string; currency_code: string }> {
  const cal = await loadPayrollCalendar(client, calendarId);
  if (!cal.is_active) throw new AccountsHttpError('تقويم الرواتب غير فعّال', 400);
  const effFrom = dateStr(cal.effective_from)!;
  const effTo = dateStr(cal.effective_to);
  if (effFrom > startDate) {
    throw new AccountsHttpError('تاريخ بداية الفترة يسبق سريان التقويم', 400);
  }
  if (effTo != null && effTo < endDate) {
    throw new AccountsHttpError('تاريخ نهاية الفترة يتجاوز نهاية سريان التقويم', 400);
  }
  return { id: cal.id, currency_code: cal.currency_code };
}

/** السنة المالية إلزامية وموجودة وغير مغلقة؛ الفترة المالية اختيارية وتعود لنفس السنة. */
async function resolveFiscal(
  client: TxClient,
  fiscalYearId: string | null,
  fiscalPeriodId: string | null
): Promise<{ fiscal_year_id: string; fiscal_period_id: string | null }> {
  if (!fiscalYearId) throw new AccountsHttpError('السنة المالية مطلوبة', 400);
  const fy = await txQuery<{ id: string; status: string }>(
    client,
    `SELECT id, status FROM accounts.fiscal_years WHERE id=$1::uuid`,
    [fiscalYearId]
  );
  if (!fy.rows[0]) throw new AccountsHttpError('السنة المالية غير موجودة', 404);
  if (fy.rows[0].status === 'CLOSED') throw new AccountsHttpError('السنة المالية مغلقة', 400);
  if (!fiscalPeriodId) return { fiscal_year_id: fy.rows[0].id, fiscal_period_id: null };
  const fp = await txQuery<{ id: string; fiscal_year_id: string }>(
    client,
    `SELECT id, fiscal_year_id FROM accounts.fiscal_periods WHERE id=$1::uuid`,
    [fiscalPeriodId]
  );
  if (!fp.rows[0]) throw new AccountsHttpError('الفترة المالية غير موجودة', 404);
  if (fp.rows[0].fiscal_year_id !== fy.rows[0].id) {
    throw new AccountsHttpError('الفترة المالية لا تعود للسنة المالية المحددة', 400);
  }
  return { fiscal_year_id: fy.rows[0].id, fiscal_period_id: fp.rows[0].id };
}

/** الحالات التي تمنع التداخل: OPEN / PROCESSING / CLOSED (CANCELLED لا تمنع). */
async function assertNoOverlap(
  client: TxClient,
  calendarId: string,
  startDate: string,
  endDate: string,
  exceptId: string | null
): Promise<void> {
  const r = await txQuery<{ id: string; period_code: string }>(
    client,
    `SELECT id, period_code FROM accounts.payroll_periods
     WHERE payroll_calendar_id=$1::uuid
       AND status IN ('OPEN','PROCESSING','CLOSED')
       AND ($4::uuid IS NULL OR id<>$4::uuid)
       AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')
     LIMIT 1`,
    [calendarId, startDate, endDate, exceptId]
  );
  if (r.rows[0]) {
    throw new AccountsHttpError(
      `تتداخل الفترة مع فترة قائمة لنفس التقويم (${r.rows[0].period_code})`,
      409
    );
  }
}

function assertPeriodDates(start: string, end: string, calc: string, due: string | null): void {
  if (end < start) throw new AccountsHttpError('تاريخ نهاية الفترة لا يمكن أن يسبق البداية', 400);
  if (calc < start) throw new AccountsHttpError('التاريخ المرجعي للاحتساب لا يمكن أن يسبق بداية الفترة', 400);
  if (due != null && due < end) throw new AccountsHttpError('تاريخ الاستحقاق لا يمكن أن يسبق نهاية الفترة', 400);
}

export async function createPayrollPeriod(
  client: TxClient,
  input: {
    payroll_calendar_id: unknown;
    name_ar: unknown;
    name_en?: unknown;
    start_date: unknown;
    end_date: unknown;
    calculation_date?: unknown;
    payment_due_date?: unknown;
    currency_code?: unknown;
    fiscal_year_id: unknown;
    fiscal_period_id?: unknown;
    created_by: string;
  }
): Promise<PayrollPeriodRow> {
  const calendarId = optionalPayrollUuid(input.payroll_calendar_id, 'تقويم الرواتب');
  if (!calendarId) throw new AccountsHttpError('تقويم الرواتب مطلوب', 400);

  const start = requiredDate(input.start_date, 'تاريخ بداية الفترة');
  const end = requiredDate(input.end_date, 'تاريخ نهاية الفترة');
  const calc = input.calculation_date == null || String(input.calculation_date).trim() === ''
    ? end
    : requiredDate(input.calculation_date, 'التاريخ المرجعي للاحتساب');
  const due = optionalDate(input.payment_due_date, 'تاريخ الاستحقاق');
  assertPeriodDates(start, end, calc, due);

  // قفل التقويم قبل فحص التداخل لمنع سباق إنشاء فترتين متداخلتين
  await acquirePayrollLocks(client, [payrollCalendarLock(calendarId)]);
  const cal = await resolveCalendarForPeriod(client, calendarId, start, end);
  const fiscal = await resolveFiscal(
    client,
    optionalPayrollUuid(input.fiscal_year_id, 'السنة المالية'),
    optionalPayrollUuid(input.fiscal_period_id, 'الفترة المالية')
  );

  // عملة الفترة تطابق التقويم؛ إن مُرّرت عملة مختلفة تُرفض
  const providedCurrency = input.currency_code == null || String(input.currency_code).trim() === ''
    ? cal.currency_code
    : currencyCode(input.currency_code);
  if (providedCurrency !== cal.currency_code) {
    throw new AccountsHttpError('عملة الفترة يجب أن تطابق عملة التقويم', 400);
  }

  await assertNoOverlap(client, calendarId, start, end, null);

  const code = await nextPayrollNumber(client, 'PAYROLL_PERIOD', 'PYPR');

  const r = await txQuery<PayrollPeriodRow>(
    client,
    `INSERT INTO accounts.payroll_periods
       (period_code, payroll_calendar_id, name_ar, name_en, start_date, end_date,
        calculation_date, payment_due_date, status, currency_code, fiscal_year_id, fiscal_period_id,
        opened_at, opened_by, created_by, updated_by)
     VALUES ($1,$2::uuid,$3,$4,$5::date,$6::date,$7::date,$8::date,'OPEN',$9,$10::uuid,$11::uuid,
             NOW(),$12::uuid,$12::uuid,$12::uuid)
     RETURNING *`,
    [
      code,
      calendarId,
      requiredText(input.name_ar, 200, 'اسم الفترة بالعربية'),
      textOrNull(input.name_en, 200),
      start,
      end,
      calc,
      due,
      cal.currency_code,
      fiscal.fiscal_year_id,
      fiscal.fiscal_period_id,
      input.created_by,
    ]
  );
  return r.rows[0];
}

async function countNonCancelledRuns(client: TxClient, periodId: string): Promise<number> {
  const r = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.payroll_runs
     WHERE payroll_period_id=$1::uuid AND status <> 'CANCELLED'`,
    [periodId]
  );
  return r.rows[0]?.n ?? 0;
}

const SENSITIVE_FIELDS = [
  'payroll_calendar_id', 'start_date', 'end_date', 'calculation_date',
  'payment_due_date', 'currency_code', 'fiscal_year_id', 'fiscal_period_id',
] as const;

export async function updatePayrollPeriod(
  client: TxClient,
  p: {
    id: string;
    userId: string;
    version: unknown;
    updated_at: unknown;
    name_ar?: unknown;
    name_en?: unknown;
    payroll_calendar_id?: unknown;
    start_date?: unknown;
    end_date?: unknown;
    calculation_date?: unknown;
    payment_due_date?: unknown;
    currency_code?: unknown;
    fiscal_year_id?: unknown;
    fiscal_period_id?: unknown;
  }
): Promise<PayrollPeriodRow> {
  // قراءة أولية بلا قفل لمعرفة التقويم وتحديد الأقفال — بدون ترتيب مخالف
  const peek = await loadPayrollPeriod(client, p.id, false);
  const wantsSensitive = SENSITIVE_FIELDS.some((f) => (p as Record<string, unknown>)[f] !== undefined);

  const locks = [payrollPeriodLock(p.id)];
  let plannedCalendarId: string | null = null;
  if (wantsSensitive) {
    plannedCalendarId =
      p.payroll_calendar_id === undefined
        ? peek.payroll_calendar_id
        : optionalPayrollUuid(p.payroll_calendar_id, 'تقويم الرواتب');
    if (!plannedCalendarId) throw new AccountsHttpError('تقويم الرواتب مطلوب', 400);
    locks.push(payrollCalendarLock(plannedCalendarId));
  }

  // مكالمة قفل واحدة — الفرز الحتمي داخل acquirePayrollLocks (Calendar قبل Period)
  await acquirePayrollLocks(client, locks);
  const row = await loadPayrollPeriod(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at, 'الفترة');
  if (row.status !== 'OPEN') {
    throw new AccountsHttpError('لا يمكن تعديل فترة إلا وهي مفتوحة (OPEN)', 409);
  }

  if (wantsSensitive) {
    const runs = await countNonCancelledRuns(client, p.id);
    if (runs > 0) {
      throw new AccountsHttpError('لا يمكن تعديل الحقول الحساسة للفترة بوجود تشغيلات غير ملغاة', 409);
    }
    const nextCalendarId =
      p.payroll_calendar_id === undefined
        ? row.payroll_calendar_id
        : optionalPayrollUuid(p.payroll_calendar_id, 'تقويم الرواتب');
    if (!nextCalendarId) throw new AccountsHttpError('تقويم الرواتب مطلوب', 400);
    // بعد نجاح التزامن المتفائل يجب أن يطابق التقويم المخطط (المقفول مسبقاً)
    if (plannedCalendarId && nextCalendarId !== plannedCalendarId) {
      throw new AccountsHttpError(
        'تم تعديل الفترة بواسطة مستخدم آخر. حدّث الصفحة ثم أعد المحاولة.',
        409
      );
    }

    const start = p.start_date === undefined ? dateStr(row.start_date)! : requiredDate(p.start_date, 'تاريخ بداية الفترة');
    const end = p.end_date === undefined ? dateStr(row.end_date)! : requiredDate(p.end_date, 'تاريخ نهاية الفترة');
    const calc = p.calculation_date === undefined ? dateStr(row.calculation_date)! : requiredDate(p.calculation_date, 'التاريخ المرجعي للاحتساب');
    const due = p.payment_due_date === undefined ? dateStr(row.payment_due_date) : optionalDate(p.payment_due_date, 'تاريخ الاستحقاق');
    assertPeriodDates(start, end, calc, due);

    const cal = await resolveCalendarForPeriod(client, nextCalendarId, start, end);
    const fiscal = await resolveFiscal(
      client,
      p.fiscal_year_id === undefined ? row.fiscal_year_id : optionalPayrollUuid(p.fiscal_year_id, 'السنة المالية'),
      p.fiscal_period_id === undefined ? row.fiscal_period_id : optionalPayrollUuid(p.fiscal_period_id, 'الفترة المالية')
    );
    const providedCurrency = p.currency_code === undefined ? row.currency_code : currencyCode(p.currency_code);
    if (providedCurrency !== cal.currency_code) {
      throw new AccountsHttpError('عملة الفترة يجب أن تطابق عملة التقويم', 400);
    }
    await assertNoOverlap(client, nextCalendarId, start, end, p.id);

    const r = await txQuery<PayrollPeriodRow>(
      client,
      `UPDATE accounts.payroll_periods SET
         name_ar=$2, name_en=$3, payroll_calendar_id=$4::uuid, start_date=$5::date, end_date=$6::date,
         calculation_date=$7::date, payment_due_date=$8::date, currency_code=$9,
         fiscal_year_id=$10::uuid, fiscal_period_id=$11::uuid,
         updated_by=$12::uuid, updated_at=NOW(), version=version+1
       WHERE id=$1::uuid RETURNING *`,
      [
        row.id,
        p.name_ar === undefined ? row.name_ar : requiredText(p.name_ar, 200, 'اسم الفترة بالعربية'),
        p.name_en === undefined ? row.name_en : textOrNull(p.name_en, 200),
        nextCalendarId,
        start,
        end,
        calc,
        due,
        cal.currency_code,
        fiscal.fiscal_year_id,
        fiscal.fiscal_period_id,
        p.userId,
      ]
    );
    return r.rows[0];
  }

  // تعديل الحقول غير الحساسة فقط (الاسم)
  const r = await txQuery<PayrollPeriodRow>(
    client,
    `UPDATE accounts.payroll_periods SET
       name_ar=$2, name_en=$3, updated_by=$4::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [
      row.id,
      p.name_ar === undefined ? row.name_ar : requiredText(p.name_ar, 200, 'اسم الفترة بالعربية'),
      p.name_en === undefined ? row.name_en : textOrNull(p.name_en, 200),
      p.userId,
    ]
  );
  return r.rows[0];
}

/** حالات التشغيلات ضمن الفترة (لأغراض قرارات الإغلاق/الإلغاء). */
async function runStatusCounts(
  client: TxClient,
  periodId: string
): Promise<Record<string, number>> {
  const r = await txQuery<{ status: string; n: number }>(
    client,
    `SELECT status, COUNT(*)::int n FROM accounts.payroll_runs
     WHERE payroll_period_id=$1::uuid GROUP BY status`,
    [periodId]
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) out[row.status] = row.n;
  return out;
}

export async function closePayrollPeriod(
  client: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown }
): Promise<PayrollPeriodRow> {
  await acquirePayrollLocks(client, [payrollPeriodLock(p.id)]);
  const row = await loadPayrollPeriod(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at, 'الفترة');
  if (row.status !== 'OPEN' && row.status !== 'PROCESSING') {
    throw new AccountsHttpError('لا يمكن إغلاق فترة إلا وهي مفتوحة', 409);
  }
  const counts = await runStatusCounts(client, p.id);
  if ((counts['CALCULATING'] ?? 0) > 0) {
    throw new AccountsHttpError('لا يمكن الإغلاق بوجود تشغيل قيد الاحتساب', 409);
  }
  if ((counts['DRAFT'] ?? 0) > 0) {
    throw new AccountsHttpError('لا يمكن الإغلاق بوجود تشغيل مسودة — ألغِه أو أكمله أولاً', 409);
  }
  // ملاحظة: فحص Blocking Issues مؤجَّل إلى 9.A.2.3 (جدول issues غير مُنفَّذ بعد).
  const r = await txQuery<PayrollPeriodRow>(
    client,
    `UPDATE accounts.payroll_periods SET status='CLOSED', closed_at=NOW(), closed_by=$2::uuid,
       updated_by=$2::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [row.id, p.userId]
  );
  return r.rows[0];
}

export async function reopenPayrollPeriod(
  client: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown; reason: unknown }
): Promise<PayrollPeriodRow> {
  const reason = requiredReason(p.reason, 'سبب إعادة فتح الفترة');
  await acquirePayrollLocks(client, [payrollPeriodLock(p.id)]);
  const row = await loadPayrollPeriod(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at, 'الفترة');
  if (row.status !== 'CLOSED') {
    throw new AccountsHttpError('لا يمكن إعادة فتح فترة إلا وهي مغلقة', 409);
  }
  const r = await txQuery<PayrollPeriodRow>(
    client,
    `UPDATE accounts.payroll_periods SET status='OPEN', reopened_at=NOW(), reopened_by=$2::uuid,
       transition_reason=$3, updated_by=$2::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [row.id, p.userId, reason]
  );
  return r.rows[0];
}

export async function cancelPayrollPeriod(
  client: TxClient,
  p: { id: string; userId: string; version: unknown; updated_at: unknown; reason: unknown }
): Promise<PayrollPeriodRow> {
  const reason = requiredReason(p.reason, 'سبب إلغاء الفترة');
  await acquirePayrollLocks(client, [payrollPeriodLock(p.id)]);
  const row = await loadPayrollPeriod(client, p.id, true);
  assertPayrollConcurrency(row, p.version, p.updated_at, 'الفترة');
  if (row.status === 'CANCELLED') {
    throw new AccountsHttpError('الفترة ملغاة مسبقاً', 409);
  }
  const counts = await runStatusCounts(client, p.id);
  if ((counts['CALCULATING'] ?? 0) > 0) {
    throw new AccountsHttpError('لا يمكن الإلغاء بوجود تشغيل قيد الاحتساب', 409);
  }
  // سياسة 9.A.2.1: لا يُلغى إلا بعد إلغاء كل التشغيلات غير الملغاة (وضوح وسلامة).
  const nonCancelled = await countNonCancelledRuns(client, p.id);
  if (nonCancelled > 0) {
    throw new AccountsHttpError('ألغِ كل تشغيلات الفترة غير الملغاة قبل إلغاء الفترة', 409);
  }
  const r = await txQuery<PayrollPeriodRow>(
    client,
    `UPDATE accounts.payroll_periods SET status='CANCELLED', cancelled_at=NOW(), cancelled_by=$2::uuid,
       transition_reason=$3, updated_by=$2::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid RETURNING *`,
    [row.id, p.userId, reason]
  );
  return r.rows[0];
}

export async function listPayrollPeriods(
  client: TxClient,
  p: {
    q?: string;
    payroll_calendar_id?: string;
    status?: string;
    fiscal_year_id?: string;
    page?: number;
    page_size?: number;
  }
): Promise<{ rows: PayrollPeriodRow[]; total: number; page: number; page_size: number }> {
  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(200, Math.max(1, p.page_size ?? 50));
  const q = (p.q ?? '').trim();
  const calendar = (p.payroll_calendar_id ?? '').trim();
  const status = (p.status ?? '').trim().toUpperCase();
  const fiscalYear = (p.fiscal_year_id ?? '').trim();
  const values: unknown[] = [q, calendar, status, fiscalYear];
  const where = `WHERE ($1='' OR period_code ILIKE '%'||$1||'%' OR name_ar ILIKE '%'||$1||'%')
     AND ($2='' OR payroll_calendar_id=$2::uuid)
     AND ($3='' OR status=$3)
     AND ($4='' OR fiscal_year_id=$4::uuid)`;
  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total FROM accounts.payroll_periods ${where}`,
    values
  );
  const r = await txQuery<PayrollPeriodRow>(
    client,
    `SELECT * FROM accounts.payroll_periods ${where} ORDER BY start_date DESC, period_code DESC LIMIT $5 OFFSET $6`,
    [...values, page_size, (page - 1) * page_size]
  );
  return { rows: r.rows, total: n.rows[0]?.total ?? 0, page, page_size };
}
