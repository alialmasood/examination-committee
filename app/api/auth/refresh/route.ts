import { NextRequest, NextResponse } from 'next/server';
import { verifyRefreshToken, generateAccessToken } from '@/src/lib/auth';
import { query } from '@/src/lib/db';

export async function POST(request: NextRequest) {
  try {
    // الحصول على Refresh Token من cookies
    const refreshToken = request.cookies.get('refresh_token')?.value;

    if (!refreshToken) {
      return NextResponse.json(
        {
          success: false,
          error: 'لم يتم العثور على refresh token'
        },
        { status: 401 }
      );
    }

    // التحقق من صحة Refresh Token
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return NextResponse.json(
        {
          success: false,
          error: 'Refresh token غير صالح أو منتهي الصلاحية'
        },
        { status: 401 }
      );
    }

    const userId = payload.user_id;

    // التحقق من وجود المستخدم
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
          error: 'المستخدم غير موجود أو غير نشط'
        },
        { status: 401 }
      );
    }

    const user = userResult.rows[0];

    // توليد access token جديد
    const newAccessToken = generateAccessToken(user.id, user.username);

    // إعداد الاستجابة مع access token جديد
    const response = NextResponse.json({
      success: true,
      message: 'تم تجديد access token بنجاح'
    });

    // حفظ access token الجديد في cookie
    response.cookies.set('access_token', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 20 * 60 * 1000 // 20 دقيقة
    });

    return response;

  } catch (error: unknown) {
    console.error('خطأ في تجديد access token:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ في تجديد access token'
      },
      { status: 500 }
    );
  }
}

