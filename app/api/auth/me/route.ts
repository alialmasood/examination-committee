import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, validateUser, getUserSystems } from '@/src/lib/auth';

export async function GET(request: NextRequest) {
  try {
    // الحصول على Access Token من cookies
    const accessToken = request.cookies.get('access_token')?.value;
    
    if (!accessToken) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'لم يتم العثور على رمز المصادقة' 
        },
        { status: 401 }
      );
    }

    // التحقق من صحة Access Token
    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'رمز المصادقة غير صالح أو منتهي الصلاحية' 
        },
        { status: 401 }
      );
    }

    // التحقق من وجود المستخدم
    const user = await validateUser(payload.user_id);
    if (!user) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'المستخدم غير موجود أو غير نشط' 
        },
        { status: 401 }
      );
    }

    // الحصول على أنظمة المستخدم
    const systems = await getUserSystems(user.id);

    return NextResponse.json({
      success: true,
      user,
      systems,
      message: 'تم جلب بيانات المستخدم بنجاح'
    });

  } catch (error) {
    console.error('خطأ في API بيانات المستخدم:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: 'حدث خطأ في الخادم' 
      },
      { status: 500 }
    );
  }
}
