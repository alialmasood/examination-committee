import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, validateUser, getUserSystems } from '@/src/lib/auth';
import { isPlatformSuperAdminUsername } from '@/src/lib/platform-superadmin';

export async function GET(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('access_token')?.value;

    if (!accessToken) {
      return NextResponse.json(
        {
          success: false,
          message: 'لم يتم العثور على رمز المصادقة',
        },
        { status: 401 }
      );
    }

    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      return NextResponse.json(
        {
          success: false,
          message: 'رمز المصادقة غير صالح أو منتهي الصلاحية',
        },
        { status: 401 }
      );
    }

    const user = await validateUser(payload.user_id);
    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: 'المستخدم غير موجود أو غير نشط',
        },
        { status: 401 }
      );
    }

    const systems = await getUserSystems(user.id);
    const is_platform_admin = isPlatformSuperAdminUsername(user.username);

    return NextResponse.json({
      success: true,
      user,
      systems,
      is_platform_admin,
      message: 'تم جلب بيانات المستخدم بنجاح',
    });
  } catch (error) {
    console.error('خطأ في API بيانات المستخدم:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'حدث خطأ في الخادم',
      },
      { status: 500 }
    );
  }
}
