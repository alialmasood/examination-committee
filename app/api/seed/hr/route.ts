import { NextRequest, NextResponse } from 'next/server';
import { seedHR } from '@/src/lib/seed-hr';

export async function POST(request: NextRequest) {
  try {
    // يمكن إضافة تحقق من الصلاحيات هنا إذا لزم الأمر
    await seedHR();
    
    return NextResponse.json({
      success: true,
      message: 'تم إنشاء نظام HR والمستخدم بنجاح'
    });
  } catch (error: any) {
    console.error('خطأ في إنشاء نظام HR:', error);
    return NextResponse.json(
      {
        success: false,
        message: error.message || 'حدث خطأ في إنشاء نظام HR'
      },
      { status: 500 }
    );
  }
}

