/**
 * نقاط فشل اختبارات إعادة الاحتساب 9.A.2.4.1 — منفصلة عن CALC_FAILPOINT_*.
 * ليست أعلام إنتاج ولا معاملات مسار عام.
 */
export type PayrollRecalcFailpoint =
  | 'after_previous_summary'
  | 'after_delete'
  | 'after_first_person'
  | 'after_first_line'
  | 'before_run_hash'
  | 'before_totals_update'
  | 'during_audit'
  | null;

let __testFailpoint: PayrollRecalcFailpoint = null;

export function __setPayrollRecalcFailpointForTests(fp: PayrollRecalcFailpoint) {
  __testFailpoint = fp;
}

export function __clearPayrollRecalcFailpointForTests() {
  __testFailpoint = null;
}

export function hitPayrollRecalcFailpoint(
  name: Exclude<PayrollRecalcFailpoint, null>
): void {
  if (__testFailpoint === name) {
    throw new Error(`RECALC_FAILPOINT_${name}`);
  }
}
