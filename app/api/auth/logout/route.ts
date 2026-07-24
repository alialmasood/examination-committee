import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import jwt from 'jsonwebtoken';
import { authCookieOptions } from '@/src/lib/auth-cookies';

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get('refresh_token')?.value;

    if (refreshToken) {
      try {
        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
          throw new Error('JWT_SECRET غير محدد');
        }
        const decoded = jwt.verify(refreshToken, jwtSecret) as { token_id?: string };

        if (decoded && decoded.token_id) {
          await query(
            `DELETE FROM platform.sessions 
             WHERE token_id = $1`,
            [decoded.token_id]
          );
        }
      } catch (error) {
        console.error('خطأ في حذف الجلسة:', error);
      }
    }

    const response = NextResponse.json({
      success: true,
      message: 'تم تسجيل الخروج بنجاح',
    });

    response.cookies.set('access_token', '', {
      ...authCookieOptions(0),
      maxAge: 0,
    });

    response.cookies.set('refresh_token', '', {
      ...authCookieOptions(0),
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error('خطأ في API تسجيل الخروج:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'حدث خطأ في الخادم',
      },
      { status: 500 }
    );
  }
}
