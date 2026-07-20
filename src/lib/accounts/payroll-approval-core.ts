/**
 * نواة اعتماد الرواتب 9.B.1 — Submit / Approve / Reject
 *
 * بلا Public API · Source of Truth للنجاح = payroll_run_approval_actions
 * Idempotency lookup بعد القفل وقبل فحص الحالة (لدعم Replay).
 */
import { AccountsHttpError } from './auth';
import { writeFinancialAudit } from './audit';
import { payrollPeriodLock, payrollRunLock } from './accounting-locks';
import { isSupportedPayrollCurrency } from './payroll-calculation-formulas';
import { hitPayrollApprovalFailpoint } from './payroll-approval-failpoints';
import {
  buildApprovalRequestKeyHash,
  buildApprovalRequestPayloadHash,
  maskIdempotencyKey,
  normalizeApprovalComment,
  normalizeApprovalIdempotencyKey,
  normalizeApprovalRejectReason,
  type PayrollApprovalOperation,
} from './payroll-approval-idempotency';
import { acquirePayrollLocks } from './payroll-locks';
import { loadPayrollPeriod } from './payroll-periods';
import {
  loadPayrollRun,
  serializePayrollRun,
  type PayrollRunRow,
} from './payroll-runs';
import { isPayrollSnapshotHash } from './payroll-snapshot-hash';
import {
  assertPayrollConcurrency,
  dateStr,
  iso,
  requirePayrollUuid,
} from './payroll-validation';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PayrollApprovalActionRow = {
  id: string;
  payroll_run_id: string;
  payroll_period_id: string;
  approval_cycle: number;
  action: string;
  from_status: string;
  to_status: string;
  actor_id: string | null;
  actor_display_name_snapshot: string | null;
  comment: string | null;
  reason: string | null;
  snapshot_hash: string;
  version_before: number;
  version_after: number;
  request_key_hash: string;
  request_payload_hash: string;
  request_key_masked: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: Date | string;
};

export type PayrollApprovalCoreResult = {
  run: ReturnType<typeof serializePayrollRun>;
  action: {
    id: string;
    action: string;
    from_status: string;
    to_status: string;
    approval_cycle: number;
    snapshot_hash: string;
    created_at: string | null;
  };
  idempotent_replay: boolean;
};

async function countBlockingIssues(client: TxClient, runId: string): Promise<number> {
  const r = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.payroll_run_issues
     WHERE payroll_run_id=$1::uuid AND severity='ERROR'`,
    [runId]
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function assertArtifactsMatchRunTotals(
  client: TxClient,
  run: PayrollRunRow
): Promise<void> {
  const arts = await txQuery<{
    people_n: number;
    gross: string;
    ded: string;
    emp: string;
    net: string;
  }>(
    client,
    `SELECT
       COUNT(*)::int AS people_n,
       COALESCE(SUM(gross_amount),0)::text AS gross,
       COALESCE(SUM(deductions_amount),0)::text AS ded,
       COALESCE(SUM(employer_contributions_amount),0)::text AS emp,
       COALESCE(SUM(net_amount),0)::text AS net
     FROM accounts.payroll_run_people
     WHERE payroll_run_id=$1::uuid AND superseded=FALSE`,
    [run.id]
  );
  const row = arts.rows[0];
  if (!row) {
    throw new AccountsHttpError('آثار الاحتساب غير متاحة للتحقق', 422);
  }
  if (Number(row.people_n) !== Number(run.people_count)) {
    throw new AccountsHttpError(
      'عدد الأشخاص في اللقطة لا يطابق ملخص التشغيل',
      422
    );
  }
  const eq = (a: unknown, b: unknown) => Number(a) === Number(b);
  if (
    !eq(row.gross, run.gross_total) ||
    !eq(row.ded, run.deduction_total) ||
    !eq(row.emp, run.employer_contribution_total) ||
    !eq(row.net, run.net_total)
  ) {
    throw new AccountsHttpError(
      'إجماليات التشغيل لا تطابق آثار الاحتساب',
      422
    );
  }
}

async function loadActorDisplayName(
  client: TxClient,
  userId: string
): Promise<string | null> {
  const r = await txQuery<{ name: string | null }>(
    client,
    `SELECT COALESCE(full_name, username) AS name FROM student_affairs.users WHERE id=$1::uuid`,
    [userId]
  );
  return r.rows[0]?.name ? String(r.rows[0].name) : null;
}

async function findActionByKeyHash(
  client: TxClient,
  keyHash: string,
  forUpdate: boolean
): Promise<PayrollApprovalActionRow | null> {
  const r = await txQuery<PayrollApprovalActionRow>(
    client,
    `SELECT * FROM accounts.payroll_run_approval_actions
     WHERE request_key_hash=$1
     ${forUpdate ? 'FOR UPDATE' : ''}
     LIMIT 1`,
    [keyHash]
  );
  return r.rows[0] ?? null;
}

async function hasTerminalActionForCycle(
  client: TxClient,
  runId: string,
  cycle: number
): Promise<boolean> {
  const r = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int n FROM accounts.payroll_run_approval_actions
     WHERE payroll_run_id=$1::uuid AND approval_cycle=$2
       AND action IN ('APPROVED','REJECTED')`,
    [runId, cycle]
  );
  return Number(r.rows[0]?.n ?? 0) > 0;
}

