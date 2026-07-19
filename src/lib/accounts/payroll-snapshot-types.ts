/**
 * أنواع لقطة الاحتساب 9.A.2.2 — مخطط فقط بلا محرك.
 */
export const PAYROLL_SNAPSHOT_ENUMS = {
  CALCULATION_STATUS: ['PENDING', 'CALCULATED', 'ERROR', 'EXCLUDED'] as const,
  LINE_SOURCE: ['GENERATED', 'MANUAL_OVERRIDE'] as const,
  QUANTITY_SOURCE: ['MANUAL', 'ASSIGNMENT', 'IMPORTED', 'ATTENDANCE', 'LECTURE_HOURS'] as const,
  QUANTITY_SOURCE_IMPLEMENTED: ['MANUAL', 'ASSIGNMENT'] as const,
  ISSUE_SEVERITY: ['ERROR', 'WARNING'] as const,
} as const;

export type PayrollCalculationStatus =
  (typeof PAYROLL_SNAPSHOT_ENUMS.CALCULATION_STATUS)[number];
export type PayrollLineSource = (typeof PAYROLL_SNAPSHOT_ENUMS.LINE_SOURCE)[number];
export type PayrollQuantitySource =
  (typeof PAYROLL_SNAPSHOT_ENUMS.QUANTITY_SOURCE)[number];
export type PayrollIssueSeverity =
  (typeof PAYROLL_SNAPSHOT_ENUMS.ISSUE_SEVERITY)[number];

/**
 * Schema موثّق لـ snapshot_json داخل payroll_run_people.
 * لا يُولَّد تلقائيًا في 9.A.2.2 — Fixtures/اختبارات فقط.
 *
 * قواعد:
 * - decimals كسلاسل ثابتة (3 منازل).
 * - dates بصيغة YYYY-MM-DD.
 * - ترتيب Arrays حتمي يحدده المُنشئ (حسب sequence / id).
 * - لا بيانات مصرفية / ملاحظات شخصية زائدة.
 * - source_versions يحمل version + updated_at للمصادر ذات المعنى المالي.
 */
export type PayrollPersonSnapshotJson = {
  schema_version: 1;
  calculation_date: string;
  currency_code: string;
  person: {
    id: string;
    person_code: string;
    full_name_ar: string;
    person_type: string;
    college_id: string | null;
    department_id: string | null;
    cost_center_id: string | null;
  };
  contract: null | {
    id: string;
    contract_number: string;
    basic_salary: string;
    currency_code: string;
    effective_from: string;
    effective_to: string | null;
  };
  assignments: Array<{
    id: string;
    assignment_code: string;
    assignment_type: string;
    effective_from: string;
    effective_to: string | null;
  }>;
  component_assignment_ids: string[];
  scope: {
    scope_type: string;
    scope_ref_id: string | null;
    resolved_via: string;
  };
  source_versions: {
    person_version: number;
    person_updated_at: string;
    contract_version: number | null;
    contract_updated_at: string | null;
  };
};
