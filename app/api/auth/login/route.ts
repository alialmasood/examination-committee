import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/src/lib/auth';
import { LoginRequest } from '@/src/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body: LoginRequest = await request.json();
    
    // التحقق من البيانات المطلوبة
    if (!body.username || !body.password) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'اسم المستخدم وكلمة المرور مطلوبان' 
        },
        { status: 400 }
      );
    }

    // محاولة تسجيل الدخول
    const result = await authenticateUser(body);

    if (!result.success) {
      return NextResponse.json(result, { status: 401 });
    }

    // إعداد cookies آمنة
    const response = NextResponse.json({
      success: true,
      user: result.user,
      systems: result.systems,
      message: 'تم تسجيل الدخول بنجاح'
    });

    // حفظ Refresh Token في cookie آمنة
    if (result.refresh_token) {
      response.cookies.set('refresh_token', result.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 يوم
      });
    }

    // حفظ Access Token في cookie آمنة
    if (result.access_token) {
      response.cookies.set('access_token', result.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 20 * 60 * 1000 // 20 دقيقة
      });
    }

    return response;

  } catch (error) {
    console.error('خطأ في API تسجيل الدخول:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: 'حدث خطأ في الخادم' 
      },
      { status: 500 }
    );
  }
}
