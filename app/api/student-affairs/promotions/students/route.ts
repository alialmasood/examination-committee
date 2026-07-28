import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import {
  isSaAuthFailure,
  requireStudentAffairsAccess,
} from '@/src/lib/student-affairs/auth';
import {
  STAGE_LABELS,
  getStudentFeeCompletion,
  type StageCode,
} from '@/src/lib/student-affairs/stage-promotion';

const STAGES = new Set(['first', 'second', 'third', 'fourth']);

export async function GET(request: NextRequest) {
  const auth = await requireStudentAffairsAccess(request);
  if (isSaAuthFailure(auth)) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const year = (searchParams.get('year') || '').trim();
    const department = (searchParams.get('department') || '').trim();
    const stage = (searchParams.get('stage') || '').trim().toLowerCase() as StageCode;

    if (!year || !department || !STAGES.has(stage)) {
      return NextResponse.json(
        { success: false, error: 'year و department و stage مطلوبة' },
        { status: 400 }
      );
    }

    const studentsRes = await query(
      `SELECT id, university_id, full_name_ar, full_name, nickname,
              major, admission_type, study_type, admission_channel,
              discount_percentage, final_fee_after_discount, academic_year
       FROM student_affairs.students
       WHERE academic_year = $1
         AND normalize_arabic(COALESCE(major, '')) = normalize_arabic($2)
         AND (
           LOWER(COALESCE(NULLIF(admission_type, ''), 'first')) = $3
           OR (
             $3 = 'first'
             AND LOWER(COALESCE(admission_type, '')) IN ('', 'first', 'regular', 'conditional')
           )
         )
       ORDER BY COALESCE(full_name_ar, full_name) ASC`,
      [year, department, stage]
    );

    const morning: Array<Record<string, unknown>> = [];
    const evening: Array<Record<string, unknown>> = [];

    for (const student of studentsRes.rows) {
      const payment = await getStudentFeeCompletion(student);
      if (!payment) continue;

      const item = {
        id: student.id,
        universityId: student.university_id,
        fullName: student.full_name_ar || student.full_name || '',
        nickname: student.nickname || '',
        studyType: student.study_type === 'evening' ? 'evening' : 'morning',
        stage: payment.stage,
        stageLabel: STAGE_LABELS[payment.stage],
        nextStage: payment.nextStage,
        nextStageLabel: payment.nextStage ? STAGE_LABELS[payment.nextStage] : null,
        feeYear: payment.feeYear,
        remaining: payment.remaining,
        paid: payment.paid,
        target: payment.target,
        isComplete: payment.isComplete,
        canPromote: payment.canPromote,
        pendingRequestId: payment.pendingRequestId,
      };

      if (item.studyType === 'evening') evening.push(item);
      else morning.push(item);
    }

    return NextResponse.json({
      success: true,
      year,
      department,
      stage,
      stageLabel: STAGE_LABELS[stage],
      morning,
      evening,
    });
  } catch (error) {
    console.error('promotions/students:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر جلب طلبة الترحيل' },
      { status: 500 }
    );
  }
}
