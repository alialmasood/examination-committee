import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import { isGeneralSupervisionUsername } from '@/src/lib/general-supervision';
import { buildStudentsFinanceSummary } from '@/src/lib/accounts/students-finance-summary';
import { query } from '@/src/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function requireGeneralSupervision(request: NextRequest) {
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
  if (!user || !isGeneralSupervisionUsername(user.username)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, message: 'هذه الصفحة مخصصة للوحة الإشراف العامة فقط' },
        { status: 403 }
      ),
    };
  }
  return { ok: true as const, user };
}

/**
 * GET /api/general-supervision/overview
 * نظرة عامة مجمّعة للوحة التحكم (طلبة + حسابات).
 */
export async function GET(request: NextRequest) {
  const auth = await requireGeneralSupervision(request);
  if (!auth.ok) return auth.response;

  try {
    const academicYear =
      new URL(request.url).searchParams.get('academic_year') || '2025-2026';

    const [finance, totalRes, morningRes, eveningRes, firstRes, secondRes, thirdRes, fourthRes, channelsRes, yearsRes] =
      await Promise.all([
        buildStudentsFinanceSummary(),
        query(
          `SELECT COUNT(*)::int AS c FROM student_affairs.students WHERE academic_year = $1`,
          [academicYear]
        ),
        query(
          `SELECT COUNT(*)::int AS c FROM student_affairs.students
           WHERE academic_year = $1 AND COALESCE(study_type, 'morning') = 'morning'`,
          [academicYear]
        ),
        query(
          `SELECT COUNT(*)::int AS c FROM student_affairs.students
           WHERE academic_year = $1 AND study_type = 'evening'`,
          [academicYear]
        ),
        query(
          `SELECT COUNT(*)::int AS c FROM student_affairs.students
           WHERE academic_year = $1 AND admission_type = 'first'`,
          [academicYear]
        ),
        query(
          `SELECT COUNT(*)::int AS c FROM student_affairs.students
           WHERE academic_year = $1 AND admission_type = 'second'`,
          [academicYear]
        ),
        query(
          `SELECT COUNT(*)::int AS c FROM student_affairs.students
           WHERE academic_year = $1 AND admission_type = 'third'`,
          [academicYear]
        ),
        query(
          `SELECT COUNT(*)::int AS c FROM student_affairs.students
           WHERE academic_year = $1 AND admission_type = 'fourth'`,
          [academicYear]
        ),
        query(
          `SELECT
             COALESCE(NULLIF(TRIM(admission_channel), ''), 'general') AS channel,
             COUNT(*)::int AS count
           FROM student_affairs.students
           WHERE academic_year = $1
           GROUP BY COALESCE(NULLIF(TRIM(admission_channel), ''), 'general')
           ORDER BY count DESC
           LIMIT 6`,
          [academicYear]
        ).catch(() => ({ rows: [] as Array<{ channel: string; count: number }> })),
        query(
          `SELECT COUNT(*)::int AS c FROM student_affairs.students`
        ),
      ]);

    const CHANNEL_LABELS: Record<string, string> = {
      general: 'العامة',
      martyrs: 'ذوي الشهداء',
      social_care: 'الرعاية',
      special_needs: 'ذوي الهمم',
      political_prisoners: 'السجناء',
      top_students: 'الأوائل',
      siblings_married: 'الإخوة',
      health_ministry: 'الصحة',
      minister_directive: 'توجيهات الوزير',
      dean_approval: 'موافقة العميد',
      faculty_children: 'أبناء التدريسيين',
    };

    const students = {
      academic_year: academicYear,
      total: Number(totalRes.rows[0]?.c || 0),
      total_all_years: Number(yearsRes.rows[0]?.c || 0),
      morning: Number(morningRes.rows[0]?.c || 0),
      evening: Number(eveningRes.rows[0]?.c || 0),
      stages: [
        { key: 'first', label: 'أولى', count: Number(firstRes.rows[0]?.c || 0) },
        { key: 'second', label: 'ثانية', count: Number(secondRes.rows[0]?.c || 0) },
        { key: 'third', label: 'ثالثة', count: Number(thirdRes.rows[0]?.c || 0) },
        { key: 'fourth', label: 'رابعة', count: Number(fourthRes.rows[0]?.c || 0) },
      ],
      channels: (channelsRes.rows || []).map((r: { channel: string; count: number }) => ({
        key: r.channel,
        label: CHANNEL_LABELS[r.channel] || r.channel,
        count: Number(r.count || 0),
      })),
    };

    return NextResponse.json({
      success: true,
      data: {
        generated_at: new Date().toISOString(),
        students,
        finance: {
          total_students: finance.total_students,
          collected_amount: finance.collected_amount,
          debt_amount: finance.debt_amount,
          collection_rate_percent: finance.collection_rate_percent,
          fully_paid_count: finance.fully_paid_count,
          partial_paid_count: finance.partial_paid_count,
          unpaid_count: finance.unpaid_count,
          receipts_count: finance.receipts_count,
          total_discount_amount: finance.total_discount_amount,
          discounts_count: finance.discounts_count,
          expected_annual_total: finance.expected_annual_total,
          expected_four_years_total: finance.expected_four_years_total,
          best_paying_departments: finance.best_paying_departments.slice(0, 5).map((d) => ({
            id: d.id,
            name: d.name,
            students: d.students,
            collected_amount: d.collected_amount,
            debt_amount: d.debt_amount,
            collection_rate_percent: d.collection_rate_percent,
          })),
          top_debt_departments: finance.top_debt_departments.slice(0, 4).map((d) => ({
            id: d.id,
            name: d.name,
            debt_amount: d.debt_amount,
            collection_rate_percent: d.collection_rate_percent,
          })),
        },
      },
    });
  } catch (error) {
    console.error('خطأ في نظرة عامة الإشراف:', error);
    return NextResponse.json(
      { success: false, message: 'تعذر تحميل لوحة التحكم' },
      { status: 500 }
    );
  }
}
