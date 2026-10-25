/**
 * ترحيل الطلبة بين المراحل الأكاديمية مع فحص اكتمال ملف السنة المالية.
 */
import 'server-only';

import { query } from '@/src/lib/db';
import { logAuditDirect } from '@/src/lib/audit';
import {
  withTransaction,
  txQuery,
} from '@/src/lib/accounts/with-transaction';
import {
  buildYearLedger,
  type FeeYear,
  type SettlementHistoryRow,
} from '@/app/accounts/students/lib/settlementYearLedger';
import {
  expectedAnnualFee,
  getTuitionFeesByYear,
} from '@/app/accounts/students/lib/tuitionFees';
import { loadTuitionFeeMap } from '@/src/lib/accounts/department-tuition-fees';
import { loadClearedFeeYearsForStudent } from '@/src/lib/accounts/promotion-cleared-years';

export type StageCode = 'first' | 'second' | 'third' | 'fourth';

export const STAGE_ORDER: StageCode[] = ['first', 'second', 'third', 'fourth'];

export const STAGE_LABELS: Record<StageCode, string> = {
  first: 'الأولى',
  second: 'الثانية',
  third: 'الثالثة',
  fourth: 'الرابعة',
};

export type ActorInfo = {
  userId: string;
  username: string;
  fullName?: string | null;
  ipAddress?: string;
  userAgent?: string;
};

export type StudentPaymentStatus = {
  studentId: string;
  stage: StageCode;
  feeYear: FeeYear;
  target: number;
  paid: number;
  remaining: number;
  isComplete: boolean;
  canPromote: boolean;
  nextStage: StageCode | null;
  pendingRequestId: string | null;
};

export function normalizeStage(value: unknown): StageCode | null {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (raw === 'first' || raw === '1' || raw === 'stage1') return 'first';
  if (raw === 'second' || raw === '2' || raw === 'stage2') return 'second';
  if (raw === 'third' || raw === '3' || raw === 'stage3') return 'third';
  if (raw === 'fourth' || raw === '4' || raw === 'stage4') return 'fourth';
  if (raw === 'regular' || raw === 'conditional') return 'first';
  return null;
}

export function stageRank(stage: StageCode): number {
  return STAGE_ORDER.indexOf(stage);
}

/** المراحل الأقدم من المرحلة الحالية (للإرجاع). */
export function earlierStages(current: StageCode): StageCode[] {
  const idx = stageRank(current);
  if (idx <= 0) return [];
  return STAGE_ORDER.slice(0, idx);
}

export type PromotionEventKind = 'direct' | 'approved_request' | 'revert';

export type PromotionHistoryItem = {
  id: string;
  source: 'event' | 'request';
  kind: PromotionEventKind | 'approved' | 'reverted' | 'pending' | 'rejected';
  fromStage: StageCode | null;
  toStage: StageCode | null;
  feeYear: number | null;
  targetStage: StageCode | null;
  clearedFeeYearsRevoked: number[];
  requestId: string | null;
  actorUsername: string | null;
  notes: string | null;
  createdAt: string;
};

export type HigherYearReceiptWarning = {
  feeYear: number;
  receiptCount: number;
  totalPaid: number;
};

export function stageToFeeYear(stage: StageCode): FeeYear {
  switch (stage) {
    case 'first':
      return 1;
    case 'second':
      return 2;
    case 'third':
      return 3;
    case 'fourth':
      return 4;
  }
}

export function nextStage(stage: StageCode): StageCode | null {
  if (stage === 'first') return 'second';
  if (stage === 'second') return 'third';
  if (stage === 'third') return 'fourth';
  return null;
}

export function stageLabel(stage: string | null | undefined): string {
  const n = normalizeStage(stage);
  return n ? STAGE_LABELS[n] : stage || 'غير محدد';
}

