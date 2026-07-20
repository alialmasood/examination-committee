/**
 * قراءة نتائج احتساب التشغيل — APIs للعرض فقط (9.A.2.3.2).
 * لا snapshot_json في الاستجابات.
 */
import { AccountsHttpError } from './auth';
import { loadPayrollRun } from './payroll-runs';
import { oneOf, requirePayrollUuid } from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

const PERSON_STATUSES = ['CALCULATED', 'ERROR', 'EXCLUDED'] as const;

export type PayrollRunPersonListItem = {
  id: string;
  payroll_person_id: string;
  person_code: string;
  full_name: string;
  payroll_contract_id: string | null;
  payroll_contract_ref: string | null;
  calculation_status: string;
  basic_amount: string;
  gross_amount: string;
  deductions_amount: string;
  employer_contributions_amount: string;
  net_amount: string;
  warning_count: number;
  error_count: number;
};

export type PayrollRunCalculationSummary = {
  total_people: number;
  calculated_people: number;
  error_people: number;
  excluded_people: number;
  pending_people: number;
  blocking_issues: number;
  warnings: number;
};

function moneyStr(v: unknown): string {
  return String(v ?? '0');
}

export async function listPayrollRunPeople(
  client: TxClient,
  params: {
    runId: string;
    page?: number;
    pageSize?: number;
    status?: string;
    search?: string;
  }
): Promise<{
  items: PayrollRunPersonListItem[];
  total: number;
  page: number;
  page_size: number;
}> {
  const runId = requirePayrollUuid(params.runId, 'معرّف التشغيل');
  await loadPayrollRun(client, runId);

  const page = Math.max(1, params.page ?? 1);
  const page_size = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const offset = (page - 1) * page_size;

  let statusFilter: string | null = null;
  if (params.status != null && String(params.status).trim() !== '') {
    statusFilter = oneOf(params.status, PERSON_STATUSES, 'حالة الشخص');
  }

  const search = (params.search ?? '').trim();
  const values: unknown[] = [runId, statusFilter, search, page_size, offset];

  const countR = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int total
     FROM accounts.payroll_run_people rp
     WHERE rp.payroll_run_id = $1::uuid
       AND ($2::text IS NULL OR rp.calculation_status = $2)
       AND ($3 = '' OR rp.person_code_snapshot ILIKE '%' || $3 || '%'
            OR rp.full_name_snapshot ILIKE '%' || $3 || '%')`,
    [runId, statusFilter, search]
  );

  const rows = await txQuery<{
    id: string;
    payroll_person_id: string;
    person_code_snapshot: string;
    full_name_snapshot: string;
    payroll_contract_id: string | null;
    contract_number: string | null;
    calculation_status: string;
    basic_amount: string;
    gross_amount: string;
    deductions_amount: string;
    employer_contributions_amount: string;
    net_amount: string;
    warning_count: number;
    error_count: number;
  }>(
    client,
    `SELECT rp.id, rp.payroll_person_id, rp.person_code_snapshot, rp.full_name_snapshot,
            rp.payroll_contract_id, pc.contract_number,
            rp.calculation_status,
            rp.basic_amount::text, rp.gross_amount::text, rp.deductions_amount::text,
            rp.employer_contributions_amount::text, rp.net_amount::text,
            rp.warning_count, rp.error_count
     FROM accounts.payroll_run_people rp
     LEFT JOIN accounts.payroll_contracts pc ON pc.id = rp.payroll_contract_id
     WHERE rp.payroll_run_id = $1::uuid
       AND ($2::text IS NULL OR rp.calculation_status = $2)
       AND ($3 = '' OR rp.person_code_snapshot ILIKE '%' || $3 || '%'
            OR rp.full_name_snapshot ILIKE '%' || $3 || '%')
     ORDER BY rp.person_code_snapshot ASC, rp.id ASC
     LIMIT $4 OFFSET $5`,
    values
  );

  return {
    items: rows.rows.map((r) => ({
      id: r.id,
      payroll_person_id: r.payroll_person_id,
      person_code: r.person_code_snapshot,
      full_name: r.full_name_snapshot,
      payroll_contract_id: r.payroll_contract_id,
      payroll_contract_ref: r.contract_number,
      calculation_status: r.calculation_status,
      basic_amount: moneyStr(r.basic_amount),
      gross_amount: moneyStr(r.gross_amount),
      deductions_amount: moneyStr(r.deductions_amount),
      employer_contributions_amount: moneyStr(r.employer_contributions_amount),
      net_amount: moneyStr(r.net_amount),
      warning_count: Number(r.warning_count),
      error_count: Number(r.error_count),
    })),
    total: countR.rows[0]?.total ?? 0,
    page,
    page_size,
  };
}

export async function getPayrollRunPersonDetail(
  client: TxClient,
  params: { runId: string; runPersonId: string }
): Promise<{
  person: PayrollRunPersonListItem;
  lines: Array<{
    id: string;
    component_code_snapshot: string;
    component_name_snapshot: string;
    component_type: string;
    calculation_method: string;
    calculation_base_type: string | null;
    base_amount: string | null;
    percentage: string | null;
    rate: string | null;
    calculated_amount: string;
    sequence: number;
    line_source: string;
  }>;
  issues: Array<{
    id: string;
    issue_code: string;
    severity: string;
    message_ar: string;
    entity_type: string | null;
    entity_id: string | null;
    blocking: boolean;
  }>;
}> {
  const runId = requirePayrollUuid(params.runId, 'معرّف التشغيل');
  const runPersonId = requirePayrollUuid(params.runPersonId, 'معرّف شخص التشغيل');
  await loadPayrollRun(client, runId);

  const personR = await txQuery<{
    id: string;
    payroll_run_id: string;
    payroll_person_id: string;
    person_code_snapshot: string;
    full_name_snapshot: string;
    payroll_contract_id: string | null;
    contract_number: string | null;
    calculation_status: string;
    basic_amount: string;
    gross_amount: string;
    deductions_amount: string;
    employer_contributions_amount: string;
    net_amount: string;
    warning_count: number;
    error_count: number;
  }>(
    client,
    `SELECT rp.id, rp.payroll_run_id, rp.payroll_person_id, rp.person_code_snapshot,
            rp.full_name_snapshot, rp.payroll_contract_id, pc.contract_number,
            rp.calculation_status,
            rp.basic_amount::text, rp.gross_amount::text, rp.deductions_amount::text,
            rp.employer_contributions_amount::text, rp.net_amount::text,
            rp.warning_count, rp.error_count
     FROM accounts.payroll_run_people rp
     LEFT JOIN accounts.payroll_contracts pc ON pc.id = rp.payroll_contract_id
     WHERE rp.id = $1::uuid AND rp.payroll_run_id = $2::uuid`,
    [runPersonId, runId]
  );

  const row = personR.rows[0];
  if (!row) {
    throw new AccountsHttpError('شخص التشغيل غير موجود ضمن هذا التشغيل', 404);
  }

  const person: PayrollRunPersonListItem = {
    id: row.id,
    payroll_person_id: row.payroll_person_id,
    person_code: row.person_code_snapshot,
    full_name: row.full_name_snapshot,
    payroll_contract_id: row.payroll_contract_id,
    payroll_contract_ref: row.contract_number,
    calculation_status: row.calculation_status,
    basic_amount: moneyStr(row.basic_amount),
    gross_amount: moneyStr(row.gross_amount),
    deductions_amount: moneyStr(row.deductions_amount),
    employer_contributions_amount: moneyStr(row.employer_contributions_amount),
    net_amount: moneyStr(row.net_amount),
    warning_count: Number(row.warning_count),
    error_count: Number(row.error_count),
  };

  const linesR = await txQuery<{
    id: string;
    component_code_snapshot: string;
    component_name_snapshot: string;
    component_type: string;
    calculation_method: string;
    calculation_base_type: string | null;
    base_amount: string | null;
    percentage: string | null;
    rate: string | null;
    calculated_amount: string;
    sequence: number;
    line_source: string;
  }>(
    client,
    `SELECT id, component_code_snapshot, component_name_snapshot, component_type,
            calculation_method, calculation_base_type,
            base_amount::text, percentage::text, rate::text, calculated_amount::text,
            sequence, line_source
     FROM accounts.payroll_run_lines
     WHERE payroll_run_person_id = $1::uuid AND payroll_run_id = $2::uuid
     ORDER BY sequence ASC, id ASC`,
    [runPersonId, runId]
  );

  const issuesR = await txQuery<{
    id: string;
    issue_code: string;
    severity: string;
    message_ar: string;
    entity_type: string | null;
    entity_id: string | null;
  }>(
    client,
    `SELECT id, issue_code, severity, message_ar, entity_type, entity_id
     FROM accounts.payroll_run_issues
     WHERE payroll_run_person_id = $1::uuid AND payroll_run_id = $2::uuid
     ORDER BY created_at ASC, id ASC`,
    [runPersonId, runId]
  );

  return {
    person,
    lines: linesR.rows.map((l) => ({
      id: l.id,
      component_code_snapshot: l.component_code_snapshot,
      component_name_snapshot: l.component_name_snapshot,
      component_type: l.component_type,
      calculation_method: l.calculation_method,
      calculation_base_type: l.calculation_base_type,
      base_amount: l.base_amount == null ? null : moneyStr(l.base_amount),
      percentage: l.percentage == null ? null : String(l.percentage),
      rate: l.rate == null ? null : moneyStr(l.rate),
      calculated_amount: moneyStr(l.calculated_amount),
      sequence: Number(l.sequence),
      line_source: l.line_source,
    })),
    issues: issuesR.rows.map((i) => ({
      id: i.id,
      issue_code: i.issue_code,
      severity: i.severity,
      message_ar: i.message_ar,
      entity_type: i.entity_type,
      entity_id: i.entity_id,
      blocking: i.severity === 'ERROR',
    })),
  };
}

export async function buildRunCalculationSummary(
  client: TxClient,
  runId: string
): Promise<PayrollRunCalculationSummary> {
  const id = requirePayrollUuid(runId, 'معرّف التشغيل');
  await loadPayrollRun(client, id);

  const statusCounts = await txQuery<{
    calculation_status: string;
    n: number;
  }>(
    client,
    `SELECT calculation_status, COUNT(*)::int n
     FROM accounts.payroll_run_people
     WHERE payroll_run_id = $1::uuid
     GROUP BY calculation_status`,
    [id]
  );

  let calculated_people = 0;
  let error_people = 0;
  let excluded_people = 0;
  let pending_people = 0;
  for (const row of statusCounts.rows) {
    if (row.calculation_status === 'CALCULATED') calculated_people = row.n;
    else if (row.calculation_status === 'ERROR') error_people = row.n;
    else if (row.calculation_status === 'EXCLUDED') excluded_people = row.n;
    else if (row.calculation_status === 'PENDING') pending_people = row.n;
  }

  const issueCounts = await txQuery<{ severity: string; n: number }>(
    client,
    `SELECT severity, COUNT(*)::int n
     FROM accounts.payroll_run_issues
     WHERE payroll_run_id = $1::uuid
     GROUP BY severity`,
    [id]
  );

  let blocking_issues = 0;
  let warnings = 0;
  for (const row of issueCounts.rows) {
    if (row.severity === 'ERROR') blocking_issues = row.n;
    else warnings = row.n;
  }

  return {
    total_people: calculated_people + error_people + excluded_people + pending_people,
    calculated_people,
    error_people,
    excluded_people,
    pending_people,
    blocking_issues,
    warnings,
  };
}
