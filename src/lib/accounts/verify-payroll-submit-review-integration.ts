/**
 * تحقق تكامل إرسال الرواتب للمراجعة 9.B.2 — API + تدقيق blocked/failed.
 * خفيف مثل verify-payroll-recalculate-integration.
 */
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type SubmitReviewIntegrationIssue = { kind: string; detail: string; entity_id?: string };

export type PayrollSubmitReviewIntegrationVerifyResult = {
  ok: boolean;
  strict: boolean;
  mismatches: SubmitReviewIntegrationIssue[];
  warnings: SubmitReviewIntegrationIssue[];
  summary: {
    under_review_runs: number;
    submit_actions: number;
    blocked_audits: number;
    failed_audits: number;
    success_audits: number;
  };
};

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

export async function verifyPayrollSubmitReviewIntegration(
  client: TxClient,
  options: { strict?: boolean } = {}
): Promise<PayrollSubmitReviewIntegrationVerifyResult> {
  const strict = options.strict === true;
  const mismatches: SubmitReviewIntegrationIssue[] = [];
  const warnings: SubmitReviewIntegrationIssue[] = [];
  const fail = (kind: string, detail: string, entity_id?: string) =>
    mismatches.push({ kind, detail, entity_id });

  const underReview = await txQuery<{
    id: string;
    approval_cycle: number;
    submitted_for_review_by: string | null;
    submitted_for_review_at: string | null;
    review_snapshot_hash: string | null;
  }>(
    client,
    `SELECT id::text, approval_cycle, submitted_for_review_by::text,
            submitted_for_review_at::text, review_snapshot_hash
     FROM accounts.payroll_runs
     WHERE status = 'UNDER_REVIEW'
     ORDER BY updated_at DESC
     LIMIT 200`
  );

  for (const run of underReview.rows) {
    if (!run.submitted_for_review_by || !run.submitted_for_review_at) {
      fail('under_review_missing_submitter', 'UNDER_REVIEW بلا مرسل/وقت', run.id);
    }
    if (!run.review_snapshot_hash) {
      fail('under_review_missing_hash', 'UNDER_REVIEW بلا review_snapshot_hash', run.id);
    }
    if (Number(run.approval_cycle) < 1) {
      fail('under_review_bad_cycle', 'UNDER_REVIEW بلا دورة اعتماد', run.id);
    }
    const act = await txQuery<{ n: number }>(
      client,
      `SELECT COUNT(*)::int n FROM accounts.payroll_run_approval_actions
       WHERE payroll_run_id=$1::uuid AND approval_cycle=$2
         AND action='SUBMITTED_FOR_REVIEW'`,
      [run.id, run.approval_cycle]
    );
    if (Number(act.rows[0]?.n ?? 0) < 1) {
      fail('under_review_missing_action', 'UNDER_REVIEW بلا إجراء SUBMITTED_FOR_REVIEW', run.id);
    }
  }

  // can_submit مفهومياً عبر DB: غير CALCULATED لا يُرسل
  const notCalculatedButSubmitted = await txQuery<{ id: string; status: string }>(
    client,
    `SELECT id::text, status FROM accounts.payroll_runs
     WHERE status IN ('DRAFT','CALCULATING','CANCELLED','APPROVED')
       AND submitted_for_review_at IS NOT NULL
       AND approval_cycle = 0
     LIMIT 50`
  );
  for (const r of notCalculatedButSubmitted.rows) {
    warnings.push({
      kind: 'unexpected_submit_fields',
      detail: `تشغيل ${r.status} يحمل حقول إرسال مع cycle=0`,
      entity_id: r.id,
    });
  }

  const blocked = await txQuery<{
    id: string;
    entity_id: string;
    new_values: Record<string, unknown> | null;
    description: string | null;
  }>(
    client,
    `SELECT id::text, entity_id::text, new_values, description
     FROM accounts.financial_audit_log
     WHERE action = 'payroll_run.submit_review_blocked'
     ORDER BY created_at DESC
     LIMIT 200`
  );

  for (const a of blocked.rows) {
    const nv = a.new_values ?? {};
    if (str(nv.operation) !== 'SUBMIT_FOR_REVIEW') {
      fail('blocked_bad_operation', 'blocked بلا operation=SUBMIT_FOR_REVIEW', a.entity_id);
    }
    if (Object.prototype.hasOwnProperty.call(nv, 'idempotency_key')) {
      fail('blocked_raw_key_field', 'blocked يحتوي حقل idempotency_key خام', a.entity_id);
    }
    const bag = JSON.stringify(nv);
    if (/idempotency_key[^_]/i.test(bag) && !bag.includes('idempotency_key_masked')) {
      fail('blocked_raw_key', 'blocked قد يحتوي مفتاحاً خاماً', a.entity_id);
    }
    if (str(a.description).includes('SELECT ') || str(a.description).includes('stack')) {
      fail('blocked_leaky_desc', 'وصف blocked مسرّب', a.entity_id);
    }
  }

  const failedAudits = await txQuery<{
    id: string;
    entity_id: string;
    new_values: Record<string, unknown> | null;
    description: string | null;
  }>(
    client,
    `SELECT id::text, entity_id::text, new_values, description
     FROM accounts.financial_audit_log
     WHERE action = 'payroll_run.submit_review_failed'
     ORDER BY created_at DESC
     LIMIT 200`
  );

  for (const a of failedAudits.rows) {
    const nv = a.new_values ?? {};
    if (str(nv.operation) !== 'SUBMIT_FOR_REVIEW') {
      fail('failed_bad_operation', 'failed بلا operation=SUBMIT_FOR_REVIEW', a.entity_id);
    }
    if (str(nv.error_code) !== 'TECHNICAL_FAILURE') {
      fail('failed_bad_code', 'failed بلا TECHNICAL_FAILURE', a.entity_id);
    }
    if (Object.prototype.hasOwnProperty.call(nv, 'idempotency_key')) {
      fail('failed_raw_key_field', 'failed يحتوي idempotency_key خام', a.entity_id);
    }
  }

  const successes = await txQuery<{
    id: string;
    entity_id: string;
    new_values: Record<string, unknown> | null;
  }>(
    client,
    `SELECT id::text, entity_id::text, new_values
     FROM accounts.financial_audit_log
     WHERE action = 'payroll_run.submitted_for_review'
     ORDER BY created_at DESC
     LIMIT 200`
  );

  for (const a of successes.rows) {
    const nv = a.new_values ?? {};
    if (Object.prototype.hasOwnProperty.call(nv, 'idempotency_key')) {
      fail('success_raw_key_field', 'نجاح يحتوي حقل idempotency_key', a.entity_id);
    }
  }

  // blocked/failed لا تُحسب نجاحاً: لا status UNDER_REVIEW من blocked alone
  if (strict) {
    for (const a of blocked.rows) {
      const run = await txQuery<{ status: string }>(
        client,
        `SELECT status FROM accounts.payroll_runs WHERE id=$1::uuid`,
        [a.entity_id]
      );
      const st = run.rows[0]?.status;
      if (st === 'UNDER_REVIEW') {
        // قد يكون إرسال لاحق ناجح — تحذير فقط إن لم يوجد success أحدث
        warnings.push({
          kind: 'blocked_then_under_review',
          detail: 'يوجد blocked وتشغيل UNDER_REVIEW (قد يكون إرسال لاحق)',
          entity_id: a.entity_id,
        });
      }
    }
  }

  const submitActions = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.payroll_run_approval_actions
     WHERE action='SUBMITTED_FOR_REVIEW'`
  );

  return {
    ok: mismatches.length === 0,
    strict,
    mismatches,
    warnings,
    summary: {
      under_review_runs: underReview.rows.length,
      submit_actions: Number(submitActions.rows[0]?.n ?? 0),
      blocked_audits: blocked.rows.length,
      failed_audits: failedAudits.rows.length,
      success_audits: successes.rows.length,
    },
  };
}
