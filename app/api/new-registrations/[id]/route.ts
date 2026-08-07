import { NextRequest, NextResponse } from 'next/server';
import {
  deleteNewRegistration,
  getNewRegistrationById,
  updateNewRegistration,
} from '@/src/lib/new-registrations';
import type { ApplicationSnapshot } from '@/src/lib/student-application-print';
import { createPublicApplication } from '@/src/lib/public-applications';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const row = await getNewRegistrationById(id);
    if (!row) {
      return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: row });
  } catch (error) {
    console.error('new-registrations GET id:', error);
    return NextResponse.json({ success: false, error: 'تعذر جلب الطلب' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const row = await updateNewRegistration(id, {
      payload: { ...payload, departmentPreferences: prefs },
      preferences: prefs,
    });
    if (!row) {
      return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    }

    try {
      await createPublicApplication(
        { ...payload, departmentPreferences: prefs } as ApplicationSnapshot,
        row.code
      );
    } catch (e) {
      console.warn('تعذر مزامنة النسخة العامة بعد التحديث:', e);
    }

    return NextResponse.json({ success: true, data: row, message: 'تم تحديث الطلب بنجاح' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذر تحديث الطلب';
    console.error('new-registrations PUT:', error);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await getNewRegistrationById(id);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    }
    if (existing.status === 'confirmed') {
      return NextResponse.json(
        { success: false, error: 'لا يمكن حذف طلب مثبت' },
        { status: 400 }
      );
    }
    const ok = await deleteNewRegistration(id);
    if (!ok) {
      return NextResponse.json({ success: false, error: 'تعذر الحذف' }, { status: 400 });
    }
    return NextResponse.json({ success: true, message: 'تم حذف الطلب' });
  } catch (error) {
    console.error('new-registrations DELETE:', error);
    return NextResponse.json({ success: false, error: 'تعذر حذف الطلب' }, { status: 500 });
  }
}
