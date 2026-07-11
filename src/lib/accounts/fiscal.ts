import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';
import { AccountsHttpError } from './auth';

const ARABIC_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

export function normalizeCode(code: string): string {
  return code.trim().replace(/\s+/g, '');
}

export function toDateOnly(value: string | Date): string {
  if (value instanceof Date) {
    return formatDateUTC(value);
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDateUTC(parsed);
  }
  return raw;
}

/** تطبيع حقول التاريخ في صفوف القراءات لتجنب إزاحة المنطقة الزمنية */
export function normalizeDateFields<T extends Record<string, unknown>>(
  row: T,
  fields: string[] = ['start_date', 'end_date', 'closed_at', 'locked_at', 'created_at', 'updated_at']
): T {
  const next: Record<string, unknown> = { ...row };
  for (const field of fields) {
    if (next[field] != null && (field.endsWith('_date') || field === 'start_date' || field === 'end_date')) {
      next[field] = toDateOnly(next[field] as string | Date);
    }
  }
  return next as T;
}

export function parseDateUTC(value: string): Date {
  const [y, m, d] = toDateOnly(value).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysUTC(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function endOfMonthUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export type MonthlyPeriodPlan = {
  period_number: number;
  code: string;
  name_ar: string;
  name_en: string;
  start_date: string;
  end_date: string;
};

/** يبني 12 فترة شهرية تغطي السنة دون فجوات/تداخل، أو يرمي خطأ إن لم تكن الحدود مناسبة */
export function buildTwelveMonthlyPeriods(
  yearStart: string,
  yearEnd: string
): MonthlyPeriodPlan[] {
  const start = parseDateUTC(yearStart);
  const end = parseDateUTC(yearEnd);

  const segments: { start: Date; end: Date }[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    const monthEnd = endOfMonthUTC(cursor);
    const segEnd = monthEnd.getTime() > end.getTime() ? end : monthEnd;
    segments.push({ start: cursor, end: segEnd });
    cursor = addDaysUTC(segEnd, 1);
  }

  if (segments.length !== 12) {
    throw new AccountsHttpError(
      `لا يمكن إنشاء 12 فترة شهرية تلقائياً لهذه السنة (عدد الشهور المحسوبة: ${segments.length}). عدّل حدود السنة أو أنشئ الفترات يدوياً.`,
      400
    );
  }

  const last = segments[segments.length - 1];
  if (formatDateUTC(segments[0].start) !== formatDateUTC(start) || formatDateUTC(last.end) !== formatDateUTC(end)) {
    throw new AccountsHttpError(
      'حدود السنة المالية غير مناسبة لإنشاء 12 فترة شهرية تلقائياً دون فجوات أو تداخل',
      400
    );
  }

  return segments.map((seg, index) => {
    const n = index + 1;
    const monthName = ARABIC_MONTHS[seg.start.getUTCMonth()];
    const yearNum = seg.start.getUTCFullYear();
    return {
      period_number: n,
      code: `P${String(n).padStart(2, '0')}`,
      name_ar: `${monthName} ${yearNum}`,
      name_en: seg.start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      start_date: formatDateUTC(seg.start),
      end_date: formatDateUTC(seg.end),
    };
  });
}

export async function assertNoYearOverlap(
  client: TxClient,
  startDate: string,
  endDate: string,
  excludeId?: string
): Promise<void> {
  const result = await txQuery<{ id: string; code: string }>(
    client,
    `SELECT id, code
     FROM accounts.fiscal_years
     WHERE start_date <= $2::date
       AND end_date >= $1::date
       AND ($3::uuid IS NULL OR id <> $3::uuid)
     LIMIT 1`,
    [toDateOnly(startDate), toDateOnly(endDate), excludeId ?? null]
  );

  if (result.rows.length > 0) {
    throw new AccountsHttpError(
      `تتداخل تواريخ السنة المالية مع سنة مالية موجودة (${result.rows[0].code})`,
      409
    );
  }
}

export async function assertNoPeriodOverlap(
  client: TxClient,
  fiscalYearId: string,
  startDate: string,
  endDate: string,
  excludeId?: string
): Promise<void> {
  const result = await txQuery<{ id: string; code: string }>(
    client,
    `SELECT id, code
     FROM accounts.fiscal_periods
     WHERE fiscal_year_id = $1
       AND start_date <= $3::date
       AND end_date >= $2::date
       AND ($4::uuid IS NULL OR id <> $4::uuid)
     LIMIT 1`,
    [fiscalYearId, toDateOnly(startDate), toDateOnly(endDate), excludeId ?? null]
  );

  if (result.rows.length > 0) {
    throw new AccountsHttpError(
      `تتداخل هذه الفترة مع فترة محاسبية موجودة (${result.rows[0].code})`,
      409
    );
  }
}

export async function assertPeriodInsideYear(
  client: TxClient,
  fiscalYearId: string,
  startDate: string,
  endDate: string
): Promise<{ start_date: string; end_date: string; status: string; code: string }> {
  const year = await txQuery<{
    start_date: string;
    end_date: string;
    status: string;
    code: string;
  }>(
    client,
    `SELECT start_date::text, end_date::text, status, code
     FROM accounts.fiscal_years WHERE id = $1`,
    [fiscalYearId]
  );

  if (year.rows.length === 0) {
    throw new AccountsHttpError('السنة المالية غير موجودة', 404);
  }

  const y = year.rows[0];
  const s = toDateOnly(startDate);
  const e = toDateOnly(endDate);
  if (s < toDateOnly(y.start_date) || e > toDateOnly(y.end_date)) {
    throw new AccountsHttpError(
      'الفترة يجب أن تقع بالكامل داخل حدود السنة المالية',
      400
    );
  }

  return y;
}

/** التحقق من تغطية كاملة بلا فجوات/تداخل قبل تفعيل السنة */
export async function assertFullPeriodCoverage(
  client: TxClient,
  fiscalYearId: string
): Promise<void> {
  const yearRes = await txQuery<{ start_date: string; end_date: string }>(
    client,
    `SELECT start_date::text, end_date::text FROM accounts.fiscal_years WHERE id = $1`,
    [fiscalYearId]
  );
  if (yearRes.rows.length === 0) {
    throw new AccountsHttpError('السنة المالية غير موجودة', 404);
  }

  const yearStart = toDateOnly(yearRes.rows[0].start_date);
  const yearEnd = toDateOnly(yearRes.rows[0].end_date);

  const periodsRes = await txQuery<{
    code: string;
    start_date: string;
    end_date: string;
    status: string;
  }>(
    client,
    `SELECT code, start_date::text, end_date::text, status
     FROM accounts.fiscal_periods
     WHERE fiscal_year_id = $1
     ORDER BY start_date ASC`,
    [fiscalYearId]
  );

  const periods = periodsRes.rows;
  if (periods.length === 0) {
    throw new AccountsHttpError(
      'لا يمكن تفعيل السنة المالية قبل إضافة فترات محاسبية تغطيها بالكامل',
      409
    );
  }

  if (periods.some((p) => p.status === 'LOCKED')) {
    throw new AccountsHttpError(
      'لا يمكن تفعيل السنة المالية لوجود فترة مقفلة قبل التفعيل',
      409
    );
  }

  if (toDateOnly(periods[0].start_date) !== yearStart) {
    throw new AccountsHttpError(
      `الفترات لا تغطي بداية السنة (متوقع ${yearStart}، أول فترة تبدأ ${toDateOnly(periods[0].start_date)})`,
      409
    );
  }

  for (let i = 0; i < periods.length; i++) {
    const current = periods[i];
    const cs = toDateOnly(current.start_date);
    const ce = toDateOnly(current.end_date);

    if (cs < yearStart || ce > yearEnd) {
      throw new AccountsHttpError(
        `الفترة ${current.code} خارج حدود السنة المالية`,
        409
      );
    }

    if (i > 0) {
      const prev = periods[i - 1];
      const expectedStart = formatDateUTC(addDaysUTC(parseDateUTC(prev.end_date), 1));
      if (cs !== expectedStart) {
        if (cs <= toDateOnly(prev.end_date)) {
          throw new AccountsHttpError(
            `تتداخل الفترة ${current.code} مع الفترة ${prev.code}`,
            409
          );
        }
        throw new AccountsHttpError(
          `توجد فجوة بين الفترة ${prev.code} والفترة ${current.code} (متوقع بداية ${expectedStart})`,
          409
        );
      }
    }
  }

  const lastEnd = toDateOnly(periods[periods.length - 1].end_date);
  if (lastEnd !== yearEnd) {
    throw new AccountsHttpError(
      `الفترات لا تغطي نهاية السنة (آخر فترة تنتهي ${lastEnd}، نهاية السنة ${yearEnd})`,
      409
    );
  }
}
