/**
 * مصادقة مسارات إدارة المنصة (سوبر أدمن فقط).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import { isPlatformSuperAdminUsername } from '@/src/lib/platform-superadmin';
import type { AuthUser } from '@/src/lib/types';

export { isPlatformSuperAdminUsername as isPlatformAdminUsername } from '@/src/lib/platform-superadmin';

export type AdminAuthOk = {
  ok: true;
  user: AuthUser;
};

export type AdminAuthFail = {
  ok: false;
  response: NextResponse;
};

/**
 * حارس بوابة السوبر أدمن — حساب مستقل فقط، بلا أنظمة تشغيلية.
 */
export async function requirePlatformAdmin(
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

  if (!isPlatformSuperAdminUsername(user.username)) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: 'هذه البوابة مخصّصة لحساب السوبر أدمن فقط' },
        { status: 403 }
      ),
    };
  }

  return { ok: true, user };
}

/** @deprecated استخدم requirePlatformAdmin */
export async function requireStudentAffairsAdmin(
  request: NextRequest
): Promise<AdminAuthOk | AdminAuthFail> {
  return requirePlatformAdmin(request);
}
