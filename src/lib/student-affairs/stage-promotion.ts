/**
 * ترحيل الطلبة بين المراحل الأكاديمية مع فحص اكتمال ملف السنة المالية.
 */
import 'server-only';

import { query } from '@/src/lib/db';
import { logAuditDirect } from '@/src/lib/audit';
import {
  buildYearLedger,
  type FeeYear,
  type SettlementHistoryRow,
} from '@/app/accounts/students/lib/settlementYearLedger';
import { expectedAnnualFee } from '@/app/accounts/students/lib/tuitionFees';

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

function normalizeStage(value: unknown): StageCode | null {
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
  const annual = expectedAnnualFee({
    major: student.major || '',
    study_type: student.study_type,
    admission_channel: student.admission_channel,
    discount_percentage: student.discount_percentage,
    final_fee_after_discount: student.final_fee_after_discount,
  });

  const receipts = await loadReceipts(student.id);
  const ledger = buildYearLedger(receipts, annual);
  const entry = ledger.years.find((y) => y.year === feeYear);
  const target = entry?.target ?? annual;
  const paid = entry?.paid ?? 0;
  const remaining = Math.max(0, target - paid);
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