async function loadReceipts(studentId: string): Promise<SettlementHistoryRow[]> {
  const result = await query(
    `SELECT id, receipt_number, fee_year, pay_amount, after_discount,
            remaining_amount, annual_fee, discount_mode, discount_input,
            discount_amount, discount_channel, discount_fee_years, periods,
            settlement_date, created_at
     FROM accounts.student_settlement_receipts
     WHERE student_id = $1
     ORDER BY COALESCE(fee_year, 1) ASC, settlement_date ASC, created_at ASC`,
    [studentId]
  );
  return result.rows as SettlementHistoryRow[];
}

export async function getStudentFeeCompletion(
  student: {
    id: string;
    admission_type?: string | null;
    major?: string | null;
    study_type?: string | null;
    admission_channel?: string | null;
    discount_percentage?: number | null;
    final_fee_after_discount?: number | null;
  }
): Promise<StudentPaymentStatus | null> {
  const stage = normalizeStage(student.admission_type) || 'first';
  const feeYear = stageToFeeYear(stage);
  const next = nextStage(stage);
  const feeMap = await loadTuitionFeeMap();
  const feesByYear = getTuitionFeesByYear(
    student.major || '',
    student.study_type,
    feeMap
  );
  const annual = expectedAnnualFee(
    {
      major: student.major || '',
      study_type: student.study_type,
      admission_channel: student.admission_channel,
      discount_percentage: student.discount_percentage,
      final_fee_after_discount: student.final_fee_after_discount,
    },
    feeMap,
    feeYear
  );

  const receipts = await loadReceipts(student.id);
  const clearedFeeYears = await loadClearedFeeYearsForStudent(student.id);
  const ledger = buildYearLedger(receipts, feesByYear, { clearedFeeYears });
  const entry = ledger.years.find((y) => y.year === feeYear);
  const target = entry?.target ?? annual;
  const paid = entry?.paid ?? 0;
  const remaining = Math.max(0, entry?.remaining ?? Math.max(0, target - paid));
  const isComplete = remaining <= 0.01;

  const pending = await query(
    `SELECT id FROM student_affairs.stage_promotion_requests
     WHERE student_id = $1 AND status = 'pending'
     LIMIT 1`,
    [student.id]
  );

  return {
    studentId: student.id,
    stage,
    feeYear,
    target,
    paid,
    remaining,
    isComplete,
    canPromote: Boolean(next),
    nextStage: next,
    pendingRequestId: pending.rows[0]?.id || null,
  };
}

