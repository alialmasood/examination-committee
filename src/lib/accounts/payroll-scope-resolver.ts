/**
 * حل نطاق تشغيل الرواتب → أشخاص مرشّحون (9.A.2.3.1)
 *
 * COLLEGE: colleges ← departments.college_id ← payroll_assignments.department_id ← people
 */
import { AccountsHttpError } from './auth';
import { dateStr, requirePayrollUuid } from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type ResolvedPayrollPerson = {
  id: string;
  person_code: string;
  full_name_ar: string;
  person_type: string;
  status: string;
  department_id: string | null;
  default_cost_center_id: string | null;
  default_currency_code: string;
  effective_from: string;
  effective_to: string | null;
  version: number;
  updated_at: string;
  /** PERSON_LIST فقط: عضو غير مؤهل هيكليًا يُدرَج كـ EXCLUDED لاحقًا */
  scope_ineligible?: boolean;
};

const PERSON_SELECT = `
  p.id, p.person_code, p.full_name_ar, p.person_type, p.status,
  p.department_id, p.default_cost_center_id, p.default_currency_code,
  p.effective_from::text, p.effective_to::text, p.version, p.updated_at
`;

function mapPerson(row: Record<string, unknown>, ineligible = false): ResolvedPayrollPerson {
  return {
    id: String(row.id),
    person_code: String(row.person_code),
    full_name_ar: String(row.full_name_ar),
    person_type: String(row.person_type),
    status: String(row.status),
    department_id: row.department_id == null ? null : String(row.department_id),
    default_cost_center_id:
      row.default_cost_center_id == null ? null : String(row.default_cost_center_id),
    default_currency_code: String(row.default_currency_code),
    effective_from: String(row.effective_from).slice(0, 10),
    effective_to: row.effective_to == null ? null : String(row.effective_to).slice(0, 10),
    version: Number(row.version),
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(String(row.updated_at)).toISOString(),
    scope_ineligible: ineligible || undefined,
  };
}

function sortUnique(people: ResolvedPayrollPerson[]): ResolvedPayrollPerson[] {
  const byId = new Map<string, ResolvedPayrollPerson>();
  for (const p of people) {
    if (!byId.has(p.id)) byId.set(p.id, p);
  }
  return [...byId.values()].sort((a, b) => {
    const c = a.person_code.localeCompare(b.person_code, 'en');
    if (c !== 0) return c;
    return a.id.localeCompare(b.id, 'en');
  });
}

const ACTIVE_PERSON_ON_DATE = `
  p.status = 'ACTIVE'
  AND p.effective_from <= $1::date
  AND (p.effective_to IS NULL OR p.effective_to >= $1::date)
`;

const ACTIVE_ASSIGNMENT_ON_DATE = `
  a.status = 'ACTIVE'
  AND a.effective_from <= $1::date
  AND (a.effective_to IS NULL OR a.effective_to >= $1::date)
`;

