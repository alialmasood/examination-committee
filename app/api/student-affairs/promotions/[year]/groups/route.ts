import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import {
  isSaAuthFailure,
  requireStudentAffairsAccess,
} from '@/src/lib/student-affairs/auth';
import {
  STAGE_LABELS,
  STAGE_ORDER,
  getStudentFeeCompletion,
  type StageCode,
} from '@/src/lib/student-affairs/stage-promotion';

type Params = { params: Promise<{ year: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireStudentAffairsAccess(request);
  if (isSaAuthFailure(auth)) return auth.response;

  try {
    const { year: rawYear } = await params;
    const year = decodeURIComponent(rawYear);

    const studentsRes = await query(
      `SELECT id, major, admission_type, study_type, admission_channel,
              discount_percentage, final_fee_after_discount
       FROM student_affairs.students
       WHERE academic_year = $1
         AND COALESCE(major, '') <> ''`,
      [year]
    );

    type GroupKey = string;
    const groups = new Map<
      GroupKey,
      {
        department: string;
        stage: StageCode;
        stageLabel: string;
        total: number;
        ready: number;
        owed: number;
        pending: number;
      }
    >();

    for (const student of studentsRes.rows) {
      const payment = await getStudentFeeCompletion(student);
      if (!payment) continue;

      const department = String(student.major || '').trim();
      const key = `${department}||${payment.stage}`;
      if (!groups.has(key)) {
        groups.set(key, {
          department,
          stage: payment.stage,
          stageLabel: STAGE_LABELS[payment.stage],
          total: 0,
          ready: 0,
          owed: 0,
          pending: 0,
        });
      }
      const g = groups.get(key)!;
      g.total += 1;
      if (payment.pendingRequestId) g.pending += 1;
      else if (payment.isComplete) g.ready += 1;
      else g.owed += 1;
    }

    const data = Array.from(groups.values()).sort((a, b) => {
      const deptCmp = a.department.localeCompare(b.department, 'ar');
      if (deptCmp !== 0) return deptCmp;
      return STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
    });

    return NextResponse.json({ success: true, year, data });
  } catch (error) {
    console.error('promotions/groups:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر جلب مجموعات الترحيل' },
      { status: 500 }
    );
  }
}
