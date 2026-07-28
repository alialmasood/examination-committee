import { NextRequest, NextResponse } from 'next/server';
import {
  isSaAuthFailure,
  requireStudentAffairsAccess,
} from '@/src/lib/student-affairs/auth';
import {
  processPromotionBatch,
  type StageCode,
} from '@/src/lib/student-affairs/stage-promotion';

const STAGES = new Set(['first', 'second', 'third', 'fourth']);

export async function POST(request: NextRequest) {
  const auth = await requireStudentAffairsAccess(request);
  if (isSaAuthFailure(auth)) return auth.response;

  try {
    const body = await request.json();
    const studentIds = Array.isArray(body.studentIds)
      ? body.studentIds.map((id: unknown) => String(id)).filter(Boolean)
      : [];
    const stage = String(body.stage || '')
      .trim()
      .toLowerCase() as StageCode;
    const year = body.year ? String(body.year).trim() : null;
    const department = body.department ? String(body.department).trim() : null;

    if (!studentIds.length) {
      return NextResponse.json(
        { success: false, error: 'يجب تحديد طالب واحد على الأقل' },
        { status: 400 }
      );
    }
    if (!STAGES.has(stage)) {
      return NextResponse.json(
        { success: false, error: 'المرحلة غير صالحة' },
        { status: 400 }
      );
    }
    if (stage === 'fourth') {
      return NextResponse.json(
        { success: false, error: 'لا يمكن ترحيل طلبة المرحلة الرابعة' },
        { status: 400 }
      );
    }

    const result = await processPromotionBatch({
      studentIds,
      expectedStage: stage,
      academicYear: year,
      department,
      actor: auth.actor,
    });

    const messageParts: string[] = [];
    if (result.promoted.length) {
      messageParts.push(`تم ترحيل ${result.promoted.length} طالب`);
    }
    if (result.requested.length) {
      messageParts.push(
        `أُرسل ${result.requested.length} طلب موافقة إلى الحسابات (بذمة غير مسددة)`
      );
    }
    if (result.skipped.length) {
      messageParts.push(`تم تخطي ${result.skipped.length}`);
    }

    return NextResponse.json({
      success: true,
      message: messageParts.join(' · ') || 'لا توجد عمليات',
      result,
    });
  } catch (error) {
    console.error('promotions/promote:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر تنفيذ الترحيل' },
      { status: 500 }
    );
  }
}
