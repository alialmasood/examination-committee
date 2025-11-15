import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import jwt from 'jsonwebtoken';

export async function POST(request: NextRequest) {
  try {
    // الحصول على Refresh Token من cookies
    const refreshToken = request.cookies.get('refresh_token')?.value;
    
    if (refreshToken) {
      // محاولة حذف الجلسة من قاعدة البيانات
      try {
        // فك تشفير Refresh Token للحصول على token_id
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
        // نستمر حتى لو فشل حذف الجلسة
      }
    }

    // إعداد الاستجابة مع حذف cookies
    const response = NextResponse.json({
      success: true,
      message: 'تم تسجيل الخروج بنجاح'
    });

    // حذف cookies
    response.cookies.set('access_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0
    });

    response.cookies.set('refresh_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0
    });

    return response;

  } catch (error) {
    console.error('خطأ في API تسجيل الخروج:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: 'حدث خطأ في الخادم' 
      },
      { status: 500 }
    );
  }
}
