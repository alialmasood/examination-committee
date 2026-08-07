import { NextRequest, NextResponse } from 'next/server';
import { getPublicApplication } from '@/src/lib/public-applications';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code: raw } = await params;
    const code = (raw || '').trim().toUpperCase();
    if (!code) {
      return NextResponse.json({ success: false, error: 'رمز غير صالح' }, { status: 400 });
    }

    const row = await getPublicApplication(code);
    if (!row) {
      return NextResponse.json({ success: false, error: 'الاستمارة غير موجودة' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      code: row.code,
      payload: row.payload,
      created_at: row.created_at,
    });
  } catch (error) {
    console.error('public applications GET:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر جلب الاستمارة' },
      { status: 500 }
    );
  }
}
