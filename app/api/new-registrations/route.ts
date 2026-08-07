import { NextRequest, NextResponse } from 'next/server';
import { createNewRegistration, listNewRegistrations } from '@/src/lib/new-registrations';
import type { ApplicationSnapshot } from '@/src/lib/student-application-print';
import { createPublicApplication } from '@/src/lib/public-applications';
import { buildPublicApplicationUrl, getRequestSiteOrigin } from '@/src/lib/site-url';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const data = await listNewRegistrations({
      search: searchParams.get('search') || '',
      department: searchParams.get('department') || '',
      studyType: searchParams.get('study_type') || '',
      academicYear: searchParams.get('academic_year') || '',
      page: parseInt(searchParams.get('page') || '1', 10),
      limit: parseInt(searchParams.get('limit') || '40', 10),
    });
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    console.error('new-registrations GET:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر جلب طلبات التسجيل الجديد' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const payload = body?.payload as ApplicationSnapshot | undefined;
    const preferences = body?.preferences as
      | { first?: string; second?: string; third?: string }
      | undefined;

    if (!payload?.personalData?.fullName) {
      return NextResponse.json(
        { success: false, error: 'بيانات الاستمارة غير مكتملة' },
        { status: 400 }
      );
    }
    if (!preferences?.first || !preferences?.second || !preferences?.third) {
      return NextResponse.json(
        { success: false, error: 'يجب اختيار ثلاث رغبات أقسام' },
        { status: 400 }
      );
    }
    const prefs = {
      first: preferences.first,
      second: preferences.second,
      third: preferences.third,
    };
    if (new Set([prefs.first, prefs.second, prefs.third]).size < 3) {
      return NextResponse.json(
        { success: false, error: 'يجب أن تكون الرغبات الثلاث أقساماً مختلفة' },
        { status: 400 }
      );
    }

    const row = await createNewRegistration({
      payload: { ...payload, departmentPreferences: prefs },
      preferences: prefs,
    });

    // حفظ نسخة للعرض العام/الطباعة بنفس رمز الطلب
    let publicUrl = '';
    try {
      const publicCode = await createPublicApplication(
        {
          ...payload,
          departmentPreferences: prefs,
        } as ApplicationSnapshot,
        row.code
      );
      publicUrl = buildPublicApplicationUrl(getRequestSiteOrigin(request), publicCode);
    } catch (e) {
      console.warn('تعذر إنشاء رابط عام للطلب:', e);
    }

    return NextResponse.json({
      success: true,
      data: row,
      publicUrl,
      message: 'تم حفظ طلب التسجيل الجديد بنجاح',
    });
  } catch (error) {
    console.error('new-registrations POST:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر حفظ طلب التسجيل الجديد' },
      { status: 500 }
    );
  }
}
