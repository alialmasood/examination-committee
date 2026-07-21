/**
 * Failpoints اختبارية لترحيل الرواتب 9.C.1 — لا تعرض عبر API.
 */
export type PayrollPostingFailpoint =
  | null
  | 'post_after_idempotency'
  | 'post_after_approval_verify'
  | 'post_after_mapping'
  | 'post_after_journal_build'
  | 'post_after_document_sequence'
  | 'post_after_journal_header'
  | 'post_after_journal_lines'
  | 'post_after_posting_record'
  | 'post_after_run_update'
  | 'post_after_success_audit';

let current: PayrollPostingFailpoint = null;

export function __setPayrollPostingFailpointForTests(fp: PayrollPostingFailpoint): void {
  current = fp;
}

export function __clearPayrollPostingFailpointForTests(): void {
  current = null;
}

export function hitPayrollPostingFailpoint(name: Exclude<PayrollPostingFailpoint, null>): void {
  if (current === name) {
    throw new Error(`POSTING_FAILPOINT_${name}`);
  }
}
