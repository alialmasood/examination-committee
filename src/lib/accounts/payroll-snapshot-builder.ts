/**
 * بناء لقطة شخص احتساب حتمية + بصمة (9.A.2.3.1)
 */
import { normalizeMoneyInput } from './money';
import { hashPayrollSnapshot } from './payroll-snapshot-hash';
import type { PayrollPersonSnapshotJson } from './payroll-snapshot-types';
import type { ResolvedPayrollContract } from './payroll-contract-resolver';
import type { ResolvedPayrollPerson } from './payroll-scope-resolver';
import { dateStr, iso } from './payroll-validation';

export type SnapshotAssignmentInput = {
  id: string;
  assignment_code: string;
  assignment_type: string;
  effective_from: string | Date;
  effective_to: string | Date | null;
};

export function buildPersonSnapshotJson(input: {
  person: ResolvedPayrollPerson | {
    id: string;
    person_code: string;
    full_name_ar: string;
    person_type: string;
    department_id: string | null;
    default_cost_center_id: string | null;
    version: number;
    updated_at: string | Date;
  };
  contract: ResolvedPayrollContract | null;
  assignments: SnapshotAssignmentInput[];
  component_assignment_ids: string[];
  calculation_date: string;
  currency_code: string;
  scope_type: string;
  scope_ref_id: string | null;
  resolved_via: string;
  college_id?: string | null;
}): { snapshot: PayrollPersonSnapshotJson; snapshot_hash: string } {
  const person = input.person;
  const assignments = [...input.assignments]
    .map((a) => ({
      id: a.id,
      assignment_code: a.assignment_code,
      assignment_type: a.assignment_type,
      effective_from: dateStr(a.effective_from)!,
      effective_to: dateStr(a.effective_to),
    }))
    .sort((a, b) => {
      const c = a.assignment_code.localeCompare(b.assignment_code, 'en');
      if (c !== 0) return c;
      return a.id.localeCompare(b.id, 'en');
    });

  const componentIds = [...input.component_assignment_ids].sort((a, b) =>
    a.localeCompare(b, 'en')
  );

  const contract =
    input.contract == null
      ? null
      : {
          id: input.contract.id,
          contract_number: input.contract.contract_number,
          basic_salary: normalizeMoneyInput(input.contract.base_amount),
          currency_code: input.contract.currency_code,
          effective_from: input.contract.effective_from,
          effective_to: input.contract.effective_to,
        };

  const snapshot: PayrollPersonSnapshotJson = {
    schema_version: 1,
    calculation_date: input.calculation_date,
    currency_code: String(input.currency_code).toUpperCase(),
    person: {
      id: person.id,
      person_code: person.person_code,
      full_name_ar: person.full_name_ar,
      person_type: person.person_type,
      college_id: input.college_id ?? null,
      department_id: person.department_id,
      cost_center_id: person.default_cost_center_id,
    },
    contract,
    assignments,
    component_assignment_ids: componentIds,
    scope: {
      scope_type: input.scope_type,
      scope_ref_id: input.scope_ref_id,
      resolved_via: input.resolved_via,
    },
    source_versions: {
      person_version: Number(person.version),
      person_updated_at: iso(person.updated_at)!,
      contract_version: input.contract?.version ?? null,
      contract_updated_at: input.contract ? iso(input.contract.updated_at) : null,
    },
  };

  return { snapshot, snapshot_hash: hashPayrollSnapshot(snapshot) };
}

/** بصمة تشغيل = hash لسلاسل بصمات الأشخاص بالترتيب + الإجماليات. */
export function buildRunSnapshotHash(input: {
  person_snapshot_hashes: string[];
  people_count: number;
  gross_total: string;
  deduction_total: string;
  employer_contribution_total: string;
  net_total: string;
  warning_count: number;
  error_count: number;
}): string {
  return hashPayrollSnapshot({
    person_snapshot_hashes: input.person_snapshot_hashes,
    people_count: input.people_count,
    gross_total: input.gross_total,
    deduction_total: input.deduction_total,
    employer_contribution_total: input.employer_contribution_total,
    net_total: input.net_total,
    warning_count: input.warning_count,
    error_count: input.error_count,
  });
}
