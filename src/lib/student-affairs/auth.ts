import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import type { ActorInfo } from '@/src/lib/student-affairs/stage-promotion';
import type { AuthUser } from '@/src/lib/types';

export type SaAuthSuccess = {
  user: AuthUser;
  actor: ActorInfo;
};

export type SaAuthFailure = {
  response: NextResponse;
};

export async function requireStudentAffairsAccess(
  request: NextRequest
): Promise<SaAuthSuccess | SaAuthFailure> {
  const accessToken = request.cookies.get('access_token')?.value;
  if (!accessToken) {
    return {
      response: NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول' },
        { status: 401 }
      ),
    };
  }

  const payload = verifyAccessToken(accessToken);
  if (!payload) {
    return {
      response: NextResponse.json(
        { success: false, error: 'انتهت صلاحية الجلسة' },
        { status: 401 }
      ),
    };
  }

  const user = await validateUser(payload.user_id);
  if (!user) {
    return {
      response: NextResponse.json(
        { success: false, error: 'المستخدم غير موجود أو غير نشط' },
        { status: 401 }
      ),
    };
  }

  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';

  return {
    user,
    actor: {
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      ipAddress,
      userAgent,
    },
  };
}

export function isSaAuthFailure(
  result: SaAuthSuccess | SaAuthFailure
): result is SaAuthFailure {
  return 'response' in result;
}
