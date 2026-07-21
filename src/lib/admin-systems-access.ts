/**
 * مصادقة مسارات إدارة الأنظمة — تتطلب دخول + صلاحية شؤون الطلبة.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, validateUser, getUserSystems } from '@/src/lib/auth';
import type { AuthUser } from '@/src/lib/types';

export type AdminAuthOk = {
  ok: true;
  user: AuthUser;
};

export type AdminAuthFail = {
  ok: false;
  response: NextResponse;
};

export async function requireStudentAffairsAdmin(
  request: NextRequest
): Promise<AdminAuthOk | AdminAuthFail> {
  const accessToken = request.cookies.get('access_token')?.value;
  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: 'يجب تسجيل الدخول أولاً' },
        { status: 401 }
      ),
    };
  }

  const payload = verifyAccessToken(accessToken);
  if (!payload) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: 'انتهت الجلسة أو رمز المصادقة غير صالح' },
        { status: 401 }
      ),
    };
  }

  const user = await validateUser(payload.user_id);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: 'المستخدم غير موجود أو غير نشط' },
        { status: 401 }
      ),
    };
  }

  const systems = await getUserSystems(user.id);
  const hasStudentAffairs = systems.some((s) => s.code === 'STUDENT_AFFAIRS');
  const isAdminUser =
    user.username === 'admin' ||
    user.username.toLowerCase() === 'administrator';

  if (!hasStudentAffairs && !isAdminUser) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: 'ليس لديك صلاحية إدارة أنظمة المنصة' },
        { status: 403 }
      ),
    };
  }

  return { ok: true, user };
}
