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

function parseNonNeg(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

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

/** PATCH /api/accounts/department-tuition-fees — تعديل قسط قسم (حسب المرحلة) */
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

    const stageKeys = [
      'morning_fee_y1',
      'morning_fee_y2',
      'morning_fee_y3',
      'morning_fee_y4',
      'evening_fee_y1',
      'evening_fee_y2',
      'evening_fee_y3',
      'evening_fee_y4',
    ] as const;

    const hasStagePayload = stageKeys.some((k) => body?.[k] != null);
    const payload: Record<string, number> = {};

    if (hasStagePayload) {
      for (const key of stageKeys) {
        if (body?.[key] == null) continue;
        const n = parseNonNeg(body[key]);
        if (n == null) {
          return NextResponse.json(
            { success: false, error: `قيمة غير صالحة: ${key}` },
            { status: 400 }
          );
        }
        payload[key] = n;
      }
      // مزامنة الحقول القديمة مع المرحلة الأولى إن وُجدت
      if (payload.morning_fee_y1 != null) {
        payload.morning_fee = payload.morning_fee_y1;
      }
      if (payload.evening_fee_y1 != null) {
        payload.evening_fee = payload.evening_fee_y1;
      }
    } else {
      const morning = parseNonNeg(body?.morning_fee);
      const evening = parseNonNeg(body?.evening_fee);
      if (morning == null) {
        return NextResponse.json(
          { success: false, error: 'قسط الصباحي غير صالح' },
          { status: 400 }
        );
      }
      if (evening == null) {
        return NextResponse.json(
          { success: false, error: 'قسط المسائي غير صالح' },
          { status: 400 }
        );
      }
      // توافق خلفي: قسط واحد يُطبَّق على كل المراحل
      payload.morning_fee = morning;
      payload.evening_fee = evening;
      payload.morning_fee_y1 = morning;
      payload.morning_fee_y2 = morning;
      payload.morning_fee_y3 = morning;
      payload.morning_fee_y4 = morning;
      payload.evening_fee_y1 = evening;
      payload.evening_fee_y2 = evening;
      payload.evening_fee_y3 = evening;
      payload.evening_fee_y4 = evening;
    }

    const updated = await updateDepartmentTuitionFee({
      id,
      ...payload,
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
