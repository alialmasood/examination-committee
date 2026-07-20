/**
 * رموز ومساعدات Issues لمحرك احتساب الرواتب 9.A.2.3.1
 */
export const PAYROLL_CALC_ISSUE = {
  NO_ACTIVE_CONTRACT: 'NO_ACTIVE_CONTRACT',
  MULTIPLE_ACTIVE_CONTRACTS: 'MULTIPLE_ACTIVE_CONTRACTS',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  UNSUPPORTED_METHOD: 'UNSUPPORTED_METHOD',
  UNSUPPORTED_BASE: 'UNSUPPORTED_BASE',
  UNSUPPORTED_QTY_SOURCE: 'UNSUPPORTED_QTY_SOURCE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_PERCENTAGE: 'INVALID_PERCENTAGE',
  INACTIVE_COMPONENT: 'INACTIVE_COMPONENT',
  DUPLICATE_COMPONENT_SOURCE: 'DUPLICATE_COMPONENT_SOURCE',
  SCOPE_PERSON_INELIGIBLE: 'SCOPE_PERSON_INELIGIBLE',
  NO_EARNINGS: 'NO_EARNINGS',
  NEGATIVE_NET: 'NEGATIVE_NET',
  RUN_EMPTY_SCOPE: 'RUN_EMPTY_SCOPE',
  RUN_EMPTY_PERSON_LIST: 'RUN_EMPTY_PERSON_LIST',
  PERSON_CURRENCY_DIFFERS: 'PERSON_CURRENCY_DIFFERS',
  SNAPSHOT_VALIDATION_FAILED: 'SNAPSHOT_VALIDATION_FAILED',
  HASH_GENERATION_FAILED: 'HASH_GENERATION_FAILED',
  UNSUPPORTED_PAYROLL_CURRENCY: 'UNSUPPORTED_PAYROLL_CURRENCY',
} as const;

export type PayrollCalcIssueCode =
  (typeof PAYROLL_CALC_ISSUE)[keyof typeof PAYROLL_CALC_ISSUE];

export type PayrollCalcIssueDraft = {
  severity: 'ERROR' | 'WARNING';
  issue_code: string;
  message_ar: string;
  message_en?: string;
  entity_type?: string;
  entity_id?: string | null;
  details_json?: Record<string, unknown> | null;
};

const AR: Record<string, string> = {
  NO_ACTIVE_CONTRACT: 'لا يوجد عقد فعّال في تاريخ الاحتساب',
  MULTIPLE_ACTIVE_CONTRACTS: 'أكثر من عقد فعّال في تاريخ الاحتساب',
  CURRENCY_MISMATCH: 'عملة العقد تخالف عملة التشغيل',
  UNSUPPORTED_METHOD: 'طريقة احتساب غير مدعومة في هذه المرحلة',
  UNSUPPORTED_BASE: 'أساس احتساب غير متوافق مع الطريقة',
  UNSUPPORTED_QTY_SOURCE: 'مصدر كمية محجوز وغير مدعوم',
  INVALID_AMOUNT: 'مبلغ ثابت مفقود أو غير صالح',
  INVALID_PERCENTAGE: 'نسبة غير صالحة',
  INACTIVE_COMPONENT: 'مكوّن غير نشط أو خارج فترة السريان',
  DUPLICATE_COMPONENT_SOURCE: 'تكرار هوية مصدر المكوّن',
  SCOPE_PERSON_INELIGIBLE: 'عضو قائمة النطاق غير مؤهل هيكليًا في تاريخ الاحتساب',
  NO_EARNINGS: 'لا توجد استحقاقات محسوبة لهذا الشخص',
  NEGATIVE_NET: 'صافي الراتب سالب',
  RUN_EMPTY_SCOPE: 'لا يوجد أشخاص ضمن نطاق التشغيل',
  RUN_EMPTY_PERSON_LIST: 'قائمة أشخاص التشغيل فارغة',
  PERSON_CURRENCY_DIFFERS: 'عملة الشخص الافتراضية تختلف عن عملة التشغيل',
  SNAPSHOT_VALIDATION_FAILED: 'فشل تحقق لقطة الاحتساب',
  HASH_GENERATION_FAILED: 'فشل توليد بصمة اللقطة',
  UNSUPPORTED_PAYROLL_CURRENCY:
    'عملة تشغيل الرواتب غير مدعومة حاليًا. يدعم النظام الدينار العراقي IQD فقط',
};

export function buildCalcIssue(
  code: PayrollCalcIssueCode | string,
  opts: {
    severity?: 'ERROR' | 'WARNING';
    message_ar?: string;
    message_en?: string;
    entity_type?: string;
    entity_id?: string | null;
    details_json?: Record<string, unknown> | null;
  } = {}
): PayrollCalcIssueDraft {
  const blocking =
    code === PAYROLL_CALC_ISSUE.SCOPE_PERSON_INELIGIBLE ||
    code === PAYROLL_CALC_ISSUE.NO_EARNINGS ||
    code === PAYROLL_CALC_ISSUE.NEGATIVE_NET ||
    code === PAYROLL_CALC_ISSUE.RUN_EMPTY_SCOPE ||
    code === PAYROLL_CALC_ISSUE.PERSON_CURRENCY_DIFFERS
      ? false
      : true;
  const severity = opts.severity ?? (blocking ? 'ERROR' : 'WARNING');
  return {
    severity,
    issue_code: String(code).toUpperCase(),
    message_ar: opts.message_ar ?? AR[String(code)] ?? String(code),
    message_en: opts.message_en,
    entity_type: opts.entity_type,
    entity_id: opts.entity_id ?? null,
    details_json: opts.details_json ?? null,
  };
}
