import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import { isGeneralSupervisionUsername } from '@/src/lib/general-supervision';
import { buildStudentsFinanceSummary } from '@/src/lib/accounts/students-finance-summary';

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
 * GET /api/general-supervision/accounts
 * ملخص مالي لطلبة الكلية — نفس مصادر صفحات الحسابات.
 */
export async function GET(request: NextRequest) {
  const auth = await requireGeneralSupervision(request);
  if (!auth.ok) return auth.response;

  try {
    const data = await buildStudentsFinanceSummary();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('خطأ في ملخص حسابات الإشراف العامة:', error);
    return NextResponse.json(
      { success: false, message: 'تعذر تحميل إحصائيات الحسابات' },
      { status: 500 }
    );
  }
}