export async function promoteStudentStage(
  studentId: string,
  expectedFromStage: StageCode,
  actor: ActorInfo,
  options?: { viaApprovalRequestId?: string; note?: string }
): Promise<{ success: true; from: StageCode; to: StageCode } | { success: false; error: string }> {
  const next = nextStage(expectedFromStage);
  if (!next) {
    return { success: false, error: 'لا يمكن ترحيل طلبة المرحلة الرابعة' };
  }

  const current = await query(
    `SELECT id, full_name_ar, full_name, admission_type, major, academic_year
     FROM student_affairs.students WHERE id = $1`,
    [studentId]
  );
  const row = current.rows[0];
  if (!row) return { success: false, error: 'الطالب غير موجود' };

  const currentStage = normalizeStage(row.admission_type) || 'first';
  if (currentStage !== expectedFromStage) {
    return {
      success: false,
      error: `مرحلة الطالب الحالية (${stageLabel(currentStage)}) لا تطابق المرحلة المتوقعة`,
    };
  }
  if (currentStage === 'fourth') {
    return { success: false, error: 'لا يمكن ترحيل طلبة المرحلة الرابعة' };
  }

  const updated = await query(
    `UPDATE student_affairs.students
     SET admission_type = $1, updated_at = NOW()
     WHERE id = $2
       AND (
         LOWER(COALESCE(NULLIF(admission_type, ''), 'first')) = $3
         OR (
           $3 = 'first'
           AND LOWER(COALESCE(admission_type, '')) IN ('', 'first', 'regular', 'conditional')
         )
       )
     RETURNING id`,
    [next, studentId, expectedFromStage]
  );
  if (!updated.rows[0]) {
    return { success: false, error: 'تعذر تحديث مرحلة الطالب (ربما تغيّرت المرحلة)' };
  }

  const kind: PromotionEventKind = options?.viaApprovalRequestId
    ? 'approved_request'
    : 'direct';
  const feeYear = stageToFeeYear(expectedFromStage);

  try {
    await query(
      `INSERT INTO student_affairs.stage_promotion_events (
         student_id, from_stage, to_stage, fee_year, kind, request_id,
         actor_user_id, actor_username, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        studentId,
        expectedFromStage,
        next,
        feeYear,
        kind,
        options?.viaApprovalRequestId || null,
        actor.userId,
        actor.username,
        options?.note || null,
      ]
    );
  } catch (error) {
    console.warn('stage_promotion_events insert:', error);
  }

  await logAuditDirect({
    user_id: actor.userId,
    username: actor.username,
    full_name: actor.fullName || null,
    action_type: 'stage_promote',
    entity_type: 'student',
    entity_id: studentId,
    entity_name: row.full_name_ar || row.full_name || undefined,
    description: options?.viaApprovalRequestId
      ? `ترحيل المرحلة بعد موافقة الحسابات من ${STAGE_LABELS[expectedFromStage]} إلى ${STAGE_LABELS[next]}`
      : `ترحيل المرحلة من ${STAGE_LABELS[expectedFromStage]} إلى ${STAGE_LABELS[next]}`,
    old_values: { admission_type: expectedFromStage },
    new_values: {
      admission_type: next,
      via_approval_request_id: options?.viaApprovalRequestId || null,
      note: options?.note || null,
    },
    ip_address: actor.ipAddress,
    user_agent: actor.userAgent,
  });

  return { success: true, from: expectedFromStage, to: next };
}

export async function createPromotionRequest(input: {
  studentId: string;
  fromStage: StageCode;
  toStage: StageCode;
  feeYear: FeeYear;
  remainingAmount: number;
  academicYear?: string | null;
  department?: string | null;
  notes?: string | null;
  actor: ActorInfo;
}): Promise<{ success: true; requestId: string } | { success: false; error: string }> {
  const existing = await query(
    `SELECT id FROM student_affairs.stage_promotion_requests
     WHERE student_id = $1 AND status = 'pending' LIMIT 1`,
    [input.studentId]
  );
  if (existing.rows[0]) {
    return { success: false, error: 'يوجد طلب ترحيل معلّق لهذا الطالب مسبقاً' };
  }

  const inserted = await query(
    `INSERT INTO student_affairs.stage_promotion_requests (
       student_id, from_stage, to_stage, fee_year, remaining_amount,
       academic_year, department, status, requested_by, requested_by_username, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10)
     RETURNING id`,
    [
      input.studentId,
      input.fromStage,
      input.toStage,
      input.feeYear,
      input.remainingAmount,
      input.academicYear || null,
      input.department || null,
      input.actor.userId,
      input.actor.username,
      input.notes || null,
    ]
  );

  const requestId = inserted.rows[0].id as string;

  await logAuditDirect({
    user_id: input.actor.userId,
    username: input.actor.username,
    full_name: input.actor.fullName || null,
    action_type: 'stage_promote_request',
    entity_type: 'stage_promotion_request',
    entity_id: requestId,
    entity_name: input.studentId,
    description: `طلب ترحيل مرحلة للطالب بسبب متبقٍ مالي (${input.remainingAmount})`,
    new_values: {
      student_id: input.studentId,
      from_stage: input.fromStage,
      to_stage: input.toStage,
      remaining_amount: input.remainingAmount,
    },
    ip_address: input.actor.ipAddress,
    user_agent: input.actor.userAgent,
  });

  return { success: true, requestId };
}

export type PromoteBatchResult = {
  promoted: string[];
  requested: string[];
  skipped: Array<{ studentId: string; reason: string }>;
};

export async function processPromotionBatch(input: {
  studentIds: string[];
  expectedStage: StageCode;
  academicYear?: string | null;
  department?: string | null;
  actor: ActorInfo;
}): Promise<PromoteBatchResult> {
  const result: PromoteBatchResult = {
    promoted: [],
    requested: [],
    skipped: [],
  };

  const next = nextStage(input.expectedStage);
  if (!next) {
    for (const id of input.studentIds) {
      result.skipped.push({ studentId: id, reason: 'لا يمكن ترحيل المرحلة الرابعة' });
    }
    return result;
  }

  for (const studentId of input.studentIds) {
    const studentRes = await query(
      `SELECT id, admission_type, major, study_type, admission_channel,
              discount_percentage, final_fee_after_discount, academic_year, full_name_ar
       FROM student_affairs.students WHERE id = $1`,
      [studentId]
    );
    const student = studentRes.rows[0];
    if (!student) {
      result.skipped.push({ studentId, reason: 'الطالب غير موجود' });
      continue;
    }

    const stage = normalizeStage(student.admission_type) || 'first';
    if (stage !== input.expectedStage) {
      result.skipped.push({
        studentId,
        reason: `المرحلة الحالية (${stageLabel(stage)}) لا تطابق القائمة`,
      });
      continue;
    }

    const payment = await getStudentFeeCompletion(student);
    if (!payment) {
      result.skipped.push({ studentId, reason: 'تعذر فحص حالة الدفع' });
      continue;
    }

    if (payment.pendingRequestId) {
      result.skipped.push({ studentId, reason: 'يوجد طلب ترحيل معلّق لدى الحسابات' });
      continue;
    }

    if (payment.isComplete) {
      const promoted = await promoteStudentStage(studentId, input.expectedStage, input.actor);
      if (promoted.success) {
        result.promoted.push(studentId);
      } else {
        result.skipped.push({ studentId, reason: promoted.error });
      }
      continue;
    }

    const req = await createPromotionRequest({
      studentId,
      fromStage: input.expectedStage,
      toStage: next,
      feeYear: payment.feeYear,
      remainingAmount: payment.remaining,
      academicYear: input.academicYear || student.academic_year,
      department: input.department || student.major,
      notes: 'طلب ترحيل من شؤون الطلبة — الطالب بذمته مبلغ غير مسدد',
      actor: input.actor,
    });

    if (req.success) {
      result.requested.push(studentId);
    } else {
      result.skipped.push({ studentId, reason: req.error });
    }
  }

  return result;
}

export async function reviewPromotionRequest(input: {
  requestId: string;
  action: 'approve' | 'reject';
  reviewNotes?: string | null;
  actor: ActorInfo;
}): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const reqRes = await query(
    `SELECT * FROM student_affairs.stage_promotion_requests WHERE id = $1`,
    [input.requestId]
  );
  const req = reqRes.rows[0];
  if (!req) return { success: false, error: 'الطلب غير موجود' };
  if (req.status !== 'pending') {
    return { success: false, error: 'الطلب ليس في حالة الانتظار' };
  }

  const fromStage = normalizeStage(req.from_stage);
  if (!fromStage) return { success: false, error: 'مرحلة الطلب غير صالحة' };

  if (input.action === 'reject') {
    await query(
      `UPDATE student_affairs.stage_promotion_requests
       SET status = 'rejected',
           reviewed_by = $1,
           reviewed_by_username = $2,
           review_notes = $3,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [
        input.actor.userId,
        input.actor.username,
        input.reviewNotes || null,
        input.requestId,
      ]
    );

    await logAuditDirect({
      user_id: input.actor.userId,
      username: input.actor.username,
      full_name: input.actor.fullName || null,
      action_type: 'stage_promote_reject',
      entity_type: 'stage_promotion_request',
      entity_id: input.requestId,
      description: 'رفض طلب ترحيل مرحلة من نظام الحسابات',
      new_values: { review_notes: input.reviewNotes || null },
      ip_address: input.actor.ipAddress,
      user_agent: input.actor.userAgent,
    });

    return { success: true, message: 'تم رفض طلب الترحيل' };
  }

  const promoted = await promoteStudentStage(req.student_id, fromStage, input.actor, {
    viaApprovalRequestId: input.requestId,
    note: input.reviewNotes || undefined,
  });

  if (!promoted.success) {
    return { success: false, error: promoted.error };
  }

  await query(
    `UPDATE student_affairs.stage_promotion_requests
     SET status = 'approved',
         reviewed_by = $1,
         reviewed_by_username = $2,
         review_notes = $3,
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE id = $4`,
    [
      input.actor.userId,
      input.actor.username,
      input.reviewNotes || null,
      input.requestId,
    ]
  );

  return { success: true, message: 'تمت الموافقة وترحيل الطالب للمرحلة التالية' };
}

