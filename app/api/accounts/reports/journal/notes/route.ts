import { NextRequest, NextResponse } from 'next/server';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { upsertCashboxRegisterNote } from '@/src/lib/accounts/cashbox-daily-register';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/accounts/reports/journal/notes
 * تحديث ملاحظات صف في سجل يومية الصندوق.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const receiptId = String(body?.receipt_id || body?.id || '').trim();
    const notes = String(body?.notes ?? '');

    if (!receiptId) {
      return NextResponse.json(
        { success: false, error: 'معرّف الوصل مطلوب' },
        { status: 400 }
      );
    }

    await upsertCashboxRegisterNote(receiptId, notes, auth.user?.id);
    return NextResponse.json(
      { success: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('cashbox notes error:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر حفظ الملاحظات' },
      { status: 500 }
    );
  }
}
