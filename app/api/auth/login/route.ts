import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/src/lib/auth';
import { LoginRequest } from '@/src/lib/types';
import {
  ACCESS_COOKIE_MAX_AGE_SEC,
  REFRESH_COOKIE_MAX_AGE_SEC,
  authCookieOptions,
} from '@/src/lib/auth-cookies';

export async function POST(request: NextRequest) {
  try {
    const body: LoginRequest = await request.json();

    if (!body.username || !body.password) {
      return NextResponse.json(
        {
          success: false,
          message: 'اسم المستخدم وكلمة المرور مطلوبان',
        },
        { status: 400 }
      );
    }

    const result = await authenticateUser(body);

    if (!result.success) {
      return NextResponse.json(result, { status: 401 });
    }

    const response = NextResponse.json({
      success: true,
      user: result.user,
      systems: result.systems,
      is_platform_admin: result.is_platform_admin === true,
      message: 'تم تسجيل الدخول بنجاح',
    });

    if (result.refresh_token) {
      response.cookies.set(
        'refresh_token',
        result.refresh_token,
        authCookieOptions(REFRESH_COOKIE_MAX_AGE_SEC)
      );
    }

    if (result.access_token) {
      response.cookies.set(
        'access_token',
        result.access_token,
        authCookieOptions(ACCESS_COOKIE_MAX_AGE_SEC)
      );
    }

    return response;
  } catch (error) {
    console.error('خطأ في API تسجيل الدخول:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'حدث خطأ في الخادم',
      },
      { status: 500 }
    );
  }
}