export async function countPendingPromotionRequests(): Promise<number> {
  try {
    const result = await query(
      `SELECT COUNT(*)::int AS n
       FROM student_affairs.stage_promotion_requests
       WHERE status = 'pending'`
    );
    return Number(result.rows[0]?.n || 0);
  } catch {
    return 0;
  }
}

export async function loadHigherYearReceiptWarnings(
  studentId: string,
  targetStage: StageCode
): Promise<HigherYearReceiptWarning[]> {
  const maxKeepYear = stageToFeeYear(targetStage);
  const result = await query(
    `SELECT COALESCE(fee_year, 1)::int AS fee_year,
            COUNT(*)::int AS receipt_count,
            COALESCE(SUM(pay_amount), 0)::float AS total_paid
     FROM accounts.student_settlement_receipts
     WHERE student_id = $1
       AND COALESCE(fee_year, 1) > $2
     GROUP BY COALESCE(fee_year, 1)
     ORDER BY 1`,
    [studentId, maxKeepYear]
  );
  return result.rows.map((r) => ({
    feeYear: Number(r.fee_year),
    receiptCount: Number(r.receipt_count || 0),
    totalPaid: Number(r.total_paid || 0),
  }));
}

export async function getStudentPromotionHistory(
  studentId: string
): Promise<{
  student: {
    id: string;
    fullName: string;
    universityId: string;
    department: string;
    academicYear: string | null;
    currentStage: StageCode;
    currentStageLabel: string;
  };
  history: PromotionHistoryItem[];
  availableTargets: Array<{ stage: StageCode; label: string; feeYear: FeeYear }>;
} | null> {
  const studentRes = await query(
    `SELECT id, full_name_ar, full_name, university_id, major, academic_year, admission_type
     FROM student_affairs.students WHERE id = $1`,
    [studentId]
  );
  const row = studentRes.rows[0];
  if (!row) return null;

  const currentStage = normalizeStage(row.admission_type) || 'first';
  const history: PromotionHistoryItem[] = [];

  try {
    const events = await query(
      `SELECT id, from_stage, to_stage, fee_year, kind, request_id, target_stage,
              cleared_fee_years_revoked, actor_username, notes, created_at
       FROM student_affairs.stage_promotion_events
       WHERE student_id = $1
       ORDER BY created_at ASC`,
      [studentId]
    );
    for (const e of events.rows) {
      const revoked = Array.isArray(e.cleared_fee_years_revoked)
        ? e.cleared_fee_years_revoked.map((n: unknown) => Number(n)).filter(Boolean)
        : [];
      history.push({
        id: String(e.id),
        source: 'event',
        kind: e.kind as PromotionEventKind,
        fromStage: normalizeStage(e.from_stage),
        toStage: normalizeStage(e.to_stage),
        feeYear: e.fee_year != null ? Number(e.fee_year) : null,
        targetStage: normalizeStage(e.target_stage),
        clearedFeeYearsRevoked: revoked,
        requestId: e.request_id ? String(e.request_id) : null,
        actorUsername: e.actor_username || null,
        notes: e.notes || null,
        createdAt: e.created_at,
      });
    }
  } catch (error) {
    console.warn('getStudentPromotionHistory events:', error);
  }

  const requests = await query(
    `SELECT id, from_stage, to_stage, fee_year, status,
            reviewed_by_username, requested_by_username, notes, review_notes,
            COALESCE(reviewed_at, created_at) AS created_at
     FROM student_affairs.stage_promotion_requests
     WHERE student_id = $1
       AND status IN ('approved', 'reverted', 'rejected', 'pending')
     ORDER BY created_at ASC`,
    [studentId]
  );

  const eventRequestIds = new Set(
    history.map((h) => h.requestId).filter(Boolean) as string[]
  );

  for (const r of requests.rows) {
    const rid = String(r.id);
    // لا نكرر الطلبات المعتمدة التي سُجّل لها حدث ترحيل
    if (r.status === 'approved' && eventRequestIds.has(rid)) continue;
    history.push({
      id: `req-${rid}`,
      source: 'request',
      kind: r.status as PromotionHistoryItem['kind'],
      fromStage: normalizeStage(r.from_stage),
      toStage: normalizeStage(r.to_stage),
      feeYear: r.fee_year != null ? Number(r.fee_year) : null,
      targetStage: null,
      clearedFeeYearsRevoked: [],
      requestId: rid,
      actorUsername:
        r.reviewed_by_username || r.requested_by_username || null,
      notes: r.review_notes || r.notes || null,
      createdAt: r.created_at,
    });
  }

  history.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const availableTargets = earlierStages(currentStage).map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    feeYear: stageToFeeYear(stage),
  }));

  return {
    student: {
      id: String(row.id),
      fullName: row.full_name_ar || row.full_name || '',
      universityId: row.university_id || '',
      department: row.major || '',
      academicYear: row.academic_year || null,
      currentStage,
      currentStageLabel: STAGE_LABELS[currentStage],
    },
    history,
    availableTargets,
  };
}

