/**
 * حل مصادر مكوّنات الرواتب لشخص/عقد في تاريخ الاحتساب (9.A.2.3.1)
 */
import { dateStr } from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type ResolvedComponentSource = {
  pca_id: string;
  payroll_component_id: string;
  payroll_assignment_id: string | null;
  payroll_contract_id: string | null;
  component_code: string;
  component_name_ar: string;
  component_type: string;
  method: string;
  base_type: string;
  amount: string | null;
  percentage: string | null;
  rate: string | null;
  quantity: string | null;
  default_amount: string | null;
  priority: number;
  effective_from: string;
  effective_to: string | null;
  component_is_active: boolean;
  component_effective_from: string;
  component_effective_to: string | null;
};

const TYPE_ORDER: Record<string, number> = {
  EARNING: 0,
  DEDUCTION: 1,
  EMPLOYER_CONTRIBUTION: 2,
};

const BASE_ORDER: Record<string, number> = {
  NONE: 0,
  CONTRACT_BASIC: 1,
};

function sortSources(rows: ResolvedComponentSource[]): ResolvedComponentSource[] {
  return [...rows].sort((a, b) => {
    const t = (TYPE_ORDER[a.component_type] ?? 9) - (TYPE_ORDER[b.component_type] ?? 9);
    if (t !== 0) return t;
    const base =
      (BASE_ORDER[a.base_type] ?? 9) - (BASE_ORDER[b.base_type] ?? 9);
    if (base !== 0) return base;
    if (a.priority !== b.priority) return a.priority - b.priority;
    const code = a.component_code.localeCompare(b.component_code, 'en');
    if (code !== 0) return code;
    const cid = a.payroll_component_id.localeCompare(b.payroll_component_id, 'en');
    if (cid !== 0) return cid;
    const aid = (a.payroll_assignment_id ?? '').localeCompare(b.payroll_assignment_id ?? '', 'en');
    if (aid !== 0) return aid;
    return a.pca_id.localeCompare(b.pca_id, 'en');
  });
}

/**
 * يحمّل إسنادات المكوّنات النشطة المرتبطة بالعقد أو بتكليف نشط أو بالشخص فقط.
 */
export async function resolveComponentSources(
  client: TxClient,
  p: {
    personId: string;
    contractId: string;
    calculationDate: string | Date;
  }
): Promise<ResolvedComponentSource[]> {
  const calcDate = dateStr(p.calculationDate);
  if (!calcDate) return [];

  const r = await txQuery<{
    pca_id: string;
    payroll_component_id: string;
    payroll_assignment_id: string | null;
    payroll_contract_id: string | null;
    component_code: string;
    component_name_ar: string;
    component_type: string;
    override_method: string | null;
    component_method: string;
    base_type: string;
    amount: string | null;
    percentage: string | null;
    rate: string | null;
    quantity: string | null;
    default_amount: string | null;
    priority: number;
    effective_from: string;
    effective_to: string | null;
    component_is_active: boolean;
    component_effective_from: string;
    component_effective_to: string | null;
  }>(
    client,
    `SELECT
       pca.id AS pca_id,
       pca.payroll_component_id,
       pca.payroll_assignment_id,
       pca.payroll_contract_id,
       c.component_code,
       c.name_ar AS component_name_ar,
       c.component_type,
       pca.override_calculation_method AS override_method,
       c.calculation_method AS component_method,
       c.calculation_base_type AS base_type,
       pca.amount::text,
       pca.percentage::text,
       pca.rate::text,
       pca.quantity::text,
       c.default_amount::text,
       pca.priority,
       pca.effective_from::text,
       pca.effective_to::text,
       c.is_active AS component_is_active,
       c.effective_from::text AS component_effective_from,
       c.effective_to::text AS component_effective_to
     FROM accounts.payroll_component_assignments pca
     JOIN accounts.payroll_components c ON c.id = pca.payroll_component_id
     WHERE pca.payroll_person_id = $1::uuid
       AND pca.is_active = TRUE
       AND pca.effective_from <= $2::date
       AND (pca.effective_to IS NULL OR pca.effective_to >= $2::date)
       AND (
         pca.payroll_contract_id = $3::uuid
         OR (
           pca.payroll_assignment_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM accounts.payroll_assignments a
             WHERE a.id = pca.payroll_assignment_id
               AND a.payroll_person_id = $1::uuid
               AND a.status = 'ACTIVE'
               AND a.effective_from <= $2::date
               AND (a.effective_to IS NULL OR a.effective_to >= $2::date)
           )
         )
         OR (pca.payroll_contract_id IS NULL AND pca.payroll_assignment_id IS NULL)
       )`,
    [p.personId, calcDate, p.contractId]
  );

  const mapped: ResolvedComponentSource[] = r.rows.map((row) => ({
    pca_id: row.pca_id,
    payroll_component_id: row.payroll_component_id,
    payroll_assignment_id: row.payroll_assignment_id,
    payroll_contract_id: row.payroll_contract_id,
    component_code: row.component_code,
    component_name_ar: row.component_name_ar,
    component_type: row.component_type,
    method: String(row.override_method ?? row.component_method).trim().toUpperCase(),
    base_type: String(row.base_type).trim().toUpperCase(),
    amount: row.amount,
    percentage: row.percentage,
    rate: row.rate,
    quantity: row.quantity,
    default_amount: row.default_amount,
    priority: Number(row.priority),
    effective_from: String(row.effective_from).slice(0, 10),
    effective_to: row.effective_to == null ? null : String(row.effective_to).slice(0, 10),
    component_is_active: row.component_is_active === true,
    component_effective_from: String(row.component_effective_from).slice(0, 10),
    component_effective_to:
      row.component_effective_to == null
        ? null
        : String(row.component_effective_to).slice(0, 10),
  }));

  return sortSources(mapped);
}