function serializeAction(a: PayrollApprovalActionRow) {
  return {
    id: a.id,
    action: a.action,
    from_status: a.from_status,
    to_status: a.to_status,
    approval_cycle: Number(a.approval_cycle),
    snapshot_hash: a.snapshot_hash,
    created_at: iso(a.created_at),
  };
}

function assertActionIntegrity(
  action: PayrollApprovalActionRow,
  runId: string,
  payloadHash: string
): void {
  if (String(action.payroll_run_id) !== runId) {
    throw new AccountsHttpError(
      'تعارض سلامة سجل الاعتماد: السجل لا يعود لنفس التشغيل (APPROVAL_INTEGRITY_CONFLICT)',
      409
    );
  }
  if (String(action.request_payload_hash) !== payloadHash) {
    throw new AccountsHttpError(
      'تعارض مفتاح التكرار: نفس المفتاح مع حمولة مختلفة (IDEMPOTENCY_CONFLICT)',
      409
    );
  }
  if (!isPayrollSnapshotHash(action.snapshot_hash)) {
    throw new AccountsHttpError(
      'سجل اعتماد سابق تالف — رُفضت الإعادة الآمنة (APPROVAL_INTEGRITY_CONFLICT)',
      409
    );
  }
}

async function insertAction(
  client: TxClient,
  input: {
    run: PayrollRunRow;
    cycle: number;
    action: 'SUBMITTED_FOR_REVIEW' | 'APPROVED' | 'REJECTED';
    fromStatus: string;
    toStatus: string;
    actorId: string;
    actorName: string | null;
    comment: string | null;
    reason: string | null;
    snapshotHash: string;
    versionBefore: number;
    versionAfter: number;
    keyHash: string;
    payloadHash: string;
    keyMasked: string;
  }
): Promise<PayrollApprovalActionRow> {
  try {
    const r = await txQuery<PayrollApprovalActionRow>(
      client,
      `INSERT INTO accounts.payroll_run_approval_actions
         (payroll_run_id, payroll_period_id, approval_cycle, action, from_status, to_status,
          actor_id, actor_display_name_snapshot, comment, reason, snapshot_hash,
          version_before, version_after, request_key_hash, request_payload_hash, request_key_masked)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        input.run.id,
        input.run.payroll_period_id,
        input.cycle,
        input.action,
        input.fromStatus,
        input.toStatus,
        input.actorId,
        input.actorName,
        input.comment,
        input.reason,
        input.snapshotHash,
        input.versionBefore,
        input.versionAfter,
        input.keyHash,
        input.payloadHash,
        input.keyMasked,
      ]
    );
    return r.rows[0];
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err?.code === '23505') {
      if (String(err.constraint ?? '').includes('request_key')) {
        const existing = await findActionByKeyHash(client, input.keyHash, true);
        if (existing && String(existing.request_payload_hash) === input.payloadHash) {
          return existing;
        }
        throw new AccountsHttpError(
          'تعارض مفتاح التكرار: نفس المفتاح مع حمولة مختلفة (IDEMPOTENCY_CONFLICT)',
          409
        );
      }
      throw new AccountsHttpError(
        'تعارض سجل اعتماد للدورة الحالية — رُفضت العملية',
        409
      );
    }
    throw e;
  }
}

async function assertPeriodAllowsApproval(
  client: TxClient,
  periodId: string
): Promise<void> {
  const period = await loadPayrollPeriod(client, periodId, true);
  if (period.status !== 'OPEN' && period.status !== 'PROCESSING') {
    throw new AccountsHttpError(
      `لا يمكن اعتماد الرواتب وفترة الرواتب في حالة ${period.status}`,
      409
    );
  }
}

function requirePositiveVersion(v: unknown): number {
  if (v == null) throw new AccountsHttpError('رقم الإصدار (version) مطلوب', 400);
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) {
    throw new AccountsHttpError('رقم الإصدار غير صالح', 400);
  }
  return n;
}

function requireUpdatedAtIso(v: unknown): string {
  if (v == null || v === '') {
    throw new AccountsHttpError('حقل updated_at مطلوب للتحقق من التزامن', 400);
  }
  const s = iso(v as Date | string);
  if (!s) throw new AccountsHttpError('قيمة updated_at غير صالحة', 400);
  return s;
}

function assertNotSubmitter(actorId: string, submittedBy: string | null, verb: string): void {
  if (submittedBy && String(submittedBy) === String(actorId)) {
    throw new AccountsHttpError(
      `لا يجوز لمرسل المراجعة أن ${verb} نفس الدورة (فصل الواجبات)`,
      403
    );
  }
}

async function assertCleanCalculatedLike(
  client: TxClient,
  run: PayrollRunRow
): Promise<void> {
  if (!isSupportedPayrollCurrency(run.currency_code)) {
    throw new AccountsHttpError(
      'عملة تشغيل الرواتب غير مدعومة حاليًا. يدعم النظام الدينار العراقي IQD فقط',
      422
    );
  }
  if (!isPayrollSnapshotHash(run.snapshot_hash)) {
    throw new AccountsHttpError('لا يمكن المتابعة بلا بصمة لقطة صالحة', 422);
  }
  if (Number(run.error_count) > 0) {
    throw new AccountsHttpError(
      'لا يمكن المتابعة وتشغيل الرواتب يحتوي على أخطاء احتساب',
      422
    );
  }
  const blocking = await countBlockingIssues(client, run.id);
  if (blocking > 0) {
    throw new AccountsHttpError(
      'لا يمكن المتابعة وتشغيل الرواتب يحتوي على مشكلات حاجبة',
      422
    );
  }
  await assertArtifactsMatchRunTotals(client, run);
}

// ─── Submit ───────────────────────────────────────────────────

export async function submitPayrollRunForReviewCore(
  client: TxClient,
  input: {
    run_id: string;
    version: unknown;
    updated_at: unknown;
    idempotency_key: unknown;
    comment?: unknown;
    userId: string;
  }
): Promise<PayrollApprovalCoreResult> {
  const runId = requirePayrollUuid(input.run_id, 'معرّف التشغيل');
  const key = normalizeApprovalIdempotencyKey(input.idempotency_key);
  const comment = normalizeApprovalComment(input.comment);
  const expectedVersion = requirePositiveVersion(input.version);
  const expectedUpdatedAt = requireUpdatedAtIso(input.updated_at);
  const op: PayrollApprovalOperation = 'SUBMIT_FOR_REVIEW';
  const keyHash = buildApprovalRequestKeyHash(op, key);
  const keyMasked = maskIdempotencyKey(key);

  const existing = await loadPayrollRun(client, runId);
  await acquirePayrollLocks(client, [
    payrollPeriodLock(existing.payroll_period_id),
    payrollRunLock(runId),
  ]);
  hitPayrollApprovalFailpoint('submit_after_lock');

  const run = await loadPayrollRun(client, runId, true);
  const prior = await findActionByKeyHash(client, keyHash, true);

  const snapshotForPayload =
    prior != null
      ? String(prior.snapshot_hash)
      : run.snapshot_hash && isPayrollSnapshotHash(run.snapshot_hash)
        ? String(run.snapshot_hash)
        : '';

  const payloadHash = buildApprovalRequestPayloadHash(op, {
    run_id: runId,
    expected_version: expectedVersion,
    expected_updated_at: expectedUpdatedAt,
    snapshot_hash: snapshotForPayload,
    normalized_comment: comment,
  });

  if (prior) {
    assertActionIntegrity(prior, runId, payloadHash);
    return {
      run: serializePayrollRun(run),
      action: serializeAction(prior),
      idempotent_replay: true,
    };
  }

  assertPayrollConcurrency(run, input.version, input.updated_at, 'تشغيل الرواتب');
  if (run.status !== 'CALCULATED') {
    throw new AccountsHttpError(
      'لا يمكن إرسال تشغيل للمراجعة إلا وهو محتسب (CALCULATED)',
      409
    );
  }
  await assertCleanCalculatedLike(client, run);
  await assertPeriodAllowsApproval(client, run.payroll_period_id);
  hitPayrollApprovalFailpoint('submit_after_validation');

  const calcDate = dateStr(run.calculation_date);
  if (!calcDate) throw new AccountsHttpError('تاريخ الاحتساب غير صالح', 400);

  const versionBefore = Number(run.version);
  const nextCycle = Number(run.approval_cycle ?? 0) + 1;
  const hash = String(run.snapshot_hash);

  const updated = await txQuery<PayrollRunRow>(
    client,
    `UPDATE accounts.payroll_runs SET
       status = 'UNDER_REVIEW',
       approval_cycle = $2,
       review_snapshot_hash = $3,
       submitted_for_review_at = NOW(),
       submitted_for_review_by = $4::uuid,
       approved_snapshot_hash = NULL,
       approved_at = NULL,
       approved_by = NULL,
       updated_by = $4::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [run.id, nextCycle, hash, input.userId]
  );
  const next = updated.rows[0];
  hitPayrollApprovalFailpoint('submit_after_run_update');

  const actorName = await loadActorDisplayName(client, input.userId);
  hitPayrollApprovalFailpoint('submit_during_action_insert');
  const action = await insertAction(client, {
    run: next,
    cycle: nextCycle,
    action: 'SUBMITTED_FOR_REVIEW',
    fromStatus: 'CALCULATED',
    toStatus: 'UNDER_REVIEW',
    actorId: input.userId,
    actorName,
    comment: comment || null,
    reason: null,
    snapshotHash: hash,
    versionBefore,
    versionAfter: Number(next.version),
    keyHash,
    payloadHash,
    keyMasked,
  });

  await writeFinancialAudit(client, {
    userId: input.userId,
    action: 'payroll_run.submitted_for_review',
    entityType: 'payroll_run',
    entityId: run.id,
    newValues: {
      approval_cycle: nextCycle,
      review_snapshot_hash: hash,
      action_id: action.id,
      request_key_masked: keyMasked,
    },
    description: `إرسال تشغيل رواتب ${next.run_number} للمراجعة`,
  });

  return {
    run: serializePayrollRun(next),
    action: serializeAction(action),
    idempotent_replay: false,
  };
}

// ─── Approve ──────────────────────────────────────────────────

export async function approvePayrollRunCore(
  client: TxClient,
  input: {
    run_id: string;
    version: unknown;
    updated_at: unknown;
    idempotency_key: unknown;
    comment?: unknown;
    userId: string;
  }
): Promise<PayrollApprovalCoreResult> {
  const runId = requirePayrollUuid(input.run_id, 'معرّف التشغيل');
  const key = normalizeApprovalIdempotencyKey(input.idempotency_key);
  const comment = normalizeApprovalComment(input.comment);
  const expectedVersion = requirePositiveVersion(input.version);
  const expectedUpdatedAt = requireUpdatedAtIso(input.updated_at);
  const op: PayrollApprovalOperation = 'APPROVE';
  const keyHash = buildApprovalRequestKeyHash(op, key);
  const keyMasked = maskIdempotencyKey(key);

  const existing = await loadPayrollRun(client, runId);
  await acquirePayrollLocks(client, [
    payrollPeriodLock(existing.payroll_period_id),
    payrollRunLock(runId),
  ]);

  const run = await loadPayrollRun(client, runId, true);
  const prior = await findActionByKeyHash(client, keyHash, true);

  const reviewHashForPayload =
    prior != null
      ? String(prior.snapshot_hash)
      : run.review_snapshot_hash && isPayrollSnapshotHash(run.review_snapshot_hash)
        ? String(run.review_snapshot_hash)
        : '';

  const payloadHash = buildApprovalRequestPayloadHash(op, {
    run_id: runId,
    expected_version: expectedVersion,
    expected_updated_at: expectedUpdatedAt,
    review_snapshot_hash: reviewHashForPayload,
    normalized_comment: comment,
  });

  if (prior) {
    assertActionIntegrity(prior, runId, payloadHash);
    return {
      run: serializePayrollRun(run),
      action: serializeAction(prior),
      idempotent_replay: true,
    };
  }

  assertPayrollConcurrency(run, input.version, input.updated_at, 'تشغيل الرواتب');
  if (run.status !== 'UNDER_REVIEW') {
    throw new AccountsHttpError(
      'لا يمكن اعتماد تشغيل إلا وهو قيد المراجعة (UNDER_REVIEW)',
      409
    );
  }
  assertNotSubmitter(input.userId, run.submitted_for_review_by, 'يعتمد');
  if (!isPayrollSnapshotHash(run.review_snapshot_hash)) {
    throw new AccountsHttpError('قفل مراجعة اللقطة مفقود أو غير صالح', 422);
  }
  if (String(run.snapshot_hash) !== String(run.review_snapshot_hash)) {
    throw new AccountsHttpError(
      'بصمة اللقطة الحالية لا تطابق قفل المراجعة — رُفض الاعتماد',
      409
    );
  }
  await assertCleanCalculatedLike(client, run);
  await assertPeriodAllowsApproval(client, run.payroll_period_id);

  const cycle = Number(run.approval_cycle);
  if (await hasTerminalActionForCycle(client, run.id, cycle)) {
    throw new AccountsHttpError(
      'هذه الدورة انتهت مسبقاً باعتماد أو رفض — لا يمكن الاعتماد مجدداً',
      409
    );
  }
  hitPayrollApprovalFailpoint('approve_after_verify');

  const versionBefore = Number(run.version);
  const hash = String(run.snapshot_hash);

  const updated = await txQuery<PayrollRunRow>(
    client,
    `UPDATE accounts.payroll_runs SET
       status = 'APPROVED',
       approved_snapshot_hash = $2,
       approved_at = NOW(),
       approved_by = $3::uuid,
       updated_by = $3::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [run.id, hash, input.userId]
  );
  const next = updated.rows[0];
  hitPayrollApprovalFailpoint('approve_after_run_update');

  const actorName = await loadActorDisplayName(client, input.userId);
  hitPayrollApprovalFailpoint('approve_during_action_insert');
  const action = await insertAction(client, {
    run: next,
    cycle,
    action: 'APPROVED',
    fromStatus: 'UNDER_REVIEW',
    toStatus: 'APPROVED',
    actorId: input.userId,
    actorName,
    comment: comment || null,
    reason: null,
    snapshotHash: hash,
    versionBefore,
    versionAfter: Number(next.version),
    keyHash,
    payloadHash,
    keyMasked,
  });

  await writeFinancialAudit(client, {
    userId: input.userId,
    action: 'payroll_run.approved',
    entityType: 'payroll_run',
    entityId: run.id,
    newValues: {
      approval_cycle: cycle,
      approved_snapshot_hash: hash,
      action_id: action.id,
      request_key_masked: keyMasked,
    },
    description: `اعتماد تشغيل رواتب ${next.run_number}`,
  });

  return {
    run: serializePayrollRun(next),
    action: serializeAction(action),
    idempotent_replay: false,
  };
}

// ─── Reject ───────────────────────────────────────────────────

export async function rejectPayrollRunReviewCore(
  client: TxClient,
  input: {
    run_id: string;
    version: unknown;
    updated_at: unknown;
    idempotency_key: unknown;
    reason: unknown;
    userId: string;
  }
): Promise<PayrollApprovalCoreResult> {
  const runId = requirePayrollUuid(input.run_id, 'معرّف التشغيل');
  const key = normalizeApprovalIdempotencyKey(input.idempotency_key);
  const reason = normalizeApprovalRejectReason(input.reason);
  const expectedVersion = requirePositiveVersion(input.version);
  const expectedUpdatedAt = requireUpdatedAtIso(input.updated_at);
  const op: PayrollApprovalOperation = 'REJECT';
  const keyHash = buildApprovalRequestKeyHash(op, key);
  const keyMasked = maskIdempotencyKey(key);

  const existing = await loadPayrollRun(client, runId);
  await acquirePayrollLocks(client, [
    payrollPeriodLock(existing.payroll_period_id),
    payrollRunLock(runId),
  ]);

  const run = await loadPayrollRun(client, runId, true);
  const prior = await findActionByKeyHash(client, keyHash, true);

  const reviewHashForPayload =
    prior != null
      ? String(prior.snapshot_hash)
      : run.review_snapshot_hash && isPayrollSnapshotHash(run.review_snapshot_hash)
        ? String(run.review_snapshot_hash)
        : '';

  const payloadHash = buildApprovalRequestPayloadHash(op, {
    run_id: runId,
    expected_version: expectedVersion,
    expected_updated_at: expectedUpdatedAt,
    review_snapshot_hash: reviewHashForPayload,
    normalized_reason: reason,
  });

  if (prior) {
    assertActionIntegrity(prior, runId, payloadHash);
    return {
      run: serializePayrollRun(run),
      action: serializeAction(prior),
      idempotent_replay: true,
    };
  }

  assertPayrollConcurrency(run, input.version, input.updated_at, 'تشغيل الرواتب');
  if (run.status !== 'UNDER_REVIEW') {
    throw new AccountsHttpError(
      'لا يمكن رفض مراجعة إلا والتشغيل قيد المراجعة (UNDER_REVIEW)',
      409
    );
  }
  assertNotSubmitter(input.userId, run.submitted_for_review_by, 'يرفض');
  if (!isPayrollSnapshotHash(run.review_snapshot_hash)) {
    throw new AccountsHttpError('قفل مراجعة اللقطة مفقود أو غير صالح', 422);
  }
  hitPayrollApprovalFailpoint('reject_after_reason_validation');

  const cycle = Number(run.approval_cycle);
  if (await hasTerminalActionForCycle(client, run.id, cycle)) {
    throw new AccountsHttpError(
      'هذه الدورة انتهت مسبقاً باعتماد أو رفض — لا يمكن الرفض مجدداً',
      409
    );
  }

  const versionBefore = Number(run.version);
  const hash = String(run.review_snapshot_hash);
  const actorName = await loadActorDisplayName(client, input.userId);

  // نُدخل REJECTED أولاً ثم نحدّث التشغيل — أي فشل بعد الإدراج يتراجع بالكامل
  const action = await insertAction(client, {
    run,
    cycle,
    action: 'REJECTED',
    fromStatus: 'UNDER_REVIEW',
    toStatus: 'CALCULATED',
    actorId: input.userId,
    actorName,
    comment: null,
    reason,
    snapshotHash: hash,
    versionBefore,
    versionAfter: versionBefore + 1,
    keyHash,
    payloadHash,
    keyMasked,
  });
  hitPayrollApprovalFailpoint('reject_after_action_insert');

  const updated = await txQuery<PayrollRunRow>(
    client,
    `UPDATE accounts.payroll_runs SET
       status = 'CALCULATED',
       review_snapshot_hash = NULL,
       submitted_for_review_at = NULL,
       submitted_for_review_by = NULL,
       approved_snapshot_hash = NULL,
       approved_at = NULL,
       approved_by = NULL,
       updated_by = $2::uuid,
       updated_at = NOW(),
       version = version + 1
     WHERE id = $1::uuid
     RETURNING *`,
    [run.id, input.userId]
  );
  const next = updated.rows[0];
  hitPayrollApprovalFailpoint('reject_after_run_update');

  await writeFinancialAudit(client, {
    userId: input.userId,
    action: 'payroll_run.review_rejected',
    entityType: 'payroll_run',
    entityId: run.id,
    newValues: {
      approval_cycle: cycle,
      rejected_snapshot_hash: hash,
      action_id: action.id,
      request_key_masked: keyMasked,
    },
    description: `رفض مراجعة تشغيل رواتب ${next.run_number}`,
  });

  return {
    run: serializePayrollRun(next),
    action: serializeAction(action),
    idempotent_replay: false,
  };
}
