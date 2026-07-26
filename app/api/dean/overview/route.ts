import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import { isDeanUsername } from '@/src/lib/dean';
import {
  expectedAnnualFee,
  normalizeDeptKey,
} from '@/app/accounts/students/lib/tuitionFees';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type StudentRow = {
  id: string;
  major: string;
  study_type: string | null;
  admission_type: string | null;
  admission_channel: string | null;
  academic_status: string | null;
  payment_amount: number;
  discount_percentage: number | null;
  final_fee_after_discount: number | null;
  created_at: string | null;
};

async function requireDean(request: NextRequest) {
  const accessToken = request.cookies.get('access_token')?.value;
  if (!accessToken) {
    return { ok: false as const, response: NextResponse.json({ success: false, message: 'غير مصرح' }, { status: 401 }) };
  }
  const payload = verifyAccessToken(accessToken);
  if (!payload) {
    return { ok: false as const, response: NextResponse.json({ success: false, message: 'جلسة منتهية' }, { status: 401 }) };
  }
  const user = await validateUser(payload.user_id);
  if (!user || !isDeanUsername(user.username)) {
    return { ok: false as const, response: NextResponse.json({ success: false, message: 'هذه الصفحة مخصصة للسيد العميد فقط' }, { status: 403 }) };
  }
  return { ok: true as const, user };
}

export async function GET(request: NextRequest) {
  const auth = await requireDean(request);
  if (!auth.ok) return auth.response;

  try {
    // معرفة الأعمدة المتوفرة فعلياً في جدول الطلبة لتجنب أخطاء البيئات المختلفة
    const columnsRes = await query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'student_affairs' AND table_name = 'students'`
    );
    const cols = new Set(columnsRes.rows.map((r: { column_name: string }) => r.column_name));
    const col = (name: string, fallback: string) =>
      cols.has(name) ? `s.${name}` : fallback;

    const studentsRes = await query(
      `SELECT
         s.id,
         COALESCE(s.major, '') AS major,
         ${col('study_type', 'NULL')} AS study_type,
         ${col('admission_type', 'NULL')} AS admission_type,
         ${col('admission_channel', 'NULL')} AS admission_channel,
         ${col('academic_status', 'NULL')} AS academic_status,
         COALESCE(${col('payment_amount', '0')}, 0)::float8 AS payment_amount,
         ${col('discount_percentage', 'NULL')}::float8 AS discount_percentage,
         ${col('final_fee_after_discount', 'NULL')}::float8 AS final_fee_after_discount,
         s.created_at
       FROM student_affairs.students s`
    );
    const students = studentsRes.rows as StudentRow[];

    let morning = 0;
    let evening = 0;
    let firstYear = 0;
    let collected = 0;
    let expectedAnnual = 0;
    let debt = 0;
    let fullyPaid = 0;
    let partialPaid = 0;
    let unpaid = 0;
    let newLast7 = 0;
    let newLast30 = 0;

    const now = Date.now();
    const d7 = now - 7 * 24 * 60 * 60 * 1000;
    const d30 = now - 30 * 24 * 60 * 60 * 1000;

    const statusCounts = new Map<string, number>();
    const deptMap = new Map<
      string,
      { name: string; students: number; morning: number; evening: number; collected: number; debt: number }
    >();

    for (const row of students) {
      const studyType = String(row.study_type || '').toLowerCase();
      const isEvening = studyType === 'evening' || studyType === 'مسائي';
      if (isEvening) evening += 1;
      else morning += 1;

      if (String(row.admission_type || '').toLowerCase() === 'first') firstYear += 1;

      const status = String(row.academic_status || '').trim() || 'غير محدد';
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1);

      const createdAt = Date.parse(String(row.created_at || ''));
      if (Number.isFinite(createdAt)) {
        if (createdAt >= d7) newLast7 += 1;
        if (createdAt >= d30) newLast30 += 1;
      }

      const expected = expectedAnnualFee({
        major: row.major,
        study_type: isEvening ? 'evening' : row.study_type,
        admission_channel: row.admission_channel,
        discount_percentage: row.discount_percentage,
        final_fee_after_discount: row.final_fee_after_discount,
      });
      const paid = Number(row.payment_amount || 0);
      const studentDebt = Math.max(0, expected - paid);

      collected += paid;
      expectedAnnual += expected;
      debt += studentDebt;

      if (studentDebt <= 0 && (expected > 0 || paid > 0)) fullyPaid += 1;
      else if (paid > 0 && studentDebt > 0) partialPaid += 1;
      else unpaid += 1;

      const deptName = row.major.trim() || 'غير محدد';
      const key = normalizeDeptKey(deptName) || 'unknown';
      let dept = deptMap.get(key);
      if (!dept) {
        dept = { name: deptName, students: 0, morning: 0, evening: 0, collected: 0, debt: 0 };
        deptMap.set(key, dept);
      }
      dept.students += 1;
      if (isEvening) dept.evening += 1;
      else dept.morning += 1;
      dept.collected += paid;
      dept.debt += studentDebt;
    }

    const activeStudents = statusCounts.get('مستمر') || 0;

    // آخر الطلبة المسجلين
    const nameCol = cols.has('full_name_ar')
      ? `COALESCE(NULLIF(TRIM(s.full_name_ar), ''), NULLIF(TRIM(${cols.has('full_name') ? 's.full_name' : "''"}), ''), 'بدون اسم')`
      : cols.has('full_name')
        ? `COALESCE(NULLIF(TRIM(s.full_name), ''), 'بدون اسم')`
        : `'بدون اسم'`;

    const latestRes = await query(
      `SELECT
         s.id,
         ${nameCol} AS student_name,
         COALESCE(s.major, 'غير محدد') AS major,
         ${col('study_type', 'NULL')} AS study_type,
         ${col('admission_type', 'NULL')} AS admission_type,
         s.created_at
       FROM student_affairs.students s
       ORDER BY s.created_at DESC NULLS LAST
       LIMIT 8`
    );

    const departments = Array.from(deptMap.values()).sort(
      (a, b) => b.students - a.students
    );

    const academicStatuses = Array.from(statusCounts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      success: true,
      data: {
        generated_at: new Date().toISOString(),
        students: {
          total: students.length,
          active: activeStudents,
          first_year: firstYear,
          morning,
          evening,
          new_last_7_days: newLast7,
          new_last_30_days: newLast30,
        },
        finance: {
          collected_amount: collected,
          expected_annual_total: expectedAnnual,
          debt_amount: debt,
          collection_rate_percent:
            expectedAnnual > 0 ? Math.round((collected / expectedAnnual) * 1000) / 10 : 0,
          fully_paid_count: fullyPaid,
          partial_paid_count: partialPaid,
          unpaid_count: unpaid,
        },
        departments,
        academic_statuses: academicStatuses,
        latest_students: latestRes.rows,
      },
    });
  } catch (error) {
    console.error('خطأ في بيانات مراقبة العميد:', error);
    return NextResponse.json(
      { success: false, message: 'تعذر تحميل بيانات المراقبة' },
      { status: 500 }
    );
  }
}
