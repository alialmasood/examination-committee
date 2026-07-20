/**
 * Failpoints اختبارية لاعتماد الرواتب 9.B.1 — لا تعرض عبر API.
 */
export type PayrollApprovalFailpoint =
  | null
  | 'submit_after_lock'
  | 'submit_after_validation'
  | 'submit_after_run_update'
  | 'submit_during_action_insert'
  | 'approve_after_verify'
  | 'approve_after_run_update'
  | 'approve_during_action_insert'
  | 'reject_after_reason_validation'
  | 'reject_after_action_insert'
  | 'reject_after_run_update';

let current: PayrollApprovalFailpoint = null;

export function __setPayrollApprovalFailpointForTests(fp: PayrollApprovalFailpoint): void {
  current = fp;
}

export function __clearPayrollApprovalFailpointForTests(): void {
  current = null;
}

export function hitPayrollApprovalFailpoint(name: Exclude<PayrollApprovalFailpoint, null>): void {
  if (current === name) {
    throw new Error(`APPROVAL_FAILPOINT_${name}`);
  }
}