export async function resolvePayrollRunPersons(
  client: TxClient,
  p: {
    scope_type: string;
    scope_ref_id: string | null;
    calculation_date: string | Date;
    run_id: string;
  }
): Promise<ResolvedPayrollPerson[]> {
  const calcDate = dateStr(p.calculation_date);
  if (!calcDate) throw new AccountsHttpError('تاريخ الاحتساب غير صالح', 400);
  const scope = String(p.scope_type).trim().toUpperCase();
  const runId = requirePayrollUuid(p.run_id, 'معرّف التشغيل');

  if (scope === 'ALL') {
    const r = await txQuery(
      client,
      `SELECT DISTINCT ON (p.id) ${PERSON_SELECT}
       FROM accounts.payroll_people p
       WHERE ${ACTIVE_PERSON_ON_DATE}
       ORDER BY p.id, p.person_code`,
      [calcDate]
    );
    return sortUnique(r.rows.map((row) => mapPerson(row as Record<string, unknown>)));
  }

  if (scope === 'DEPARTMENT') {
    const ref = requirePayrollUuid(p.scope_ref_id, 'مرجع القسم');
    const r = await txQuery(
      client,
      `SELECT DISTINCT ON (p.id) ${PERSON_SELECT}
       FROM accounts.payroll_assignments a
       JOIN accounts.payroll_people p ON p.id = a.payroll_person_id
       WHERE a.department_id = $2::uuid
         AND ${ACTIVE_ASSIGNMENT_ON_DATE}
         AND ${ACTIVE_PERSON_ON_DATE}
       ORDER BY p.id, p.person_code`,
      [calcDate, ref]
    );
    return sortUnique(r.rows.map((row) => mapPerson(row as Record<string, unknown>)));
  }

  if (scope === 'COLLEGE') {
    const ref = requirePayrollUuid(p.scope_ref_id, 'مرجع الكلية');
    // colleges ← departments.college_id ← payroll_assignments.department_id ← people
    const r = await txQuery(
      client,
      `SELECT DISTINCT ON (p.id) ${PERSON_SELECT}
       FROM student_affairs.colleges c
       JOIN student_affairs.departments d ON d.college_id = c.id
       JOIN accounts.payroll_assignments a ON a.department_id = d.id
       JOIN accounts.payroll_people p ON p.id = a.payroll_person_id
       WHERE c.id = $2::uuid
         AND ${ACTIVE_ASSIGNMENT_ON_DATE}
         AND ${ACTIVE_PERSON_ON_DATE}
       ORDER BY p.id, p.person_code`,
      [calcDate, ref]
    );
    return sortUnique(r.rows.map((row) => mapPerson(row as Record<string, unknown>)));
  }

  if (scope === 'COST_CENTER') {
    const ref = requirePayrollUuid(p.scope_ref_id, 'مرجع مركز الكلفة');
    // تكليف نشط بـ cost_center_id أو شخص بـ default_cost_center_id
    const r = await txQuery(
      client,
      `SELECT DISTINCT ON (p.id) ${PERSON_SELECT}
       FROM accounts.payroll_people p
       WHERE ${ACTIVE_PERSON_ON_DATE}
         AND (
           p.default_cost_center_id = $2::uuid
           OR EXISTS (
             SELECT 1 FROM accounts.payroll_assignments a
             WHERE a.payroll_person_id = p.id
               AND a.cost_center_id = $2::uuid
               AND ${ACTIVE_ASSIGNMENT_ON_DATE}
           )
         )
       ORDER BY p.id, p.person_code`,
      [calcDate, ref]
    );
    return sortUnique(r.rows.map((row) => mapPerson(row as Record<string, unknown>)));
  }

  if (scope === 'PERSON_LIST') {
    const members = await txQuery(
      client,
      `SELECT m.payroll_person_id, m.created_at,
              p.id, p.person_code, p.full_name_ar, p.person_type, p.status,
              p.department_id, p.default_cost_center_id, p.default_currency_code,
              p.effective_from::text, p.effective_to::text, p.version, p.updated_at
       FROM accounts.payroll_run_scope_members m
       JOIN accounts.payroll_people p ON p.id = m.payroll_person_id
       WHERE m.payroll_run_id = $1::uuid
       ORDER BY m.created_at ASC, p.person_code ASC, p.id ASC`,
      [runId]
    );
    if (members.rows.length === 0) {
      throw new AccountsHttpError(
        'قائمة أشخاص التشغيل فارغة — أضف أعضاءً قبل الاحتساب',
        422
      );
    }
    const out: ResolvedPayrollPerson[] = [];
    for (const row of members.rows) {
      const rec = row as Record<string, unknown>;
      const status = String(rec.status);
      const from = String(rec.effective_from).slice(0, 10);
      const to = rec.effective_to == null ? null : String(rec.effective_to).slice(0, 10);
      const eligible =
        status === 'ACTIVE' && from <= calcDate && (to == null || to >= calcDate);
      out.push(mapPerson(rec, !eligible));
    }
    return sortUnique(out);
  }

  throw new AccountsHttpError(`نوع نطاق غير مدعوم: ${scope}`, 400);
}

/** عدد أعضاء PERSON_LIST دون حل — لفحص 422 المبكر. */
export async function countPayrollRunScopeMembers(
  client: TxClient,
  runId: string
): Promise<number> {
  const r = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.payroll_run_scope_members WHERE payroll_run_id=$1::uuid`,
    [requirePayrollUuid(runId, 'معرّف التشغيل')]
  );
  return r.rows[0]?.n ?? 0;
}
