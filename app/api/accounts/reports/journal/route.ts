import { NextRequest, NextResponse } from 'next/server';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import {
  buildCashboxDailyRegister,
  type CashboxDocType,
} from '@/src/lib/accounts/cashbox-daily-register';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseDocType(raw: string | null): CashboxDocType {
  if (raw === 'receipt' || raw === 'payment') return raw;
  if (raw === 'قبض') return 'receipt';
  if (raw === 'دفع') return 'payment';
  return '';
}

/**
 * GET /api/accounts/reports/journal
 * سجل يومية الصندوق من وصولات تسديد الطلبة.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const data = await buildCashboxDailyRegister({
      search: searchParams.get('search') || undefined,
      department: searchParams.get('department') || undefined,
      stage: searchParams.get('stage') || undefined,
      docType: parseDocType(searchParams.get('doc_type')),
      dateFrom: searchParams.get('date_from') || undefined,
      dateTo: searchParams.get('date_to') || undefined,
    });
    return NextResponse.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('cashbox daily register error:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر تحميل سجل يومية الصندوق' },
      { status: 500 }
    );
  }
}
