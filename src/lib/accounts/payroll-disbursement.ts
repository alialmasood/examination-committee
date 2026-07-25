/** كشوف صرف الرواتب الشهرية اليدوية */
import { AccountsHttpError } from './auth';
import { dateStr, iso, nonNegativeMoney, requiredReason } from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export const DISBURSEMENT_CATEGORIES = [
  'TEACHING_STAFF',
  'EXTERNAL_LECTURER',
  'EMPLOYEE',
  'DAILY_WORKER',
] as const;

export type DisbursementCategory = (typeof DISBURSEMENT_CATEGORIES)[number];

export const DISBURSEMENT_STATUS = ['EMPTY', 'DRAFT', 'SAVED', 'LOCKED', 'DISBURSED'] as const;
export const SHEET_STATUS = ['DRAFT', 'SAVED', 'LOCKED', 'DISBURSED'] as const;

export const CATEGORY_LABEL: Record<DisbursementCategory, string> = {
  TEACHING_STAFF: 'رواتب التدريسيين',
  EXTERNAL_LECTURER: 'رواتب المحاضرين',
  EMPLOYEE: 'رواتب الموظفين',
  DAILY_WORKER: 'رواتب الأجور اليومية',
};

export const MONTH_LABELS = [
  'كانون الثاني',
  'شباط',
  'آذار',
  'نيسان',
  'أيار',
  'حزيران',
  'تموز',
  'آب',
  'أيلول',
  'تشرين الأول',
  'تشرين الثاني',
  'كانون الأول',
] as const;

