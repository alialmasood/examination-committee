/**
 * تحقق سلامة نواة اعتماد الرواتب 9.B.1
 *
 * حدود: بلا أرشيف لقطة كامل — لا نثبت محتوى اللقطة التاريخي، فقط hashes/الحقول/الأفعال.
 */
import { isPayrollSnapshotHash } from './payroll-snapshot-hash';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type ApprovalVerifyIssue = { kind: string; detail: string; entity_id?: string };

export type PayrollApprovalVerifyResult = {
  ok: boolean;
  strict: boolean;
  mismatches: ApprovalVerifyIssue[];
  warnings: ApprovalVerifyIssue[];
  summary: {
    checked_runs: number;
    checked_actions: number;
    empty_info?: string;
  };
};

async function probeTransactionRollback(client: TxClient): Promise<void> {
  await txQuery(client, `SAVEPOINT __payroll_approval_core_verify_probe`);
  try {
    await txQuery(client, `CREATE TEMP TABLE IF NOT EXISTS __payroll_approval_core_probe (n int)`);
    await txQuery(client, `INSERT INTO __payroll_approval_core_probe(n) VALUES (1)`);
  } finally {
    await txQuery(client, `ROLLBACK TO SAVEPOINT __payroll_approval_core_verify_probe`);
    await txQuery(client, `RELEASE SAVEPOINT __payroll_approval_core_verify_probe`);
  }
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

const LEGAL_TRANSITIONS: Record<string, Array<{ from: string; to: string }>> = {
  SUBMITTED_FOR_REVIEW: [{ from: 'CALCULATED', to: 'UNDER_REVIEW' }],
  APPROVED: [{ from: 'UNDER_REVIEW', to: 'APPROVED' }],
  REJECTED: [{ from: 'UNDER_REVIEW', to: 'CALCULATED' }],
};

export async function verifyPayrollApprovalCore(
  client: TxClient,
  options: { strict?: boolean } = {}
): Promise<PayrollApprovalVerifyResult> {
  const strict = options.strict === true;
  const mismatches: ApprovalVerifyIssue[] = [];
  const warnings: ApprovalVerifyIssue[] = [];
  const fail = (kind: string, detail: string, entity_id?: string) =>
    mismatches.push({ kind, detail, entity_id });

  try {
    await probeTransactionRollback(client);
  } catch (e) {
    fail(
      'tx_rollback_probe',
      `فشل مسبار Transaction/ROLLBACK: ${e instanceof Error ? e.message.slice(0, 80) : 'unknown'}`
    );
  }

  const tableExists = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM information_schema.tables
     WHERE table_schema='accounts' AND table_name='payroll_run_approval_actions'`
  );
  if (Number(tableExists.rows[0]?.n ?? 0) === 0) {
    return {
      ok: mismatches.length === 0,
      strict,
      mismatches,
      warnings,
      summary: {
        checked_runs: 0,
        checked_actions: 0,
        empty_info: 'جدول الاعتماد غير موجود — ترحيل 097 مطلوب',
      },
    };
  }

  const runs = await txQuery<{
    id: string;
    status: string;
    approval_cycle: number;
    snapshot_hash: string | null;
    review_snapshot_hash: string | null;
    submitted_for_review_at: Date | string | null;
    submitted_for_review_by: string | null;
    approved_snapshot_hash: string | null;
    approved_at: Date | string | null;
    approved_by: string | null;
    error_count: number;
  }>(
    client,
    `SELECT id::text, status, approval_cycle, snapshot_hash, review_snapshot_hash,
            submitted_for_review_at, submitted_for_review_by::text,
            approved_snapshot_hash, approved_at, approved_by::text, error_count
     FROM accounts.payroll_runs
     WHERE status IN ('UNDER_REVIEW','APPROVED','CALCULATED','CANCELLED')
        OR approval_cycle > 0
     ORDER BY created_at DESC
     LIMIT 800`
  );

  for (const run of runs.rows) {
    if (run.status === 'UNDER_REVIEW') {
      if (!run.submitted_for_review_at || !run.submitted_for_review_by) {
        fail('under_review_missing_submit_fields', 'UNDER_REVIEW بلا حقول إرسال', run.id);
      }
      if (!isPayrollSnapshotHash(run.review_snapshot_hash)) {
        fail('under_review_missing_review_hash', 'UNDER_REVIEW بلا review_snapshot_hash', run.id);
      }
      if (
        isPayrollSnapshotHash(run.review_snapshot_hash) &&
        isPayrollSnapshotHash(run.snapshot_hash) &&
        str(run.review_snapshot_hash) !== str(run.snapshot_hash)
      ) {
        fail('under_review_hash_drift', 'review hash ≠ snapshot الحالي', run.id);
      }
      if (Number(run.error_count) > 0) {
        fail('under_review_has_errors', 'UNDER_REVIEW مع error_count > 0', run.id);
      }
      const blocking = await txQuery<{ n: number }>(
        client,
        `SELECT COUNT(*)::int n FROM accounts.payroll_run_issues
         WHERE payroll_run_id=$1::uuid AND severity='ERROR'`,
        [run.id]
      );
      if (Number(blocking.rows[0]?.n ?? 0) > 0) {
        fail('under_review_blocking_issues', 'UNDER_REVIEW مع مشكلات حاجبة', run.id);
      }
      if (run.approved_snapshot_hash || run.approved_at || run.approved_by) {
        fail('under_review_has_approved_fields', 'UNDER_REVIEW بحقول اعتماد غير فارغة', run.id);
      }
    }

    if (run.status === 'APPROVED') {
      if (!run.approved_at || !run.approved_by || !isPayrollSnapshotHash(run.approved_snapshot_hash)) {
        fail('approved_missing_fields', 'APPROVED بلا حقول اعتماد كاملة', run.id);
      }
      if (!run.submitted_for_review_at || !run.submitted_for_review_by) {
        fail('approved_missing_submit_fields', 'APPROVED بلا سلسلة إرسال', run.id);
      }
      if (
        isPayrollSnapshotHash(run.approved_snapshot_hash) &&
        isPayrollSnapshotHash(run.review_snapshot_hash) &&
        str(run.approved_snapshot_hash) !== str(run.review_snapshot_hash)
      ) {
        fail('approved_hash_ne_review', 'approved hash ≠ review hash', run.id);
      }
      if (
        isPayrollSnapshotHash(run.approved_snapshot_hash) &&
        isPayrollSnapshotHash(run.snapshot_hash) &&
        str(run.approved_snapshot_hash) !== str(run.snapshot_hash)
      ) {
        fail('approved_hash_drift', 'approved hash ≠ snapshot الحالي', run.id);
      }
      if (
        run.submitted_for_review_by &&
        run.approved_by &&
        str(run.submitted_for_review_by) === str(run.approved_by)
      ) {
        fail('sod_submitter_equals_approver', 'Submitter = Approver', run.id);
      }
    }

    if (run.status === 'CALCULATED') {
      if (run.review_snapshot_hash || run.submitted_for_review_at || run.submitted_for_review_by) {
        fail(
          'calculated_active_review_fields',
          'CALCULATED ما زال يحمل قفل مراجعة نشط',
          run.id
        );
      }
    }

    if (run.status === 'CANCELLED') {
      if (run.review_snapshot_hash || run.submitted_for_review_at || run.submitted_for_review_by) {
        fail('cancelled_active_review_fields', 'CANCELLED بحقول مراجعة نشطة', run.id);
      }
    }
  }

  const actions = await txQuery<{
    id: string;
    payroll_run_id: string;
    approval_cycle: number;
    action: string;
    from_status: string;
    to_status: string;
    actor_id: string | null;
    comment: string | null;
    reason: string | null;
    snapshot_hash: string;
    version_before: number;
    version_after: number;
    request_key_hash: string;
    request_payload_hash: string;
    metadata_json: Record<string, unknown> | null;
    created_at: Date | string;
  }>(
    client,
    `SELECT id::text, payroll_run_id::text, approval_cycle, action, from_status, to_status,
            actor_id::text, comment, reason, snapshot_hash, version_before, version_after,
            request_key_hash, request_payload_hash, metadata_json, created_at
     FROM accounts.payroll_run_approval_actions
     ORDER BY created_at ASC
     LIMIT 2000`
  );

  const byRunCycle = new Map<string, typeof actions.rows>();
  for (const a of actions.rows) {
    const k = `${a.payroll_run_id}:${a.approval_cycle}`;
    const list = byRunCycle.get(k) ?? [];
    list.push(a);
    byRunCycle.set(k, list);

    const legal = LEGAL_TRANSITIONS[a.action] ?? [];
    if (!legal.some((t) => t.from === a.from_status && t.to === a.to_status)) {
      fail(
        'illegal_action_transition',
        `${a.action}: ${a.from_status}→${a.to_status}`,
        a.id
      );
    }
    if (Number(a.version_after) < Number(a.version_before)) {
      fail('version_not_monotonic', 'version_after < version_before', a.id);
    }
    if (!isPayrollSnapshotHash(a.snapshot_hash)) {
      fail('action_missing_snapshot_hash', 'بصمة اللقطة مفقودة أو غير صالحة', a.id);
    }
    if (!/^[0-9a-f]{64}$/.test(str(a.request_key_hash))) {
      fail('malformed_request_key_hash', 'request_key_hash غير صالح', a.id);
    }
    if (!/^[0-9a-f]{64}$/.test(str(a.request_payload_hash))) {
      fail('malformed_request_payload_hash', 'request_payload_hash غير صالح', a.id);
    }
    if (a.action === 'REJECTED') {
      const r = str(a.reason);
      if (!r || r.length < 10) {
        fail('reject_without_reason', 'REJECTED بلا سبب كافٍ', a.id);
      }
    }
    const meta = a.metadata_json ?? {};
    const blob = JSON.stringify(meta) + str(a.comment) + str(a.reason);
    if (/idempotency[_-]?key/i.test(blob) && /["'][^"']{8,}["']/.test(blob)) {
      // تحذير فقط إن وُجد مفتاح خام واضح
      if (/"idempotency_key"\s*:/.test(blob) || /idempotency_key=/.test(blob)) {
        fail('raw_idempotency_key_leaked', 'مفتاح تكرار خام في metadata/comment', a.id);
      }
    }
  }

  for (const [k, list] of byRunCycle) {
    const submits = list.filter((x) => x.action === 'SUBMITTED_FOR_REVIEW');
    const approved = list.filter((x) => x.action === 'APPROVED');
    const rejected = list.filter((x) => x.action === 'REJECTED');
    if (submits.length > 1) {
      fail('duplicate_submit_per_cycle', `Submit مكرر في ${k}`, submits[0]?.payroll_run_id);
    }
    if (approved.length + rejected.length > 1) {
      fail(
        'duplicate_terminal_per_cycle',
        `أكثر من فعل طرفي في ${k}`,
        list[0]?.payroll_run_id
      );
    }
    if (approved.length > 0 && rejected.length > 0) {
      fail('approved_and_rejected_same_cycle', `APPROVED+REJECTED في ${k}`, list[0]?.payroll_run_id);
    }
    if ((approved.length > 0 || rejected.length > 0) && submits.length === 0) {
      fail(
        'terminal_without_submit',
        `فعل طرفي بلا Submit في ${k}`,
        list[0]?.payroll_run_id
      );
    }

    const runId = list[0]?.payroll_run_id;
    if (runId) {
      const runRow = runs.rows.find((r) => r.id === runId);
      if (runRow && Number(runRow.approval_cycle) < Number(list[0].approval_cycle)) {
        fail(
          'action_cycle_ahead_of_run',
          `دورة action أعلى من Run (${k})`,
          runId
        );
      }
      if (runRow?.status === 'APPROVED' && approved.length === 0) {
        const cycleActions = list.filter(
          (x) => Number(x.approval_cycle) === Number(runRow.approval_cycle)
        );
        if (cycleActions.length > 0 && !cycleActions.some((x) => x.action === 'APPROVED')) {
          fail('approved_run_missing_approve_action', 'APPROVED بلا APPROVED action', runId);
        }
      }
      if (approved.length > 0 && submits.length > 0) {
        const sub = submits[0];
        const ap = approved[0];
        if (new Date(ap.created_at).getTime() < new Date(sub.created_at).getTime()) {
          fail('approve_before_submit', 'Approve أقدم من Submit في الدورة', runId);
        }
        if (
          sub.actor_id &&
          ap.actor_id &&
          str(sub.actor_id) === str(ap.actor_id)
        ) {
          fail('sod_submitter_equals_approver_action', 'Submitter=Approver في actions', runId);
        }
      }
      if (rejected.length > 0 && submits.length > 0) {
        const sub = submits[0];
        const rej = rejected[0];
        if (sub.actor_id && rej.actor_id && str(sub.actor_id) === str(rej.actor_id)) {
          fail('sod_submitter_equals_rejector', 'Submitter=Rejector في actions', runId);
        }
      }
    }
  }

  // مفاتيح مكررة (يجب أن يمنعها unique — كشف التلاعب)
  const keyCounts = new Map<string, number>();
  for (const a of actions.rows) {
    keyCounts.set(a.request_key_hash, (keyCounts.get(a.request_key_hash) ?? 0) + 1);
  }
  for (const [hash, n] of keyCounts) {
    if (n > 1) {
      fail('duplicate_request_key_hash', `request_key_hash مكرر (${n})`, hash.slice(0, 16));
    }
  }

  if (strict && runs.rows.length === 0 && actions.rows.length === 0) {
    // بيئة فارغة مقبولة في strict
  }

  return {
    ok: mismatches.length === 0,
    strict,
    mismatches,
    warnings,
    summary: {
      checked_runs: runs.rows.length,
      checked_actions: actions.rows.length,
      empty_info:
        runs.rows.length === 0 && actions.rows.length === 0
          ? 'لا سجلات اعتماد للفحص — بيئة فارغة سليمة'
          : undefined,
    },
  };
}
