import { NextRequest, NextResponse } from 'next/server';
import { createPublicApplication } from '@/src/lib/public-applications';
import type { ApplicationSnapshot } from '@/src/lib/student-application-print';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const payload = body?.payload as ApplicationSnapshot | undefined;
    if (!payload?.personalData?.fullName) {
      return NextResponse.json(
        { success: false, error: 'بيانات الاستمارة غير مكتملة' },
        { status: 400 }
      );
    }

    const code = await createPublicApplication(payload);
    const origin = request.nextUrl.origin;
    const url = `${origin}/public/application/${code}`;

    return NextResponse.json({ success: true, code, url });
  } catch (error) {
    console.error('public applications POST:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر حفظ الاستمارة للعرض العام' },
      { status: 500 }
    );
  }
}