export type DisbursementMonthRow = {
  id: string;
  fiscal_year_id: string;
  year_label: string;
  month_number: number;
  status: string;
  notes: string | null;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type DisbursementSheetRow = {
  id: string;
  disbursement_month_id: string;
  person_category: DisbursementCategory;
  status: string;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type DisbursementLineRow = {
  id: string;
  sheet_id: string;
  payroll_person_id: string;
  person_code_snapshot: string;
  person_name_snapshot: string;
  base_amount: string | number;
  notes: string | null;
  line_status: string;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type DisbursementAssignmentLineRow = {
  id: string;
  disbursement_line_id: string;
  payroll_assignment_id: string;
  assignment_code_snapshot: string;
  assignment_title_snapshot: string;
  amount: string | number;
  is_partial: boolean;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function money(v: string | number | null | undefined): number {
  return Number(v ?? 0);
}

function monthBounds(yearLabel: string, monthNumber: number): { from: string; to: string } {
  const y = Number(yearLabel);
  const m = String(monthNumber).padStart(2, '0');
  const last = new Date(y, monthNumber, 0).getDate();
  return {
    from: `${y}-${m}-01`,
    to: `${y}-${m}-${String(last).padStart(2, '0')}`,
  };
}

export function serializeMonth(row: DisbursementMonthRow) {
  return {
    ...row,
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export function serializeSheet(row: DisbursementSheetRow) {
  return {
    ...row,
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export function serializeLine(row: DisbursementLineRow) {
  return {
    ...row,
    base_amount: money(row.base_amount).toFixed(3),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

export function serializeAssignmentLine(row: DisbursementAssignmentLineRow) {
  return {
    ...row,
    amount: money(row.amount).toFixed(3),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

async function ensureTables(client: TxClient) {
  await txQuery(
    client,
    `
    CREATE TABLE IF NOT EXISTS accounts.payroll_disbursement_months (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fiscal_year_id UUID NOT NULL REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
      year_label VARCHAR(10) NOT NULL,
      month_number SMALLINT NOT NULL CHECK (month_number BETWEEN 1 AND 12),
      status VARCHAR(20) NOT NULL DEFAULT 'EMPTY'
        CHECK (status IN ('EMPTY', 'DRAFT', 'SAVED', 'LOCKED', 'DISBURSED')),
      notes TEXT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
      updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_payroll_disbursement_months UNIQUE (fiscal_year_id, month_number)
    )
  `
  );
  await txQuery(
    client,
    `
    CREATE TABLE IF NOT EXISTS accounts.payroll_disbursement_sheets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      disbursement_month_id UUID NOT NULL
        REFERENCES accounts.payroll_disbursement_months(id) ON DELETE CASCADE,
      person_category VARCHAR(30) NOT NULL
        CHECK (person_category IN (
          'TEACHING_STAFF', 'EXTERNAL_LECTURER', 'EMPLOYEE', 'DAILY_WORKER'
        )),
      status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'SAVED', 'LOCKED', 'DISBURSED')),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
      updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_payroll_disbursement_sheets UNIQUE (disbursement_month_id, person_category)
    )
  `
  );
  await txQuery(
    client,
    `
    CREATE TABLE IF NOT EXISTS accounts.payroll_disbursement_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sheet_id UUID NOT NULL
        REFERENCES accounts.payroll_disbursement_sheets(id) ON DELETE CASCADE,
      payroll_person_id UUID NOT NULL
        REFERENCES accounts.payroll_people(id) ON DELETE RESTRICT,
      person_code_snapshot VARCHAR(40) NOT NULL,
      person_name_snapshot VARCHAR(200) NOT NULL,
      base_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (base_amount >= 0),
      notes TEXT NULL,
      line_status VARCHAR(20) NOT NULL DEFAULT 'EMPTY'
        CHECK (line_status IN ('EMPTY', 'ENTERED', 'SAVED')),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
      updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_payroll_disbursement_lines UNIQUE (sheet_id, payroll_person_id)
    )
  `
  );
  await txQuery(
    client,
    `
    CREATE TABLE IF NOT EXISTS accounts.payroll_disbursement_assignment_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      disbursement_line_id UUID NOT NULL
        REFERENCES accounts.payroll_disbursement_lines(id) ON DELETE CASCADE,
      payroll_assignment_id UUID NOT NULL
        REFERENCES accounts.payroll_assignments(id) ON DELETE RESTRICT,
      assignment_code_snapshot VARCHAR(40) NOT NULL,
      assignment_title_snapshot VARCHAR(200) NOT NULL,
      amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (amount >= 0),
      is_partial BOOLEAN NOT NULL DEFAULT FALSE,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
      updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_payroll_disbursement_assignment_lines UNIQUE (disbursement_line_id, payroll_assignment_id)
    )
  `
  );
}

function assertEditableSheet(status: string) {
  if (status === 'LOCKED' || status === 'DISBURSED') {
    throw new AccountsHttpError('لا يمكن تعديل كشف مقفل أو مصروف', 409);
  }
}

export async function listFiscalYearsForDisbursement(client: TxClient) {
  await ensureTables(client);
  const r = await txQuery<{
    id: string;
    code: string;
    name_ar: string;
    status: string;
    is_default: boolean;
    start_date: string;
    end_date: string;
  }>(
    client,
    `SELECT id, code, name_ar, status, is_default,
            start_date::text AS start_date, end_date::text AS end_date
     FROM accounts.fiscal_years
     WHERE status IN ('ACTIVE', 'DRAFT', 'CLOSED')
     ORDER BY start_date DESC`
  );
  return r.rows;
}

export async function getYearDisbursementSummary(client: TxClient, fiscalYearId: string) {
  await ensureTables(client);
  const r = await txQuery<{
    sheets_count: string;
    disbursed_sheets_count: string;
    disbursed_amount: string;
  }>(
    client,
    `WITH sheet_totals AS (
       SELECT
         s.id,
         s.status,
         COALESCE(SUM(l.base_amount), 0) AS base_total,
         COALESCE((
           SELECT SUM(al.amount)
           FROM accounts.payroll_disbursement_assignment_lines al
           JOIN accounts.payroll_disbursement_lines ll ON ll.id = al.disbursement_line_id
           WHERE ll.sheet_id = s.id
         ), 0) AS assignments_total
       FROM accounts.payroll_disbursement_months m
       JOIN accounts.payroll_disbursement_sheets s ON s.disbursement_month_id = m.id
       LEFT JOIN accounts.payroll_disbursement_lines l ON l.sheet_id = s.id
       WHERE m.fiscal_year_id = $1::uuid
       GROUP BY s.id, s.status
     )
     SELECT
       COUNT(*)::text AS sheets_count,
       COUNT(*) FILTER (WHERE status = 'DISBURSED')::text AS disbursed_sheets_count,
       COALESCE(
         SUM(
           CASE WHEN status = 'DISBURSED'
             THEN base_total + assignments_total
             ELSE 0
           END
         ),
         0
       )::text AS disbursed_amount
     FROM sheet_totals`,
    [fiscalYearId]
  );
  const row = r.rows[0];
  return {
    sheets_count: Number(row?.sheets_count || 0),
    disbursed_sheets_count: Number(row?.disbursed_sheets_count || 0),
    disbursed_amount: String(row?.disbursed_amount || '0'),
  };
}

export async function listYearDisbursementReport(client: TxClient, fiscalYearId: string) {
  await ensureTables(client);
  const r = await txQuery<{
    sheet_id: string;
    month_number: number;
    person_category: DisbursementCategory;
    status: string;
    people_count: number;
    entered_count: number;
    base_total: string;
    assignments_total: string;
    grand_total: string;
    updated_at: string | null;
  }>(
    client,
    `SELECT
       s.id AS sheet_id,
       m.month_number,
       s.person_category,
       s.status,
       COUNT(l.id)::int AS people_count,
       COUNT(l.id) FILTER (WHERE l.base_amount > 0 OR EXISTS (
         SELECT 1 FROM accounts.payroll_disbursement_assignment_lines al
         WHERE al.disbursement_line_id = l.id AND al.amount > 0
       ))::int AS entered_count,
       COALESCE(SUM(l.base_amount), 0)::text AS base_total,
       COALESCE((
         SELECT SUM(al.amount)
         FROM accounts.payroll_disbursement_assignment_lines al
         JOIN accounts.payroll_disbursement_lines ll ON ll.id = al.disbursement_line_id
         WHERE ll.sheet_id = s.id
       ), 0)::text AS assignments_total,
       (
         COALESCE(SUM(l.base_amount), 0) +
         COALESCE((
           SELECT SUM(al.amount)
           FROM accounts.payroll_disbursement_assignment_lines al
           JOIN accounts.payroll_disbursement_lines ll ON ll.id = al.disbursement_line_id
           WHERE ll.sheet_id = s.id
         ), 0)
       )::text AS grand_total,
       s.updated_at::text AS updated_at
     FROM accounts.payroll_disbursement_months m
     JOIN accounts.payroll_disbursement_sheets s ON s.disbursement_month_id = m.id
     LEFT JOIN accounts.payroll_disbursement_lines l ON l.sheet_id = s.id
     WHERE m.fiscal_year_id = $1::uuid
     GROUP BY s.id, m.month_number, s.person_category, s.status, s.updated_at
     ORDER BY m.month_number ASC, s.person_category ASC`,
    [fiscalYearId]
  );
  return r.rows;
}

/** الشهر السابق ضمن نفس السنة المالية (كانون الثاني → كانون الأول). */
function previousMonthNumber(monthNumber: number): number {
  return monthNumber === 1 ? 12 : monthNumber - 1;
}

export type ComparisonPersonTotals = {
  payroll_person_id: string;
  person_name: string;
  base: number;
  assignments: number;
};

export type SheetComparisonChange = {
  payroll_person_id: string;
  person_name: string;
  reason: string;
  previous_total: string;
  current_total: string;
  diff: string;
};

export type SheetComparison = {
  direction: 'higher' | 'lower' | 'equal';
  previous_total: string;
  current_total: string;
  diff: string;
  new_count: number;
  left_count: number;
  increased_count: number;
  decreased_count: number;
  changes: SheetComparisonChange[];
};

const MONEY_EPSILON = 0.0005;

/** يبني مقارنة كشف مع الشهر السابق على مستوى الشخص مع سبب عربي لكل فرق. */
export function buildSheetComparison(
  current: ComparisonPersonTotals[],
  previous: ComparisonPersonTotals[]
): SheetComparison {
  const prevByPerson = new Map(previous.map((l) => [l.payroll_person_id, l]));
  const seen = new Set<string>();
  const changes: Array<SheetComparisonChange & { __abs: number }> = [];
  let currentTotal = 0;
  let previousTotal = 0;
  let newCount = 0;
  let leftCount = 0;
  let increasedCount = 0;
  let decreasedCount = 0;

  for (const p of previous) previousTotal += p.base + p.assignments;

  for (const c of current) {
    const cur = c.base + c.assignments;
    currentTotal += cur;
    seen.add(c.payroll_person_id);
    const prev = prevByPerson.get(c.payroll_person_id);
    if (!prev) {
      if (cur > MONEY_EPSILON) {
        newCount += 1;
        changes.push({
          payroll_person_id: c.payroll_person_id,
          person_name: c.person_name,
          reason: 'اسم جديد أُضيف هذا الشهر',
          previous_total: '0.000',
          current_total: cur.toFixed(3),
          diff: cur.toFixed(3),
          __abs: cur,
        });
      }
      continue;
    }
    const prevTotal = prev.base + prev.assignments;
    const diff = cur - prevTotal;
    if (Math.abs(diff) <= MONEY_EPSILON) continue;
    if (diff > 0) increasedCount += 1;
    else decreasedCount += 1;

    const parts: string[] = [];
    const baseDiff = c.base - prev.base;
    const asgDiff = c.assignments - prev.assignments;
    if (baseDiff > MONEY_EPSILON) parts.push('زاد الراتب الأساسي');
    else if (baseDiff < -MONEY_EPSILON) parts.push('قل الراتب الأساسي');
    if (asgDiff > MONEY_EPSILON) parts.push('زادت التكليفات');
    else if (asgDiff < -MONEY_EPSILON) parts.push('قلت التكليفات');

    changes.push({
      payroll_person_id: c.payroll_person_id,
      person_name: c.person_name,
      reason: parts.length ? parts.join(' و') : diff > 0 ? 'زاد الإجمالي' : 'قل الإجمالي',
      previous_total: prevTotal.toFixed(3),
      current_total: cur.toFixed(3),
      diff: diff.toFixed(3),
      __abs: Math.abs(diff),
    });
  }

  for (const p of previous) {
    if (seen.has(p.payroll_person_id)) continue;
    const prevTotal = p.base + p.assignments;
    if (prevTotal <= MONEY_EPSILON) continue;
    leftCount += 1;
    changes.push({
      payroll_person_id: p.payroll_person_id,
      person_name: p.person_name,
      reason: 'غير موجود في كشف هذا الشهر',
      previous_total: prevTotal.toFixed(3),
      current_total: '0.000',
      diff: (-prevTotal).toFixed(3),
      __abs: prevTotal,
    });
  }

  changes.sort((a, b) => b.__abs - a.__abs);
  const diff = currentTotal - previousTotal;

  return {
    direction: Math.abs(diff) <= MONEY_EPSILON ? 'equal' : diff > 0 ? 'higher' : 'lower',
    previous_total: previousTotal.toFixed(3),
    current_total: currentTotal.toFixed(3),
    diff: diff.toFixed(3),
    new_count: newCount,
    left_count: leftCount,
    increased_count: increasedCount,
    decreased_count: decreasedCount,
    changes: changes.map(({ __abs: _abs, ...change }) => change),
  };
}

/** مجاميع أشخاص كشف واحد (أساسي + تكليفات) — للمقارنة الشهرية. */
async function getSheetPersonTotals(
  client: TxClient,
  sheetId: string
): Promise<ComparisonPersonTotals[]> {
  const r = await txQuery<{
    payroll_person_id: string;
    person_name_snapshot: string;
    base_amount: string;
    assignments_total: string;
  }>(
    client,
    `SELECT l.payroll_person_id,
            l.person_name_snapshot,
            l.base_amount::text AS base_amount,
            COALESCE((
              SELECT SUM(al.amount)
              FROM accounts.payroll_disbursement_assignment_lines al
              WHERE al.disbursement_line_id = l.id
            ), 0)::text AS assignments_total
     FROM accounts.payroll_disbursement_lines l
     WHERE l.sheet_id=$1::uuid`,
    [sheetId]
  );
  return r.rows.map((row) => ({
    payroll_person_id: row.payroll_person_id,
    person_name: row.person_name_snapshot,
    base: money(row.base_amount),
    assignments: money(row.assignments_total),
  }));
}

/** إيجاد كشف الشهر السابق لنفس السنة المالية والفئة. */
async function findPreviousSheetRef(
  client: TxClient,
  fiscalYearId: string,
  monthNumber: number,
  category: DisbursementCategory
): Promise<{ id: string; month_number: number } | null> {
  const prevMonth = previousMonthNumber(monthNumber);
  const r = await txQuery<{ id: string; month_number: number }>(
    client,
    `SELECT s.id, m.month_number
     FROM accounts.payroll_disbursement_sheets s
     JOIN accounts.payroll_disbursement_months m ON m.id = s.disbursement_month_id
     WHERE m.fiscal_year_id=$1::uuid
       AND m.month_number=$2
       AND s.person_category=$3
     LIMIT 1`,
    [fiscalYearId, prevMonth, category]
  );
  return r.rows[0] ?? null;
}

export async function getMonthDisbursementDetail(
  client: TxClient,
  fiscalYearId: string,
  monthNumber: number
) {
  await ensureTables(client);
  const month = await txQuery<DisbursementMonthRow>(
    client,
    `SELECT * FROM accounts.payroll_disbursement_months
     WHERE fiscal_year_id=$1::uuid AND month_number=$2`,
    [fiscalYearId, monthNumber]
  );
  const year = await txQuery<{ code: string; name_ar: string }>(
    client,
    `SELECT code, name_ar FROM accounts.fiscal_years WHERE id=$1::uuid`,
    [fiscalYearId]
  );
  if (!year.rows[0]) throw new AccountsHttpError('السنة المالية غير موجودة', 404);

  const m = month.rows[0] ?? null;
  const header = {
    fiscal_year_id: fiscalYearId,
    fiscal_year_code: year.rows[0].code,
    fiscal_year_name: year.rows[0].name_ar,
    month_number: monthNumber,
    month_label: MONTH_LABELS[monthNumber - 1],
    year_label: m?.year_label ?? '',
    month_status: m?.status ?? 'EMPTY',
  };

  if (!m) {
    return {
      header,
      categories: DISBURSEMENT_CATEGORIES.map((cat) => ({
        person_category: cat,
        category_label: CATEGORY_LABEL[cat],
        sheet_id: null as string | null,
        status: 'EMPTY',
        people_count: 0,
        entered_count: 0,
        base_total: '0.000',
        assignments_total: '0.000',
        grand_total: '0.000',
        lines: [] as Array<Record<string, unknown>>,
      })),
      totals: {
        people_count: 0,
        entered_count: 0,
        base_total: '0.000',
        assignments_total: '0.000',
        grand_total: '0.000',
      },
    };
  }

  const sheets = await txQuery<DisbursementSheetRow>(
    client,
    `SELECT * FROM accounts.payroll_disbursement_sheets
     WHERE disbursement_month_id=$1::uuid`,
    [m.id]
  );

  const lines = await txQuery<{
    id: string;
    sheet_id: string;
    payroll_person_id: string;
    person_code_snapshot: string;
    person_name_snapshot: string;
    base_amount: string;
    academic_title: string | null;
    degree: string | null;
    department_name: string | null;
    assignments_total: string;
    assignments_count: number;
  }>(
    client,
    `SELECT l.id,
            l.sheet_id,
            l.payroll_person_id,
            l.person_code_snapshot,
            l.person_name_snapshot,
            l.base_amount::text AS base_amount,
            p.academic_title,
            p.degree,
            COALESCE(d.name_ar, p.workplace, p.affiliation) AS department_name,
            COALESCE((
              SELECT SUM(al.amount)
              FROM accounts.payroll_disbursement_assignment_lines al
              WHERE al.disbursement_line_id = l.id
            ), 0)::text AS assignments_total,
            COALESCE((
              SELECT COUNT(*)
              FROM accounts.payroll_disbursement_assignment_lines al
              WHERE al.disbursement_line_id = l.id AND al.amount > 0
            ), 0)::int AS assignments_count
     FROM accounts.payroll_disbursement_lines l
     JOIN accounts.payroll_disbursement_sheets s ON s.id = l.sheet_id
     LEFT JOIN accounts.payroll_people p ON p.id = l.payroll_person_id
     LEFT JOIN student_affairs.departments d ON d.id = p.department_id
     WHERE s.disbursement_month_id = $1::uuid
     ORDER BY l.person_name_snapshot, l.person_code_snapshot`,
    [m.id]
  );

  const bySheet = new Map<string, typeof lines.rows>();
  for (const row of lines.rows) {
    const list = bySheet.get(row.sheet_id) ?? [];
    list.push(row);
    bySheet.set(row.sheet_id, list);
  }

  // أسطر الشهر السابق (نفس السنة المالية) لبناء مقارنة أوجه التغير
  const prevMonthNum = previousMonthNumber(monthNumber);
  const prevLines = await txQuery<{
    person_category: DisbursementCategory;
    payroll_person_id: string;
    person_name_snapshot: string;
    base_amount: string;
    assignments_total: string;
  }>(
    client,
    `SELECT s.person_category,
            l.payroll_person_id,
            l.person_name_snapshot,
            l.base_amount::text AS base_amount,
            COALESCE((
              SELECT SUM(al.amount)
              FROM accounts.payroll_disbursement_assignment_lines al
              WHERE al.disbursement_line_id = l.id
            ), 0)::text AS assignments_total
     FROM accounts.payroll_disbursement_lines l
     JOIN accounts.payroll_disbursement_sheets s ON s.id = l.sheet_id
     JOIN accounts.payroll_disbursement_months m ON m.id = s.disbursement_month_id
     WHERE m.fiscal_year_id = $1::uuid AND m.month_number = $2`,
    [fiscalYearId, prevMonthNum]
  );
  const hasPreviousMonth = prevLines.rows.length > 0;
  const prevByCategory = new Map<DisbursementCategory, ComparisonPersonTotals[]>();
  for (const row of prevLines.rows) {
    const list = prevByCategory.get(row.person_category) ?? [];
    list.push({
      payroll_person_id: row.payroll_person_id,
      person_name: row.person_name_snapshot,
      base: money(row.base_amount),
      assignments: money(row.assignments_total),
    });
    prevByCategory.set(row.person_category, list);
  }

  const categories = DISBURSEMENT_CATEGORIES.map((cat) => {
    const sheet = sheets.rows.find((s) => s.person_category === cat) ?? null;
    const sheetLines = sheet ? bySheet.get(sheet.id) ?? [] : [];
    const serialized = sheetLines.map((line) => {
      const base = money(line.base_amount);
      const asg = money(line.assignments_total);
      return {
        id: line.id,
        payroll_person_id: line.payroll_person_id,
        person_code: line.person_code_snapshot,
        person_name: line.person_name_snapshot,
        academic_title: line.academic_title,
        degree: line.degree,
        department_name: line.department_name,
        base_amount: base.toFixed(3),
        assignments_total: asg.toFixed(3),
        assignments_count: line.assignments_count,
        grand_total: (base + asg).toFixed(3),
      };
    });
    const baseTotal = serialized.reduce((s, l) => s + money(l.base_amount), 0);
    const asgTotal = serialized.reduce((s, l) => s + money(l.assignments_total), 0);
    const comparison = hasPreviousMonth
      ? buildSheetComparison(
          serialized.map((l) => ({
            payroll_person_id: l.payroll_person_id,
            person_name: l.person_name,
            base: money(l.base_amount),
            assignments: money(l.assignments_total),
          })),
          prevByCategory.get(cat) ?? []
        )
      : null;
    return {
      person_category: cat,
      category_label: CATEGORY_LABEL[cat],
      sheet_id: sheet?.id ?? null,
      status: sheet?.status ?? 'EMPTY',
      people_count: serialized.length,
      entered_count: serialized.filter(
        (l) => money(l.base_amount) > 0 || money(l.assignments_total) > 0
      ).length,
      base_total: baseTotal.toFixed(3),
      assignments_total: asgTotal.toFixed(3),
      grand_total: (baseTotal + asgTotal).toFixed(3),
      lines: serialized,
      comparison,
    };
  });

  const totals = categories.reduce(
    (acc, c) => {
      acc.people_count += c.people_count;
      acc.entered_count += c.entered_count;
      acc.base += money(c.base_total);
      acc.asg += money(c.assignments_total);
      return acc;
    },
    { people_count: 0, entered_count: 0, base: 0, asg: 0 }
  );

  const grandTotal = totals.base + totals.asg;
  const prevGrandTotal = prevLines.rows.reduce(
    (s, row) => s + money(row.base_amount) + money(row.assignments_total),
    0
  );
  const totalDiff = grandTotal - prevGrandTotal;

  return {
    header,
    categories,
    totals: {
      people_count: totals.people_count,
      entered_count: totals.entered_count,
      base_total: totals.base.toFixed(3),
      assignments_total: totals.asg.toFixed(3),
      grand_total: grandTotal.toFixed(3),
    },
    previous_comparison: hasPreviousMonth
      ? {
          previous_month_number: prevMonthNum,
          previous_month_label: MONTH_LABELS[prevMonthNum - 1],
          previous_total: prevGrandTotal.toFixed(3),
          current_total: grandTotal.toFixed(3),
          diff: totalDiff.toFixed(3),
          direction:
            Math.abs(totalDiff) <= MONEY_EPSILON
              ? ('equal' as const)
              : totalDiff > 0
                ? ('higher' as const)
                : ('lower' as const),
        }
      : null,
  };
}

export async function listDisbursementMonths(
  client: TxClient,
  fiscalYearId: string
): Promise<
  Array<{
    month_number: number;
    month_label: string;
    status: string;
    month_id: string | null;
    sheets: Array<{
      person_category: DisbursementCategory;
      status: string;
      people_count: number;
      entered_count: number;
      base_total: string;
      assignments_total: string;
      grand_total: string;
    }>;
  }>
> {
  await ensureTables(client);
  const months = await txQuery<DisbursementMonthRow>(
    client,
    `SELECT * FROM accounts.payroll_disbursement_months
     WHERE fiscal_year_id=$1::uuid ORDER BY month_number`,
    [fiscalYearId]
  );
  const byMonth = new Map(months.rows.map((m) => [m.month_number, m]));

  const sheetStats = await txQuery<{
    disbursement_month_id: string;
    person_category: DisbursementCategory;
    status: string;
    people_count: number;
    entered_count: number;
    base_total: string;
    assignments_total: string;
  }>(
    client,
    `SELECT s.disbursement_month_id, s.person_category, s.status,
            COUNT(l.id)::int AS people_count,
            COUNT(l.id) FILTER (WHERE l.base_amount > 0 OR EXISTS (
              SELECT 1 FROM accounts.payroll_disbursement_assignment_lines al
              WHERE al.disbursement_line_id = l.id AND al.amount > 0
            ))::int AS entered_count,
            COALESCE(SUM(l.base_amount), 0)::text AS base_total,
            COALESCE((
              SELECT SUM(al.amount)
              FROM accounts.payroll_disbursement_assignment_lines al
              JOIN accounts.payroll_disbursement_lines ll ON ll.id = al.disbursement_line_id
              WHERE ll.sheet_id = s.id
            ), 0)::text AS assignments_total
     FROM accounts.payroll_disbursement_sheets s
     LEFT JOIN accounts.payroll_disbursement_lines l ON l.sheet_id = s.id
     JOIN accounts.payroll_disbursement_months m ON m.id = s.disbursement_month_id
     WHERE m.fiscal_year_id = $1::uuid
     GROUP BY s.id, s.disbursement_month_id, s.person_category, s.status`,
    [fiscalYearId]
  );

  const sheetsByMonth = new Map<string, typeof sheetStats.rows>();
  for (const row of sheetStats.rows) {
    const list = sheetsByMonth.get(row.disbursement_month_id) ?? [];
    list.push(row);
    sheetsByMonth.set(row.disbursement_month_id, list);
  }

  return Array.from({ length: 12 }, (_, i) => {
    const month_number = i + 1;
    const m = byMonth.get(month_number);
    const sheets = m ? sheetsByMonth.get(m.id) ?? [] : [];
    return {
      month_number,
      month_label: MONTH_LABELS[i],
      status: m?.status ?? 'EMPTY',
      month_id: m?.id ?? null,
      sheets: DISBURSEMENT_CATEGORIES.map((cat) => {
        const s = sheets.find((x) => x.person_category === cat);
        const base = money(s?.base_total);
        const asg = money(s?.assignments_total);
        return {
          person_category: cat,
          status: s?.status ?? 'DRAFT',
          people_count: s?.people_count ?? 0,
          entered_count: s?.entered_count ?? 0,
          base_total: base.toFixed(3),
          assignments_total: asg.toFixed(3),
          grand_total: (base + asg).toFixed(3),
        };
      }),
    };
  });
}

async function loadFiscalYear(client: TxClient, fiscalYearId: string) {
  const r = await txQuery<{ id: string; code: string; start_date: string }>(
    client,
    `SELECT id, code, start_date::text AS start_date
     FROM accounts.fiscal_years WHERE id=$1::uuid`,
    [fiscalYearId]
  );
  if (!r.rows[0]) throw new AccountsHttpError('السنة المالية غير موجودة', 404);
  return r.rows[0];
}

export async function ensureDisbursementMonth(
  client: TxClient,
  p: { fiscal_year_id: string; month_number: number; userId: string }
): Promise<DisbursementMonthRow> {
  await ensureTables(client);
  const monthNumber = Number(p.month_number);
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    throw new AccountsHttpError('رقم الشهر غير صالح', 400);
  }
  const year = await loadFiscalYear(client, p.fiscal_year_id);
  const yearLabel = year.code.match(/^\d{4}/)?.[0] ?? year.start_date.slice(0, 4);

  const existing = await txQuery<DisbursementMonthRow>(
    client,
    `SELECT * FROM accounts.payroll_disbursement_months
     WHERE fiscal_year_id=$1::uuid AND month_number=$2`,
    [p.fiscal_year_id, monthNumber]
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await txQuery<DisbursementMonthRow>(
    client,
    `INSERT INTO accounts.payroll_disbursement_months
       (fiscal_year_id, year_label, month_number, status, created_by, updated_by)
     VALUES ($1::uuid,$2,$3,'DRAFT',$4::uuid,$4::uuid)
     RETURNING *`,
    [p.fiscal_year_id, yearLabel, monthNumber, p.userId]
  );
  return created.rows[0];
}

async function syncAssignmentLinesForLine(
  client: TxClient,
  p: {
    lineId: string;
    personId: string;
    from: string;
    to: string;
    userId: string;
  }
) {
  const assignments = await txQuery<{
    id: string;
    assignment_code: string;
    title_ar: string;
    effective_from: string | Date;
    effective_to: string | Date | null;
  }>(
    client,
    `SELECT id, assignment_code, title_ar, effective_from, effective_to
     FROM accounts.payroll_assignments
     WHERE payroll_person_id=$1::uuid
       AND status IN ('DRAFT','ACTIVE','SUSPENDED')
       AND effective_from::date <= $3::date
       AND (effective_to IS NULL OR effective_to::date >= $2::date)`,
    [p.personId, p.from, p.to]
  );

  for (const a of assignments.rows) {
    const aFrom = dateStr(a.effective_from)!;
    const aTo = dateStr(a.effective_to);
    const isPartial = aFrom > p.from || (aTo != null && aTo < p.to);
    await txQuery(
      client,
      `INSERT INTO accounts.payroll_disbursement_assignment_lines
         (disbursement_line_id, payroll_assignment_id, assignment_code_snapshot,
          assignment_title_snapshot, amount, is_partial, created_by, updated_by)
       VALUES ($1::uuid,$2::uuid,$3,$4,0,$5,$6::uuid,$6::uuid)
       ON CONFLICT (disbursement_line_id, payroll_assignment_id)
       DO UPDATE SET
         assignment_code_snapshot = EXCLUDED.assignment_code_snapshot,
         assignment_title_snapshot = EXCLUDED.assignment_title_snapshot,
         is_partial = EXCLUDED.is_partial,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [p.lineId, a.id, a.assignment_code, a.title_ar, isPartial, p.userId]
    );
  }
}

export async function openOrCreateSheet(
  client: TxClient,
  p: {
    fiscal_year_id: string;
    month_number: number;
    person_category: string;
    userId: string;
  }
) {
  await ensureTables(client);
  if (!DISBURSEMENT_CATEGORIES.includes(p.person_category as DisbursementCategory)) {
    throw new AccountsHttpError('فئة الكشف غير صالحة', 400);
  }
  const category = p.person_category as DisbursementCategory;
  const month = await ensureDisbursementMonth(client, {
    fiscal_year_id: p.fiscal_year_id,
    month_number: p.month_number,
    userId: p.userId,
  });
  const bounds = monthBounds(month.year_label, month.month_number);

  let sheet = (
    await txQuery<DisbursementSheetRow>(
      client,
      `SELECT * FROM accounts.payroll_disbursement_sheets
       WHERE disbursement_month_id=$1::uuid AND person_category=$2`,
      [month.id, category]
    )
  ).rows[0];

  if (!sheet) {
    sheet = (
      await txQuery<DisbursementSheetRow>(
        client,
        `INSERT INTO accounts.payroll_disbursement_sheets
           (disbursement_month_id, person_category, status, created_by, updated_by)
         VALUES ($1::uuid,$2,'DRAFT',$3::uuid,$3::uuid)
         RETURNING *`,
        [month.id, category, p.userId]
      )
    ).rows[0];
  }

  // مزامنة الأشخاص النشطين (لا نلمس المبالغ الموجودة)
  if (sheet.status !== 'LOCKED' && sheet.status !== 'DISBURSED') {
    const people = await txQuery<{ id: string; person_code: string; full_name_ar: string }>(
      client,
      `SELECT id, person_code, full_name_ar
       FROM accounts.payroll_people
       WHERE person_type=$1 AND status='ACTIVE'
       ORDER BY person_code`,
      [category]
    );
    for (const person of people.rows) {
      const line = await txQuery<DisbursementLineRow>(
        client,
        `INSERT INTO accounts.payroll_disbursement_lines
           (sheet_id, payroll_person_id, person_code_snapshot, person_name_snapshot,
            base_amount, line_status, created_by, updated_by)
         VALUES ($1::uuid,$2::uuid,$3,$4,0,'EMPTY',$5::uuid,$5::uuid)
         ON CONFLICT (sheet_id, payroll_person_id)
         DO UPDATE SET
           person_code_snapshot = EXCLUDED.person_code_snapshot,
           person_name_snapshot = EXCLUDED.person_name_snapshot,
           updated_at = NOW()
         RETURNING *`,
        [sheet.id, person.id, person.person_code, person.full_name_ar, p.userId]
      );
      await syncAssignmentLinesForLine(client, {
        lineId: line.rows[0].id,
        personId: person.id,
        from: bounds.from,
        to: bounds.to,
        userId: p.userId,
      });
    }
  }

  return getSheetDetail(client, sheet.id);
}

export async function getSheetDetail(client: TxClient, sheetId: string) {
  await ensureTables(client);
  const sheet = await txQuery<
    DisbursementSheetRow & {
      fiscal_year_id: string;
      year_label: string;
      month_number: number;
      month_status: string;
    }
  >(
    client,
    `SELECT s.*, m.fiscal_year_id, m.year_label, m.month_number, m.status AS month_status
     FROM accounts.payroll_disbursement_sheets s
     JOIN accounts.payroll_disbursement_months m ON m.id = s.disbursement_month_id
     WHERE s.id=$1::uuid`,
    [sheetId]
  );
  if (!sheet.rows[0]) throw new AccountsHttpError('كشف الصرف غير موجود', 404);
  const s = sheet.rows[0];

  const lines = await txQuery<
    DisbursementLineRow & {
      academic_title: string | null;
      degree: string | null;
      department_name_ar: string | null;
      workplace: string | null;
      affiliation: string | null;
    }
  >(
    client,
    `SELECT l.*,
            p.academic_title,
            p.degree,
            d.name_ar AS department_name_ar,
            p.workplace,
            p.affiliation
     FROM accounts.payroll_disbursement_lines l
     LEFT JOIN accounts.payroll_people p ON p.id = l.payroll_person_id
     LEFT JOIN student_affairs.departments d ON d.id = p.department_id
     WHERE l.sheet_id=$1::uuid
     ORDER BY l.person_name_snapshot, l.person_code_snapshot`,
    [sheetId]
  );
  const asg = await txQuery<DisbursementAssignmentLineRow>(
    client,
    `SELECT al.*
     FROM accounts.payroll_disbursement_assignment_lines al
     JOIN accounts.payroll_disbursement_lines l ON l.id = al.disbursement_line_id
     WHERE l.sheet_id=$1::uuid
     ORDER BY al.assignment_code_snapshot`,
    [sheetId]
  );
  const asgByLine = new Map<string, DisbursementAssignmentLineRow[]>();
  for (const a of asg.rows) {
    const list = asgByLine.get(a.disbursement_line_id) ?? [];
    list.push(a);
    asgByLine.set(a.disbursement_line_id, list);
  }

  const serializedLines = lines.rows.map((line) => {
    const assignments = (asgByLine.get(line.id) ?? []).map(serializeAssignmentLine);
    const assignmentsTotal = assignments.reduce((sum, a) => sum + money(a.amount), 0);
    const base = money(line.base_amount);
    const department =
      line.department_name_ar ||
      line.workplace ||
      line.affiliation ||
      null;
    return {
      ...serializeLine(line),
      academic_title: line.academic_title,
      degree: line.degree,
      department_name: department,
      assignments,
      assignments_total: assignmentsTotal.toFixed(3),
      grand_total: (base + assignmentsTotal).toFixed(3),
    };
  });

  const baseTotal = serializedLines.reduce((s, l) => s + money(l.base_amount), 0);
  const asgTotal = serializedLines.reduce((s, l) => s + money(l.assignments_total), 0);
  const entered = serializedLines.filter(
    (l) => money(l.base_amount) > 0 || money(l.assignments_total) > 0
  ).length;

  // بيانات الشهر السابق للفئة نفسها — لعرض تنبيه المقارنة الحي في الواجهة
  const prevSheetRef = await findPreviousSheetRef(
    client,
    s.fiscal_year_id,
    s.month_number,
    s.person_category
  );
  let previousMonth: {
    month_number: number;
    month_label: string;
    lines: Array<{
      payroll_person_id: string;
      person_name: string;
      base_amount: string;
      assignments_total: string;
    }>;
  } | null = null;
  if (prevSheetRef) {
    const prevTotals = await getSheetPersonTotals(client, prevSheetRef.id);
    previousMonth = {
      month_number: prevSheetRef.month_number,
      month_label: MONTH_LABELS[prevSheetRef.month_number - 1],
      lines: prevTotals.map((l) => ({
        payroll_person_id: l.payroll_person_id,
        person_name: l.person_name,
        base_amount: l.base.toFixed(3),
        assignments_total: l.assignments.toFixed(3),
      })),
    };
  }

  return {
    sheet: {
      ...serializeSheet(s),
      fiscal_year_id: s.fiscal_year_id,
      year_label: s.year_label,
      month_number: s.month_number,
      month_status: s.month_status,
      category_label: CATEGORY_LABEL[s.person_category],
      month_label: MONTH_LABELS[s.month_number - 1],
    },
    lines: serializedLines,
    summary: {
      people_count: serializedLines.length,
      entered_count: entered,
      base_total: baseTotal.toFixed(3),
      assignments_total: asgTotal.toFixed(3),
      grand_total: (baseTotal + asgTotal).toFixed(3),
    },
    previous_month: previousMonth,
  };
}

export async function saveSheetLines(
  client: TxClient,
  p: {
    sheetId: string;
    userId: string;
    version: unknown;
    lines: Array<{
      id: string;
      base_amount?: unknown;
      notes?: unknown;
      assignments?: Array<{ id: string; amount?: unknown }>;
    }>;
  }
) {
  await ensureTables(client);
  const sheet = await txQuery<DisbursementSheetRow>(
    client,
    `SELECT * FROM accounts.payroll_disbursement_sheets WHERE id=$1::uuid FOR UPDATE`,
    [p.sheetId]
  );
  if (!sheet.rows[0]) throw new AccountsHttpError('كشف الصرف غير موجود', 404);
  const s = sheet.rows[0];
  assertEditableSheet(s.status);
  const v = Number(p.version);
  if (!Number.isInteger(v) || v !== s.version) {
    throw new AccountsHttpError('تم تعديل الكشف بواسطة مستخدم آخر. حدّث الصفحة ثم أعد المحاولة.', 409);
  }

  for (const item of p.lines ?? []) {
    if (!item?.id) continue;
    const line = await txQuery<DisbursementLineRow>(
      client,
      `SELECT * FROM accounts.payroll_disbursement_lines
       WHERE id=$1::uuid AND sheet_id=$2::uuid FOR UPDATE`,
      [item.id, p.sheetId]
    );
    if (!line.rows[0]) continue;
    const base =
      item.base_amount === undefined
        ? money(line.rows[0].base_amount)
        : Number(nonNegativeMoney(item.base_amount, 'الراتب الأساسي'));
    const notes =
      item.notes === undefined
        ? line.rows[0].notes
        : String(item.notes ?? '').trim() || null;
    const lineStatus = base > 0 ? 'SAVED' : 'EMPTY';
    await txQuery(
      client,
      `UPDATE accounts.payroll_disbursement_lines
       SET base_amount=$2, notes=$3, line_status=$4,
           updated_by=$5::uuid, updated_at=NOW(), version=version+1
       WHERE id=$1::uuid`,
      [item.id, base.toFixed(3), notes, lineStatus, p.userId]
    );

    for (const asg of item.assignments ?? []) {
      if (!asg?.id) continue;
      const amount =
        asg.amount === undefined
          ? null
          : Number(nonNegativeMoney(asg.amount, 'مبلغ التكليف'));
      if (amount == null) continue;
      await txQuery(
        client,
        `UPDATE accounts.payroll_disbursement_assignment_lines
         SET amount=$2, updated_by=$3::uuid, updated_at=NOW(), version=version+1
         WHERE id=$1::uuid AND disbursement_line_id=$4::uuid`,
        [asg.id, amount.toFixed(3), p.userId, item.id]
      );
    }
  }

  await txQuery(
    client,
    `UPDATE accounts.payroll_disbursement_sheets
     SET status='SAVED', updated_by=$2::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid`,
    [p.sheetId, p.userId]
  );
  await txQuery(
    client,
    `UPDATE accounts.payroll_disbursement_months
     SET status = CASE WHEN status IN ('LOCKED','DISBURSED') THEN status ELSE 'SAVED' END,
         updated_by=$2::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid`,
    [s.disbursement_month_id, p.userId]
  );

  return getSheetDetail(client, p.sheetId);
}

export async function setSheetStatus(
  client: TxClient,
  p: {
    sheetId: string;
    userId: string;
    version: unknown;
    action: 'lock' | 'unlock' | 'disburse';
    reason?: unknown;
  }
) {
  await ensureTables(client);
  const sheet = await txQuery<DisbursementSheetRow>(
    client,
    `SELECT * FROM accounts.payroll_disbursement_sheets WHERE id=$1::uuid FOR UPDATE`,
    [p.sheetId]
  );
  if (!sheet.rows[0]) throw new AccountsHttpError('كشف الصرف غير موجود', 404);
  const s = sheet.rows[0];
  const v = Number(p.version);
  if (!Number.isInteger(v) || v !== s.version) {
    throw new AccountsHttpError('تم تعديل الكشف بواسطة مستخدم آخر. حدّث الصفحة ثم أعد المحاولة.', 409);
  }

  let next = s.status;
  if (p.action === 'lock') {
    if (s.status === 'DISBURSED') throw new AccountsHttpError('لا يمكن قفل كشف مصروف', 409);
    if (s.status === 'LOCKED') return getSheetDetail(client, p.sheetId);
    const detail = await getSheetDetail(client, p.sheetId);
    if (detail.summary.people_count === 0) {
      throw new AccountsHttpError('لا يمكن قفل كشف بلا أشخاص', 400);
    }
    if (detail.summary.entered_count < detail.summary.people_count) {
      throw new AccountsHttpError(
        `لا يمكن قفل الكشف قبل إدخال المبالغ لجميع الأسطر (${detail.summary.entered_count}/${detail.summary.people_count})`,
        400
      );
    }
    next = 'LOCKED';
  } else if (p.action === 'unlock') {
    if (s.status === 'DISBURSED') throw new AccountsHttpError('لا يمكن فك قفل كشف مصروف', 409);
    if (s.status !== 'LOCKED') throw new AccountsHttpError('الكشف غير مقفل', 409);
    requiredReason(p.reason, 'سبب فك القفل');
    next = 'SAVED';
  } else if (p.action === 'disburse') {
    if (s.status !== 'LOCKED' && s.status !== 'SAVED') {
      throw new AccountsHttpError('يجب حفظ أو قفل الكشف قبل تأكيد الصرف', 409);
    }
    const detail = await getSheetDetail(client, p.sheetId);
    if (detail.summary.entered_count < detail.summary.people_count || detail.summary.people_count === 0) {
      throw new AccountsHttpError('لا يمكن صرف كشف غير مكتمل', 400);
    }
    next = 'DISBURSED';
  }

  await txQuery(
    client,
    `UPDATE accounts.payroll_disbursement_sheets
     SET status=$2, updated_by=$3::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid`,
    [p.sheetId, next, p.userId]
  );

  // تحديث حالة الشهر وفق أعلى حالة للكشوف
  const statuses = await txQuery<{ status: string }>(
    client,
    `SELECT status FROM accounts.payroll_disbursement_sheets WHERE disbursement_month_id=$1::uuid`,
    [s.disbursement_month_id]
  );
  const set = new Set(statuses.rows.map((x) => x.status));
  let monthStatus = 'DRAFT';
  if (set.has('DISBURSED') && [...set].every((x) => x === 'DISBURSED')) monthStatus = 'DISBURSED';
  else if (set.has('LOCKED')) monthStatus = 'LOCKED';
  else if (set.has('SAVED') || set.has('DISBURSED')) monthStatus = 'SAVED';
  else if (set.has('DRAFT')) monthStatus = 'DRAFT';

  await txQuery(
    client,
    `UPDATE accounts.payroll_disbursement_months
     SET status=$2, updated_by=$3::uuid, updated_at=NOW(), version=version+1
     WHERE id=$1::uuid`,
    [s.disbursement_month_id, monthStatus, p.userId]
  );

  return getSheetDetail(client, p.sheetId);
}

export async function copyPreviousMonthAmounts(
  client: TxClient,
  p: { sheetId: string; userId: string; version: unknown }
) {
  await ensureTables(client);
  const current = await getSheetDetail(client, p.sheetId);
  assertEditableSheet(current.sheet.status);
  const v = Number(p.version);
  if (!Number.isInteger(v) || v !== current.sheet.version) {
    throw new AccountsHttpError('تم تعديل الكشف بواسطة مستخدم آخر. حدّث الصفحة ثم أعد المحاولة.', 409);
  }

  const prevMonth = current.sheet.month_number === 1 ? 12 : current.sheet.month_number - 1;
  const prev = await txQuery<{ id: string }>(
    client,
    `SELECT s.id
     FROM accounts.payroll_disbursement_sheets s
     JOIN accounts.payroll_disbursement_months m ON m.id = s.disbursement_month_id
     WHERE m.fiscal_year_id=$1::uuid
       AND m.month_number=$2
       AND s.person_category=$3
     LIMIT 1`,
    [current.sheet.fiscal_year_id, prevMonth, current.sheet.person_category]
  );
  if (!prev.rows[0]) {
    throw new AccountsHttpError('لا يوجد كشف للشهر السابق لنسخ المبالغ منه', 404);
  }
  const prevDetail = await getSheetDetail(client, prev.rows[0].id);
  const byPerson = new Map(prevDetail.lines.map((l) => [l.payroll_person_id, l]));

  const payload = current.lines.map((line) => {
    const prevLine = byPerson.get(line.payroll_person_id);
    return {
      id: line.id,
      base_amount: prevLine?.base_amount ?? line.base_amount,
      assignments: line.assignments.map((a) => {
        const prevAsg = prevLine?.assignments?.find(
          (x) => x.payroll_assignment_id === a.payroll_assignment_id
        );
        return { id: a.id, amount: prevAsg?.amount ?? a.amount };
      }),
    };
  });

  return saveSheetLines(client, {
    sheetId: p.sheetId,
    userId: p.userId,
    version: current.sheet.version,
    lines: payload,
  });
}
