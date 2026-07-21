/**
 * تحقق نهائي لمسار اعتماد الرواتب 9.B.4
 * يجمع نواة الاعتماد + تكامل الإرسال + تكامل القرار + فحوصات السلسلة/التكرار/التدقيق.
 */
import { verifyPayrollApprovalCore } from './verify-payroll-approval-core';
import { verifyPayrollApprovalDecisionIntegration } from './verify-payroll-approval-decision-integration';
import { verifyPayrollSubmitReviewIntegration } from './verify-payroll-submit-review-integration';
import { listPayrollRunApprovalHistory } from './payroll-approval-history';
import { isPayrollSnapshotHash } from './payroll-snapshot-hash';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type ApprovalWorkflowIssue = {
  kind: string;
  detail: string;
  entity_id?: string;
  source?: string;
};

export type PayrollApprovalWorkflowVerifyResult = {
  ok: boolean;
  strict: boolean;
  mismatches: ApprovalWorkflowIssue[];
  warnings: ApprovalWorkflowIssue[];
  mismatch_count: number;
  summary: {
    mismatch_count: number;
    warning_count: number;
    checked_runs: number;
    checked_actions: number;
    sources: Record<string, { ok: boolean; mismatches: number }>;
    empty_info?: string;
  };
};

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

const LEGAL: Record<string, Array<{ from: string; to: string }>> = {
  SUBMITTED_FOR_REVIEW: [{ from: 'CALCULATED', to: 'UNDER_REVIEW' }],
  APPROVED: [{ from: 'UNDER_REVIEW', to: 'APPROVED' }],
  REJECTED: [{ from: 'UNDER_REVIEW', to: 'CALCULATED' }],
};

