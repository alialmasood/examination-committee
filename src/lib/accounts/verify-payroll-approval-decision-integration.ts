/**
 * تحقق تكامل قرار اعتماد/رفض الرواتب 9.B.3 — خفيف.
 */
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type ApprovalDecisionIntegrationIssue = {
  kind: string;
  detail: string;
  entity_id?: string;
};

export type PayrollApprovalDecisionIntegrationVerifyResult = {
  ok: boolean;
  strict: boolean;
  mismatches: ApprovalDecisionIntegrationIssue[];
  warnings: ApprovalDecisionIntegrationIssue[];
  summary: {
    approved_runs: number;
    calculated_with_rejection: number;
    approve_actions: number;
    reject_actions: number;
    blocked_audits: number;
    failed_audits: number;
    success_approve_audits: number;
    success_reject_audits: number;
  };
};

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function hasRawKeyField(nv: Record<string, unknown> | null | undefined): boolean {
  if (!nv) return false;
  return Object.prototype.hasOwnProperty.call(nv, 'idempotency_key');
}

export async function verifyPayrollApprovalDecisionIntegration(
  client: TxClient,
  options: { strict?: boolean } = {}
): Promise<PayrollApprovalDecisionIntegrationVerifyResult> {
  const strict = options.strict === true;
  const mismatches: ApprovalDecisionIntegrationIssue[] = [];
  const warnings: ApprovalDecisionIntegrationIssue[] = [];
  const fail = (kind: string, detail: string, entity_id?: string) =>
    mismatches.push({ kind, detail, entity_id });

  const approved = await txQuery<{
    id: string;
    approval_cycle: number;
    approved_by: string | null;
    approved_at: string | null;
    approved_snapshot_hash: string | null;
    review_snapshot_hash: string | null;
    submitted_for_review_by: string | null;
  }>(
    client,
    `SELECT id::text, approval_cycle, approved_by::text, approved_at::text,
            approved_snapshot_hash, review_snapshot_hash, submitted_for_review_by::text
     FROM accounts.payroll_runs
     WHERE status = 'APPROVED'
     ORDER BY updated_at DESC
     LIMIT 200`
  );

  for (const run of approved.rows) {
    if (!run.approved_by || !run.approved_at) {
      fail('approved_missing_actor', 'APPROVED بلا معتمد/وقت', run.id);
    }
    if (!run.approved_snapshot_hash) {
      fail('approved_missing_hash', 'APPROVED بلا approved_snapshot_hash', run.id);
    }
    if (Number(run.approval_cycle) < 1) {
      fail('approved_bad_cycle', 'APPROVED بلا دورة اعتماد', run.id);
    }
    if (
      run.approved_by &&
      run.submitted_for_review_by &&
      String(run.approved_by) === String(run.submitted_for_review_by)
    ) {
      fail('approved_sod_violation', 'نفس المستخدم أرسل واعتمد (فصل الواجبات)', run.id);
    }
    const act = await txQuery<{ n: number }>(
      client,
      `SELECT COUNT(*)::int n FROM accounts.payroll_run_approval_actions
       WHERE payroll_run_id=$1::uuid AND approval_cycle=$2 AND action='APPROVED'`,
      [run.id, run.approval_cycle]
    );
    if (Number(act.rows[0]?.n ?? 0) < 1) {
      fail('approved_missing_action', 'APPROVED بلا إجراء APPROVED', run.id);
    }
  }

  // CALCULATED بعد رفض: بلا مراجعة نشطة
  const afterReject = await txQuery<{
    id: string;
    review_snapshot_hash: string | null;
    submitted_for_review_by: string | null;
    submitted_for_review_at: string | null;
  }>(
    client,
    `SELECT r.id::text, r.review_snapshot_hash, r.submitted_for_review_by::text,
            r.submitted_for_review_at::text
     FROM accounts.payroll_runs r
     WHERE r.status = 'CALCULATED'
       AND EXISTS (
         SELECT 1 FROM accounts.payroll_run_approval_actions a
         WHERE a.payroll_run_id = r.id AND a.action = 'REJECTED'
       )
     ORDER BY r.updated_at DESC
     LIMIT 200`
  );

  for (const run of afterReject.rows) {
    if (run.review_snapshot_hash) {
      fail('reject_active_review_hash', 'بعد الرفض ما زال review_snapshot_hash نشطاً', run.id);
    }
    if (run.submitted_for_review_by || run.submitted_for_review_at) {
      fail('reject_active_submitter', 'بعد الرفض ما زالت حقول الإرسال نشطة', run.id);
    }
  }

  const decisionActions = ['payroll_run.approval_blocked', 'payroll_run.approval_failed',
    'payroll_run.rejection_blocked', 'payroll_run.rejection_failed',
    'payroll_run.approved', 'payroll_run.review_rejected'] as const;

  for (const action of decisionActions) {
    const rows = await txQuery<{
      id: string;
      entity_id: string;
      new_values: Record<string, unknown> | null;
      description: string | null;
    }>(
      client,
      `SELECT id::text, entity_id::text, new_values, description
       FROM accounts.financial_audit_log
       WHERE action = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [action]
    );
    for (const a of rows.rows) {
      if (hasRawKeyField(a.new_values)) {
        fail('decision_raw_key_field', `${action} يحتوي idempotency_key خام`, a.entity_id);
      }
      const bag = JSON.stringify(a.new_values ?? {});
      if (/idempotency_key[^_]/i.test(bag) && !bag.includes('idempotency_key_masked') && !bag.includes('request_key_masked')) {
        fail('decision_raw_key', `${action} قد يحتوي مفتاحاً خاماً`, a.entity_id);
      }
      if (str(a.description).includes('SELECT ') || str(a.description).includes('stack')) {
        fail('decision_leaky_desc', `وصف ${action} مسرّب`, a.entity_id);
      }
    }
  }

  if (strict) {
    const underReview = await txQuery<{ id: string; submitted_for_review_by: string | null }>(
      client,
      `SELECT id::text, submitted_for_review_by::text
       FROM accounts.payroll_runs WHERE status='UNDER_REVIEW' LIMIT 100`
    );
    for (const run of underReview.rows) {
      if (!run.submitted_for_review_by) {
        warnings.push({
          kind: 'under_review_missing_submitter',
          detail: 'UNDER_REVIEW بلا مرسل',
          entity_id: run.id,
        });
      }
    }
  }

  const approveActions = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.payroll_run_approval_actions WHERE action='APPROVED'`
  );
  const rejectActions = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.payroll_run_approval_actions WHERE action='REJECTED'`
  );
  const blocked = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.financial_audit_log
     WHERE action IN ('payroll_run.approval_blocked','payroll_run.rejection_blocked')`
  );
  const failedAudits = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.financial_audit_log
     WHERE action IN ('payroll_run.approval_failed','payroll_run.rejection_failed')`
  );
  const successApprove = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.financial_audit_log WHERE action='payroll_run.approved'`
  );
  const successReject = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.financial_audit_log WHERE action='payroll_run.review_rejected'`
  );

  return {
    ok: mismatches.length === 0,
    strict,
    mismatches,
    warnings,
    summary: {
      approved_runs: approved.rows.length,
      calculated_with_rejection: afterReject.rows.length,
      approve_actions: Number(approveActions.rows[0]?.n ?? 0),
      reject_actions: Number(rejectActions.rows[0]?.n ?? 0),
      blocked_audits: Number(blocked.rows[0]?.n ?? 0),
      failed_audits: Number(failedAudits.rows[0]?.n ?? 0),
      success_approve_audits: Number(successApprove.rows[0]?.n ?? 0),
      success_reject_audits: Number(successReject.rows[0]?.n ?? 0),
    },
  };
}
