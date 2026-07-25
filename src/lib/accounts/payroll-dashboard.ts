/** إحصائيات لوحة تحكم الرواتب — من الأشخاص والتكليفات وكشوف الصرف */
import {
  CATEGORY_LABEL,
  DISBURSEMENT_CATEGORIES,
  MONTH_LABELS,
  listFiscalYearsForDisbursement,
  type DisbursementCategory,
} from './payroll-disbursement';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

function money(v: string | number | null | undefined): number {
  return Number(v ?? 0);
}

function moneyStr(v: number): string {
  return v.toFixed(3);
}

type PersonLine = {
  month_number: number;
  person_category: DisbursementCategory;
  payroll_person_id: string;
  person_name: string;
  base_amount: string;
  assignments_total: string;
  sheet_status: string;
  month_status: string;
};

export type PayrollDashboardStats = {
  fiscal_year: {
    id: string;
    code: string;
    name_ar: string;
  } | null;
  people_counts: {
    TEACHING_STAFF: number;
    EXTERNAL_LECTURER: number;
    EMPLOYEE: number;
    DAILY_WORKER: number;
    total_active: number;
  };
  active_assignments: number;
  disbursed_months_count: number;
  lifetime_disbursed_total: string;
  year_disbursed_total: string;
  sheet_status_counts: {
    DRAFT: number;
    SAVED: number;
    LOCKED: number;
    DISBURSED: number;
  };
  last_month: {
    month_number: number;
    month_label: string;
    grand_total: string;
    people_with_salary: number;
    avg_salary: string;
    by_category: Array<{
      person_category: DisbursementCategory;
      category_label: string;
      total: string;
      people_count: number;
    }>;
    vs_previous: {
      previous_month_number: number;
      previous_month_label: string;
      previous_total: string;
      diff: string;
      direction: 'higher' | 'lower' | 'equal' | 'no_previous';
    };
  } | null;
  salary_extremes: {
    max: string;
    max_count: number;
    min: string;
    min_count: number;
  } | null;
  monthly_trend: Array<{
    month_number: number;
    month_label: string;
    total: string;
    disbursed_total: string;
  }>;
};

async function loadPersonLines(client: TxClient, fiscalYearId: string | null): Promise<PersonLine[]> {
  if (!fiscalYearId) return [];
  const r = await txQuery<{
    month_number: number;
    person_category: DisbursementCategory;
    payroll_person_id: string;
    person_name_snapshot: string;
    base_amount: string;
    assignments_total: string;
    sheet_status: string;
    month_status: string;
  }>(
    client,
    `SELECT m.month_number,
            s.person_category,
            l.payroll_person_id,
            l.person_name_snapshot,
            l.base_amount::text AS base_amount,
            COALESCE((
              SELECT SUM(al.amount)
              FROM accounts.payroll_disbursement_assignment_lines al
              WHERE al.disbursement_line_id = l.id
            ), 0)::text AS assignments_total,
            s.status AS sheet_status,
            m.status AS month_status
     FROM accounts.payroll_disbursement_lines l
     JOIN accounts.payroll_disbursement_sheets s ON s.id = l.sheet_id
     JOIN accounts.payroll_disbursement_months m ON m.id = s.disbursement_month_id
     WHERE m.fiscal_year_id = $1::uuid`,
    [fiscalYearId]
  );
  return r.rows.map((row) => ({
    month_number: row.month_number,
    person_category: row.person_category,
    payroll_person_id: row.payroll_person_id,
    person_name: row.person_name_snapshot,
    base_amount: row.base_amount,
    assignments_total: row.assignments_total,
    sheet_status: row.sheet_status,
    month_status: row.month_status,
  }));
}