export async function verifyPayrollApprovalWorkflow(
  client: TxClient,
  options: { strict?: boolean } = {}
): Promise<PayrollApprovalWorkflowVerifyResult> {
  const strict = options.strict === true;
  const mismatches: ApprovalWorkflowIssue[] = [];
  const warnings: ApprovalWorkflowIssue[] = [];
  const fail = (kind: string, detail: string, entity_id?: string, source = 'workflow') =>
    mismatches.push({ kind, detail, entity_id, source });

  const sources: Record<string, { ok: boolean; mismatches: number }> = {};

  const core = await verifyPayrollApprovalCore(client, { strict });
  sources.approval_core = { ok: core.ok, mismatches: core.mismatches.length };
  for (const m of core.mismatches) {
    mismatches.push({ ...m, source: 'approval_core' });
  }
  for (const w of core.warnings) {
    warnings.push({ ...w, source: 'approval_core' });
  }

  const submit = await verifyPayrollSubmitReviewIntegration(client, { strict });
  sources.submit_review = { ok: submit.ok, mismatches: submit.mismatches.length };
  for (const m of submit.mismatches) {
    mismatches.push({ ...m, source: 'submit_review' });
  }
  for (const w of submit.warnings ?? []) {
    warnings.push({ ...w, source: 'submit_review' });
  }

  const decision = await verifyPayrollApprovalDecisionIntegration(client, { strict });
  sources.approval_decision = { ok: decision.ok, mismatches: decision.mismatches.length };
  for (const m of decision.mismatches) {
    mismatches.push({ ...m, source: 'approval_decision' });
  }
  for (const w of decision.warnings) {
    warnings.push({ ...w, source: 'approval_decision' });
  }

  const tableExists = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM information_schema.tables
     WHERE table_schema='accounts' AND table_name='payroll_run_approval_actions'`
  );
  if (Number(tableExists.rows[0]?.n ?? 0) === 0) {
    const mismatch_count = mismatches.length;
    return {
      ok: mismatch_count === 0,
      strict,
      mismatches,
      warnings,
      mismatch_count,
      summary: {
        mismatch_count,
        warning_count: warnings.length,
        checked_runs: 0,
        checked_actions: 0,
        sources,
        empty_info: 'جدول الاعتماد غير موجود — ترحيل 097 مطلوب',
      },
    };
  }

  // —— Action chain per run/cycle ——
  const actions = await txQuery<{
    id: string;
    payroll_run_id: string;
    approval_cycle: number;
    action: string;
    from_status: string;
    to_status: string;
    actor_id: string | null;
    reason: string | null;
    comment: string | null;
    snapshot_hash: string | null;
    version_before: number;
    version_after: number;
    request_key_hash: string | null;
    request_payload_hash: string | null;
    created_at: Date | string;
  }>(
    client,
    `SELECT id::text, payroll_run_id::text, approval_cycle, action, from_status, to_status,
            actor_id::text, reason, comment, snapshot_hash,
            version_before, version_after, request_key_hash, request_payload_hash, created_at
     FROM accounts.payroll_run_approval_actions
     ORDER BY payroll_run_id, approval_cycle, created_at ASC, id ASC
     LIMIT 5000`
  );

  const byRunCycle = new Map<string, typeof actions.rows>();
  for (const a of actions.rows) {
    const k = `${a.payroll_run_id}:${a.approval_cycle}`;
    const list = byRunCycle.get(k) ?? [];
    list.push(a);
    byRunCycle.set(k, list);
  }

  for (const [key, chain] of byRunCycle) {
    const [runId, cycleStr] = key.split(':');
    const cycle = Number(cycleStr);
    if (!Number.isFinite(cycle) || cycle < 1) {
      fail('invalid_approval_cycle', `دورة غير صالحة: ${cycleStr}`, runId);
    }
    if (chain.length === 0) continue;

    const first = chain[0];
    if (first.action !== 'SUBMITTED_FOR_REVIEW') {
      fail('cycle_not_start_submit', 'الدورة لا تبدأ بـ SUBMITTED_FOR_REVIEW', runId);
    }

    const submits = chain.filter((x) => x.action === 'SUBMITTED_FOR_REVIEW');
    if (submits.length > 1) {
      fail('duplicate_submit', 'Submit مكرر في نفس الدورة', runId);
    }

    const terminals = chain.filter(
      (x) => x.action === 'APPROVED' || x.action === 'REJECTED'
    );
    if (terminals.length > 1) {
      fail('duplicate_terminal', 'أكثر من قرار نهائي في الدورة', runId);
    }
    if (
      terminals.some((x) => x.action === 'APPROVED') &&
      terminals.some((x) => x.action === 'REJECTED')
    ) {
      fail('approve_and_reject_same_cycle', 'Approve وReject في نفس الدورة', runId);
    }

    for (const a of chain) {
      const legal = LEGAL[a.action] ?? [];
      if (
        !legal.some((t) => t.from === a.from_status && t.to === a.to_status)
      ) {
        fail(
          'illegal_status_transition',
          `${a.action}: ${a.from_status}→${a.to_status}`,
          a.id
        );
      }
      if (Number(a.version_before) >= Number(a.version_after)) {
        fail('version_before_ge_after', 'version_before >= version_after', a.id);
      }
      if (!isPayrollSnapshotHash(a.snapshot_hash)) {
        fail('action_snapshot_malformed', 'snapshot_hash للإجراء غير صالح', a.id);
      }
      if (!a.actor_id) {
        fail('actor_missing', 'إجراء بلا actor_id', a.id);
      }
      if (a.action === 'REJECTED' && (!a.reason || String(a.reason).trim().length < 10)) {
        fail('reject_without_reason', 'REJECTED بلا سبب كافٍ', a.id);
      }
      if (a.comment != null && String(a.comment).length > 500) {
        fail('comment_too_long', 'تعليق أطول من 500', a.id);
      }
      if (a.reason != null && String(a.reason).length > 500) {
        fail('reason_too_long', 'سبب أطول من 500', a.id);
      }
      if (!a.request_key_hash || !a.request_payload_hash) {
        fail('action_missing_request_identity', 'إجراء بلا هوية طلب', a.id);
      }
      if (a.request_key_hash && !/^[a-f0-9]{64}$/i.test(String(a.request_key_hash))) {
        fail('malformed_request_key_hash', 'request_key_hash غير صالح', a.id);
      }
      if (
        a.request_payload_hash &&
        !/^[a-f0-9]{64}$/i.test(String(a.request_payload_hash))
      ) {
        fail('malformed_payload_hash', 'request_payload_hash غير صالح', a.id);
      }
    }

    // ترتيب الإصدارات داخل الدورة
    for (let i = 1; i < chain.length; i++) {
      if (Number(chain[i].version_before) < Number(chain[i - 1].version_after)) {
        // يسمح بالمساواة فقط إذا لم يحدث تقدم — المتوقع version_before == previous after
      }
      if (Number(chain[i].version_before) !== Number(chain[i - 1].version_after)) {
        fail('version_chain_gap', 'فجوة سلسلة الإصدارات داخل الدورة', chain[i].id);
      }
    }
  }

  // فجوات الدورات لكل تشغيل
  const cyclesByRun = await txQuery<{ payroll_run_id: string; cycles: number[] }>(
    client,
    `SELECT payroll_run_id::text,
            ARRAY_AGG(DISTINCT approval_cycle ORDER BY approval_cycle) AS cycles
     FROM accounts.payroll_run_approval_actions
     GROUP BY payroll_run_id
     LIMIT 2000`
  );
  for (const row of cyclesByRun.rows) {
    const cycles = (row.cycles ?? []).map(Number).sort((a, b) => a - b);
    for (let i = 0; i < cycles.length; i++) {
      if (cycles[i] !== i + 1) {
        fail('cycle_gap', `فجوة دورات: ${cycles.join(',')}`, row.payroll_run_id);
        break;
      }
    }
  }

  // UNDER_REVIEW: لا قرار نهائي في الدورة النشطة + يوجد Submit
  const underReview = await txQuery<{
    id: string;
    approval_cycle: number;
    snapshot_hash: string | null;
    review_snapshot_hash: string | null;
  }>(
    client,
    `SELECT id::text, approval_cycle, snapshot_hash, review_snapshot_hash
     FROM accounts.payroll_runs WHERE status='UNDER_REVIEW' LIMIT 500`
  );
  for (const run of underReview.rows) {
    const acts = await txQuery<{ action: string; n: number }>(
      client,
      `SELECT action, COUNT(*)::int n FROM accounts.payroll_run_approval_actions
       WHERE payroll_run_id=$1::uuid AND approval_cycle=$2
       GROUP BY action`,
      [run.id, run.approval_cycle]
    );
    const map = Object.fromEntries(acts.rows.map((r) => [r.action, Number(r.n)]));
    if (!map.SUBMITTED_FOR_REVIEW) {
      fail('under_review_no_submit_action', 'UNDER_REVIEW بلا Submit Action', run.id);
    }
    if (map.APPROVED || map.REJECTED) {
      fail('under_review_has_terminal', 'UNDER_REVIEW مع قرار نهائي في الدورة', run.id);
    }
    if (
      isPayrollSnapshotHash(run.review_snapshot_hash) &&
      isPayrollSnapshotHash(run.snapshot_hash) &&
      str(run.review_snapshot_hash) !== str(run.snapshot_hash)
    ) {
      fail('under_review_hash_drift', 'انحراف بصمة المراجعة', run.id);
    }
  }

  // APPROVED: Submit + Approve في الدورة، بلا Reject في نفس الدورة
  const approved = await txQuery<{
    id: string;
    approval_cycle: number;
    approved_snapshot_hash: string | null;
    snapshot_hash: string | null;
  }>(
    client,
    `SELECT id::text, approval_cycle, approved_snapshot_hash, snapshot_hash
     FROM accounts.payroll_runs WHERE status='APPROVED' LIMIT 500`
  );
  for (const run of approved.rows) {
    const acts = await txQuery<{ action: string; n: number }>(
      client,
      `SELECT action, COUNT(*)::int n FROM accounts.payroll_run_approval_actions
       WHERE payroll_run_id=$1::uuid AND approval_cycle=$2
       GROUP BY action`,
      [run.id, run.approval_cycle]
    );
    const map = Object.fromEntries(acts.rows.map((r) => [r.action, Number(r.n)]));
    if (!map.SUBMITTED_FOR_REVIEW) {
      fail('approved_no_submit', 'APPROVED بلا Submit في الدورة', run.id);
    }
    if (!map.APPROVED) {
      fail('approved_no_approve_action', 'APPROVED بلا Approved action', run.id);
    }
    if (map.REJECTED) {
      fail('approved_with_reject_same_cycle', 'APPROVED مع Reject في نفس الدورة', run.id);
    }
    if (
      isPayrollSnapshotHash(run.approved_snapshot_hash) &&
      isPayrollSnapshotHash(run.snapshot_hash) &&
      str(run.approved_snapshot_hash) !== str(run.snapshot_hash)
    ) {
      fail('approved_hash_mismatch', 'mismatch بصمة الاعتماد', run.id);
    }
  }

  // SoD: Rejector ≠ Submitter في نفس الدورة
  const rejectRows = await txQuery<{
    id: string;
    payroll_run_id: string;
    approval_cycle: number;
    actor_id: string | null;
  }>(
    client,
    `SELECT id::text, payroll_run_id::text, approval_cycle, actor_id::text
     FROM accounts.payroll_run_approval_actions WHERE action='REJECTED' LIMIT 1000`
  );
  for (const rj of rejectRows.rows) {
    const sub = await txQuery<{ actor_id: string | null }>(
      client,
      `SELECT actor_id::text FROM accounts.payroll_run_approval_actions
       WHERE payroll_run_id=$1::uuid AND approval_cycle=$2 AND action='SUBMITTED_FOR_REVIEW'
       LIMIT 1`,
      [rj.payroll_run_id, rj.approval_cycle]
    );
    if (
      rj.actor_id &&
      sub.rows[0]?.actor_id &&
      str(rj.actor_id) === str(sub.rows[0].actor_id)
    ) {
      fail('sod_submitter_equals_rejector', 'Submitter = Rejector', rj.payroll_run_id);
    }
  }

  // Idempotency: مفتاح واحد مع payloads مختلفة
  const dupKeys = await txQuery<{
    payroll_run_id: string;
    request_key_hash: string;
    n: number;
    payloads: number;
  }>(
    client,
    `SELECT payroll_run_id::text, request_key_hash,
            COUNT(*)::int n,
            COUNT(DISTINCT request_payload_hash)::int payloads
     FROM accounts.payroll_run_approval_actions
     WHERE request_key_hash IS NOT NULL
     GROUP BY payroll_run_id, request_key_hash
     HAVING COUNT(*) > 1 OR COUNT(DISTINCT request_payload_hash) > 1
     LIMIT 200`
  );
  for (const d of dupKeys.rows) {
    if (Number(d.payloads) > 1) {
      fail(
        'idempotency_key_payload_conflict',
        'نفس المفتاح مع payloads مختلفة',
        d.payroll_run_id
      );
    } else if (Number(d.n) > 1) {
      fail('duplicate_action_identity', 'تكرار هوية إجراء', d.payroll_run_id);
    }
  }

  // Audit: blocked لا يُحسب كنجاح — لا مفتاح خام / لا SQL
  const leakyAudit = await txQuery<{ id: string; action: string }>(
    client,
    `SELECT id::text, action
     FROM accounts.financial_audit_log
     WHERE entity_type='payroll_run'
       AND action LIKE 'payroll_run.%'
       AND (
         new_values ? 'idempotency_key'
         OR old_values ? 'idempotency_key'
         OR COALESCE(new_values::text,'') ILIKE '%snapshot_json%'
         OR COALESCE(description,'') ILIKE '%SELECT %'
         OR COALESCE(description,'') ILIKE '%stack%'
       )
     LIMIT 100`
  );
  for (const a of leakyAudit.rows) {
    fail('audit_sensitive_leak', `تسريب في audit ${a.action}`, a.id);
  }

  // DTO سجل التاريخ: لا حقول حساسة في عناصر مصدر actions عبر list helper
  const sampleRuns = await txQuery<{ id: string }>(
    client,
    `SELECT DISTINCT payroll_run_id::text AS id
     FROM accounts.payroll_run_approval_actions
     ORDER BY 1
     LIMIT 30`
  );
  for (const r of sampleRuns.rows) {
    const page = await listPayrollRunApprovalHistory(client, r.id, { page: 1, page_size: 20 });
    const serial = JSON.stringify(page);
    for (const field of [
      'request_key_hash',
      'request_payload_hash',
      'request_key_masked',
      'snapshot_json',
      'metadata_json',
    ]) {
      if (serial.includes(`"${field}"`)) {
        fail('history_dto_sensitive', `DTO التاريخ يعرض ${field}`, r.id);
      }
    }
    // لا تسمح بـ snapshot_hash الكامل كمفتاح (snapshot_hash_short مسموح)
    if (/"snapshot_hash"\s*:/.test(serial)) {
      fail('history_dto_full_hash', 'DTO التاريخ يعرض snapshot_hash كاملاً', r.id);
    }
  }

  const mismatch_count = mismatches.length;
  return {
    ok: mismatch_count === 0,
    strict,
    mismatches,
    warnings,
    mismatch_count,
    summary: {
      mismatch_count,
      warning_count: warnings.length,
      checked_runs: Number(core.summary?.checked_runs ?? 0) + underReview.rows.length + approved.rows.length,
      checked_actions: actions.rows.length,
      sources,
      empty_info:
        actions.rows.length === 0 && underReview.rows.length === 0 && approved.rows.length === 0
          ? 'بيئة فارغة من مسار الاعتماد — لا انحرافات'
          : undefined,
    },
  };
}