export async function searchStudentsForPromotionRevert(
  q: string
): Promise<
  Array<{
    id: string;
    fullName: string;
    universityId: string;
    department: string;
    currentStage: StageCode;
    currentStageLabel: string;
  }>
> {
  const term = q.trim();
  if (!term) return [];

  const result = await query(
    `SELECT id, full_name_ar, full_name, university_id, major, admission_type
     FROM student_affairs.students
     WHERE university_id ILIKE '%'||$1||'%'
        OR full_name_ar ILIKE '%'||$1||'%'
        OR full_name ILIKE '%'||$1||'%'
     ORDER BY university_id ASC
     LIMIT 25`,
    [term]
  );

  return result.rows.map((r) => {
    const stage = normalizeStage(r.admission_type) || 'first';
    return {
      id: String(r.id),
      fullName: r.full_name_ar || r.full_name || '',
      universityId: r.university_id || '',
      department: r.major || '',
      currentStage: stage,
      currentStageLabel: STAGE_LABELS[stage],
    };
  });
}

export async function revertStudentStage(input: {
  studentId: string;
  targetStage: StageCode;
  actor: ActorInfo;
  notes?: string | null;
}): Promise<
  | {
      success: true;
      message: string;
      fromStage: StageCode;
      toStage: StageCode;
      revokedFeeYears: FeeYear[];
      receiptWarnings: HigherYearReceiptWarning[];
    }
  | { success: false; error: string }
