import { NextRequest, NextResponse } from 'next/server';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import {
  listDepartmentTuitionFees,
  updateDepartmentTuitionFee,
} from '@/src/lib/accounts/department-tuition-fees';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** GET /api/accounts/department-tuition-fees — قائمة أقساط الأقسام */
export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const rows = await listDepartmentTuitionFees();
    return NextResponse.json(
      { success: true, data: rows },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('department-tuition-fees GET:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر تحميل أقساط الأقسام' },
      { status: 500 }
    );
  }
}

/** PATCH /api/accounts/department-tuition-fees — تعديل قسط قسم */
export async function PATCH(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'معرّف القسم مطلوب' },
        { status: 400 }
      );
    }

    const morning = Number(body?.morning_fee);
    const evening = Number(body?.evening_fee);
    if (!Number.isFinite(morning) || morning < 0) {
      return NextResponse.json(
        { success: false, error: 'قسط الصباحي غير صالح' },
        { status: 400 }
      );
    }
    if (!Number.isFinite(evening) || evening < 0) {
      return NextResponse.json(
        { success: false, error: 'قسط المسائي غير صالح' },
        { status: 400 }
      );
    }

    const updated = await updateDepartmentTuitionFee({
      id,
      morning_fee: morning,
      evening_fee: evening,
      updated_by: auth.user.id,
    });

    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'القسم غير موجود' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('department-tuition-fees PATCH:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر حفظ قسط القسم' },
      { status: 500 }
    );
  }
}
