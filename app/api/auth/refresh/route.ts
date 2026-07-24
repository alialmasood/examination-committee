import { NextRequest, NextResponse } from 'next/server';
import { verifyRefreshToken, generateAccessToken } from '@/src/lib/auth';
import { query } from '@/src/lib/db';
import { ACCESS_COOKIE_MAX_AGE_SEC, authCookieOptions } from '@/src/lib/auth-cookies';

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get('refresh_token')?.value;

    if (!refreshToken) {
      return NextResponse.json(
        {
          success: false,
          error: 'لم يتم العثور على refresh token',
        },
        { status: 401 }
      );
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return NextResponse.json(
        {
          success: false,
          error: 'Refresh token غير صالح أو منتهي الصلاحية',
        },
        { status: 401 }
      );
    }

    const userId = payload.user_id;

    const userResult = await query(
      `SELECT id, username, is_active 
       FROM student_affairs.users 
       WHERE id = $1 AND is_active = TRUE`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'المستخدم غير موجود أو غير نشط',
        },
        { status: 401 }
      );
    }

    const user = userResult.rows[0];
    const newAccessToken = generateAccessToken(user.id, user.username);

    const response = NextResponse.json({
      success: true,
      message: 'تم تجديد access token بنجاح',
    });

    response.cookies.set(
      'access_token',
      newAccessToken,
      authCookieOptions(ACCESS_COOKIE_MAX_AGE_SEC)
    );

    return response;
  } catch (error: unknown) {
    console.error('خطأ في تجديد access token:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ في تجديد access token',
      },
      { status: 500 }
    );
  }
}