> {
  const studentRes = await query(
    `SELECT id, full_name_ar, full_name, admission_type
     FROM student_affairs.students WHERE id = $1`,
    [input.studentId]
  );
  const row = studentRes.rows[0];
  if (!row) return { success: false, error: 'الطالب غير موجود' };

  const currentStage = normalizeStage(row.admission_type) || 'first';
  if (stageRank(input.targetStage) >= stageRank(currentStage)) {
    return {
      success: false,
      error: 'يجب اختيار مرحلة أقدم من المرحلة الحالية',
    };
  }

  const receiptWarnings = await loadHigherYearReceiptWarnings(
    input.studentId,
    input.targetStage
  );
  const minRevokeYear = stageToFeeYear(input.targetStage);

  try {
    const result = await withTransaction(async (client) => {
      const updated = await txQuery(
        client,
        `UPDATE student_affairs.students
         SET admission_type = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, admission_type`,
        [input.targetStage, input.studentId]
      );
      if (!updated.rows[0]) {
        throw new Error('تعذر تحديث مرحلة الطالب');
      }

      const revoked = await txQuery<{ fee_year: number; id: string }>(
        client,
        `UPDATE student_affairs.stage_promotion_requests
         SET status = 'reverted',
             updated_at = NOW(),
             review_notes = CASE
               WHEN review_notes IS NULL OR BTRIM(review_notes) = '' THEN $3
               ELSE review_notes || E'\n' || $3
             END
         WHERE student_id = $1
           AND status = 'approved'
           AND fee_year >= $2
         RETURNING id, fee_year`,
        [
          input.studentId,
          minRevokeYear,
          `أُلغي الاجتياز بإرجاع المرحلة إلى ${STAGE_LABELS[input.targetStage]}`,
        ]
      );

      const revokedFeeYears = [
        ...new Set(
          revoked.rows
            .map((r) => Number(r.fee_year) as FeeYear)
            .filter((y): y is FeeYear => y === 1 || y === 2 || y === 3 || y === 4)
        ),
      ].sort((a, b) => a - b);

      // إلغاء أي طلب معلّق لتجنب تعارض بعد الإرجاع
      await txQuery(
        client,
        `UPDATE student_affairs.stage_promotion_requests
         SET status = 'cancelled', updated_at = NOW()
         WHERE student_id = $1 AND status = 'pending'`,
        [input.studentId]
      );

      await txQuery(
        client,
        `INSERT INTO student_affairs.stage_promotion_events (
           student_id, from_stage, to_stage, fee_year, kind, target_stage,
           cleared_fee_years_revoked, actor_user_id, actor_username, notes
         ) VALUES ($1,$2,$3,$4,'revert',$5,$6,$7,$8,$9)`,
        [
          input.studentId,
          currentStage,
          input.targetStage,
          minRevokeYear,
          input.targetStage,
          revokedFeeYears,
          input.actor.userId,
          input.actor.username,
          input.notes || null,
        ]
      );

      return { revokedFeeYears };
    });

    await logAuditDirect({
      user_id: input.actor.userId,
      username: input.actor.username,
      full_name: input.actor.fullName || null,
      action_type: 'stage_promote_revert',
      entity_type: 'student',
      entity_id: input.studentId,
      entity_name: row.full_name_ar || row.full_name || undefined,
      description: `إرجاع مرحلة الطالب من ${STAGE_LABELS[currentStage]} إلى ${STAGE_LABELS[input.targetStage]}`,
      old_values: { admission_type: currentStage },
      new_values: {
        admission_type: input.targetStage,
        revoked_fee_years: result.revokedFeeYears,
        receipt_warnings: receiptWarnings,
        notes: input.notes || null,
      },
      ip_address: input.actor.ipAddress,
      user_agent: input.actor.userAgent,
    });

    const warnNote =
      receiptWarnings.length > 0
        ? ` — تنبيه: توجد وصولات على سنوات أعلى (${receiptWarnings
            .map((w) => `سنة ${w.feeYear}`)
            .join('، ')}) ولم تُحذف`
        : '';

    return {
      success: true,
      message: `تم إرجاع الطالب إلى المرحلة ${STAGE_LABELS[input.targetStage]}${warnNote}`,
      fromStage: currentStage,
      toStage: input.targetStage,
      revokedFeeYears: result.revokedFeeYears,
      receiptWarnings,
    };
  } catch (error) {
    console.error('revertStudentStage:', error);
    return { success: false, error: 'تعذر إرجاع مرحلة الطالب' };
  }
}
