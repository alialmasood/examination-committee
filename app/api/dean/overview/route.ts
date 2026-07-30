import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import { isDeanUsername } from '@/src/lib/dean';
import { buildStudentsFinanceSummary } from '@/src/lib/accounts/students-finance-summary';
import { normalizeDeptKey } from '@/app/accounts/students/lib/tuitionFees';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function requireDean(request: NextRequest) {
  const accessToken = request.cookies.get('access_token')?.value;
  if (!accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, message: 'غير مصرح' }, { status: 401 }),
    };
  }
  const payload = verifyAccessToken(accessToken);
  if (!payload) {
    return {
      ok: false as const,
      response: NextResponse.json({ success: false, message: 'جلسة منتهية' }, { status: 401 }),
    };
  }
  const user = await validateUser(payload.user_id);
  if (!user || !isDeanUsername(user.username)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, message: 'هذه الصفحة مخصصة للسيد العميد فقط' },
        { status: 403 }
      ),
    };
  }
  return { ok: true as const, user };
}

/**
 * GET /api/dean/overview
 * نظرة عامة حقيقية: إحصائيات الطلبة من قاعدة البيانات + المالية من وصولات التسديد.
 */
export async function GET(request: NextRequest) {
  const auth = await requireDean(request);
  if (!auth.ok) return auth.response;

  try {
    const columnsRes = await query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'student_affairs' AND table_name = 'students'`
    );
    const cols = new Set(
      columnsRes.rows.map((r: { column_name: string }) => r.column_name)
    );
    const col = (name: string, fallback: string) =>
      cols.has(name) ? `s.${name}` : fallback;

    const [finance, studentsRes, latestRes] = await Promise.all([
      buildStudentsFinanceSummary(),
      query(
        `SELECT
           s.id,
           COALESCE(s.major, '') AS major,
           ${col('study_type', 'NULL')} AS study_type,
           ${col('admission_type', 'NULL')} AS admission_type,
           ${col('academic_status', 'NULL')} AS academic_status,
           s.created_at
         FROM student_affairs.students s`
      ),
      (async () => {
        const nameCol = cols.has('full_name_ar')
          ? `COALESCE(NULLIF(TRIM(s.full_name_ar), ''), NULLIF(TRIM(${cols.has('full_name') ? 's.full_name' : "''"}), ''), 'بدون اسم')`
          : cols.has('full_name')
            ? `COALESCE(NULLIF(TRIM(s.full_name), ''), 'بدون اسم')`
            : `'بدون اسم'`;
        return query(
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
      })(),
    ]);

    const students = studentsRes.rows as Array<{
      id: string;
      major: string;
      study_type: string | null;
      admission_type: string | null;
      academic_status: string | null;
      created_at: string | null;
    }>;

    let morning = 0;
    let evening = 0;
    let firstYear = 0;
    let newLast7 = 0;
    let newLast30 = 0;
    const now = Date.now();
    const d7 = now - 7 * 24 * 60 * 60 * 1000;
    const d30 = now - 30 * 24 * 60 * 60 * 1000;
    const statusCounts = new Map<string, number>();
    const deptCounts = new Map<
      string,
      { name: string; students: number; morning: number; evening: number }
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

      const deptName = row.major.trim() || 'غير محدد';
      const key = normalizeDeptKey(deptName) || 'unknown';
      let dept = deptCounts.get(key);
      if (!dept) {
        dept = { name: deptName, students: 0, morning: 0, evening: 0 };
        deptCounts.set(key, dept);
      }
      dept.students += 1;
      if (isEvening) dept.evening += 1;
      else dept.morning += 1;
    }

    const financeByDept = new Map(
      finance.departments.map((d) => [normalizeDeptKey(d.name) || d.id, d])
    );

    const departments = Array.from(deptCounts.entries())
      .map(([key, d]) => {
        const fin = financeByDept.get(key);
        return {
          name: d.name,
          students: d.students,
          morning: d.morning,
          evening: d.evening,
          collected: fin?.collected_amount ?? 0,
          debt: fin?.debt_amount ?? 0,
        };
      })
      .sort((a, b) => b.students - a.students);

    // أقسام موجودة في الملخص المالي ولم تظهر في العدّ (احتياط)
    for (const fin of finance.departments) {
      const key = normalizeDeptKey(fin.name) || fin.id;
      if (deptCounts.has(key)) continue;
      departments.push({
        name: fin.name,
        students: fin.students,
        morning: fin.morning,
        evening: fin.evening,
        collected: fin.collected_amount,
        debt: fin.debt_amount,
      });
    }

    const academicStatuses = Array.from(statusCounts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    const activeStudents = statusCounts.get('مستمر') || 0;

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
          collected_amount: finance.collected_amount,
          expected_annual_total: finance.expected_annual_total,
          debt_amount: finance.debt_amount,
          collection_rate_percent: finance.collection_rate_percent,
          fully_paid_count: finance.fully_paid_count,
          partial_paid_count: finance.partial_paid_count,
          unpaid_count: finance.unpaid_count,
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