export async function getPayrollDashboardStats(client: TxClient): Promise<PayrollDashboardStats> {
  // يضمن إنشاء جداول الصرف إن لزم
  const years = await listFiscalYearsForDisbursement(client);
  const fiscalYear =
    years.find((y) => y.is_default) ||
    years.find((y) => y.status === 'ACTIVE') ||
    years[0] ||
    null;

  const peopleR = await txQuery<{ person_type: string; cnt: string }>(
    client,
    `SELECT person_type, COUNT(*)::text AS cnt
     FROM accounts.payroll_people
     WHERE status = 'ACTIVE'
       AND person_type IN ('TEACHING_STAFF','EXTERNAL_LECTURER','EMPLOYEE','DAILY_WORKER')
     GROUP BY person_type`
  );
  const people_counts = {
    TEACHING_STAFF: 0,
    EXTERNAL_LECTURER: 0,
    EMPLOYEE: 0,
    DAILY_WORKER: 0,
    total_active: 0,
  };
  for (const row of peopleR.rows) {
    const n = Number(row.cnt || 0);
    if (row.person_type in people_counts) {
      (people_counts as Record<string, number>)[row.person_type] = n;
    }
    people_counts.total_active += n;
  }

  const asgR = await txQuery<{ cnt: string }>(
    client,
    `SELECT COUNT(*)::text AS cnt
     FROM accounts.payroll_assignments
     WHERE status = 'ACTIVE'`
  );
  const active_assignments = Number(asgR.rows[0]?.cnt || 0);

  const lifetimeLines = await txQuery<{ base_amount: string; assignments_total: string }>(
    client,
    `SELECT l.base_amount::text AS base_amount,
            COALESCE((
              SELECT SUM(al.amount)
              FROM accounts.payroll_disbursement_assignment_lines al
              WHERE al.disbursement_line_id = l.id
            ), 0)::text AS assignments_total
     FROM accounts.payroll_disbursement_lines l
     JOIN accounts.payroll_disbursement_sheets s ON s.id = l.sheet_id
     WHERE s.status = 'DISBURSED'`
  );
  const lifetime_disbursed_total = moneyStr(
    lifetimeLines.rows.reduce(
      (sum, row) => sum + money(row.base_amount) + money(row.assignments_total),
      0
    )
  );

  const disbursedMonthsR = await txQuery<{ months: string }>(
    client,
    `SELECT COUNT(DISTINCT m.id)::text AS months
     FROM accounts.payroll_disbursement_months m
     WHERE EXISTS (
       SELECT 1 FROM accounts.payroll_disbursement_sheets s
       WHERE s.disbursement_month_id = m.id AND s.status = 'DISBURSED'
     )`
  );
  const disbursed_months_count = Number(disbursedMonthsR.rows[0]?.months || 0);

  const yearLines = await loadPersonLines(client, fiscalYear?.id ?? null);

  const year_disbursed_total = moneyStr(
    yearLines
      .filter((l) => l.sheet_status === 'DISBURSED')
      .reduce((sum, l) => sum + money(l.base_amount) + money(l.assignments_total), 0)
  );

  const sheet_status_counts = { DRAFT: 0, SAVED: 0, LOCKED: 0, DISBURSED: 0 };
  if (fiscalYear) {
    const statusR = await txQuery<{ status: string; cnt: string }>(
      client,
      `SELECT s.status, COUNT(*)::text AS cnt
       FROM accounts.payroll_disbursement_sheets s
       JOIN accounts.payroll_disbursement_months m ON m.id = s.disbursement_month_id
       WHERE m.fiscal_year_id = $1::uuid
       GROUP BY s.status`,
      [fiscalYear.id]
    );
    for (const row of statusR.rows) {
      if (row.status in sheet_status_counts) {
        (sheet_status_counts as Record<string, number>)[row.status] = Number(row.cnt || 0);
      }
    }
  }

  // اتجاه الأشهر: مجموع كل الكشوف (لرسم الاتجاه) + المصروف فقط
  const monthly_trend = Array.from({ length: 12 }, (_, i) => {
    const month_number = i + 1;
    const ofMonth = yearLines.filter((l) => l.month_number === month_number);
    const total = ofMonth.reduce(
      (s, l) => s + money(l.base_amount) + money(l.assignments_total),
      0
    );
    const disbursed_total = ofMonth
      .filter((l) => l.sheet_status === 'DISBURSED')
      .reduce((s, l) => s + money(l.base_amount) + money(l.assignments_total), 0);
    return {
      month_number,
      month_label: MONTH_LABELS[i],
      total: moneyStr(total),
      disbursed_total: moneyStr(disbursed_total),
    };
  });

  // اختيار آخر شهر: يفضّل آخر شهر فيه كشف DISBURSED، وإلا آخر شهر فيه أي بيانات
  const monthsWithData = [...new Set(yearLines.map((l) => l.month_number))].sort(
    (a, b) => b - a
  );
  const monthsWithDisbursed = [
    ...new Set(
      yearLines.filter((l) => l.sheet_status === 'DISBURSED').map((l) => l.month_number)
    ),
  ].sort((a, b) => b - a);
  const lastMonthNumber = monthsWithDisbursed[0] ?? monthsWithData[0] ?? null;

  let last_month: PayrollDashboardStats['last_month'] = null;
  let salary_extremes: PayrollDashboardStats['salary_extremes'] = null;

  if (lastMonthNumber != null) {
    const lastLines = yearLines.filter((l) => l.month_number === lastMonthNumber);
    const byPerson = new Map<string, { name: string; total: number; category: DisbursementCategory }>();
    for (const line of lastLines) {
      const t = money(line.base_amount) + money(line.assignments_total);
      const prev = byPerson.get(line.payroll_person_id);
      if (prev) prev.total += t;
      else {
        byPerson.set(line.payroll_person_id, {
          name: line.person_name,
          total: t,
          category: line.person_category,
        });
      }
    }

    const by_category = DISBURSEMENT_CATEGORIES.map((cat) => {
      const catLines = lastLines.filter((l) => l.person_category === cat);
      const total = catLines.reduce(
        (s, l) => s + money(l.base_amount) + money(l.assignments_total),
        0
      );
      const people = new Set(catLines.map((l) => l.payroll_person_id)).size;
      return {
        person_category: cat,
        category_label: CATEGORY_LABEL[cat],
        total: moneyStr(total),
        people_count: people,
      };
    });

    const grand = by_category.reduce((s, c) => s + money(c.total), 0);
    const peopleWithSalary = [...byPerson.values()].filter((p) => p.total > 0.0005);
    const avg =
      peopleWithSalary.length > 0
        ? peopleWithSalary.reduce((s, p) => s + p.total, 0) / peopleWithSalary.length
        : 0;

    const prevMonthNumber = lastMonthNumber === 1 ? 12 : lastMonthNumber - 1;
    const prevLines = yearLines.filter((l) => l.month_number === prevMonthNumber);
    const hasPrev = prevLines.length > 0;
    const prevTotal = prevLines.reduce(
      (s, l) => s + money(l.base_amount) + money(l.assignments_total),
      0
    );
    const diff = grand - prevTotal;

    last_month = {
      month_number: lastMonthNumber,
      month_label: MONTH_LABELS[lastMonthNumber - 1],
      grand_total: moneyStr(grand),
      people_with_salary: peopleWithSalary.length,
      avg_salary: moneyStr(avg),
      by_category,
      vs_previous: hasPrev
        ? {
            previous_month_number: prevMonthNumber,
            previous_month_label: MONTH_LABELS[prevMonthNumber - 1],
            previous_total: moneyStr(prevTotal),
            diff: moneyStr(diff),
            direction:
              Math.abs(diff) <= 0.0005 ? 'equal' : diff > 0 ? 'higher' : 'lower',
          }
        : {
            previous_month_number: prevMonthNumber,
            previous_month_label: MONTH_LABELS[prevMonthNumber - 1],
            previous_total: '0.000',
            diff: moneyStr(grand),
            direction: 'no_previous',
          },
    };

    if (peopleWithSalary.length > 0) {
      const max = Math.max(...peopleWithSalary.map((p) => p.total));
      const min = Math.min(...peopleWithSalary.map((p) => p.total));
      salary_extremes = {
        max: moneyStr(max),
        max_count: peopleWithSalary.filter((p) => Math.abs(p.total - max) <= 0.0005).length,
        min: moneyStr(min),
        min_count: peopleWithSalary.filter((p) => Math.abs(p.total - min) <= 0.0005).length,
      };
    }
  }

  return {
    fiscal_year: fiscalYear
      ? { id: fiscalYear.id, code: fiscalYear.code, name_ar: fiscalYear.name_ar }
      : null,
    people_counts,
    active_assignments,
    disbursed_months_count,
    lifetime_disbursed_total,
    year_disbursed_total,
    sheet_status_counts,
    last_month,
    salary_extremes,
    monthly_trend,
  };
}
