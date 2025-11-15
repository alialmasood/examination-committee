import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

// POST /api/students/upload - رفع ملف صورة
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const studentId = formData.get('studentId') as string;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'لم يتم اختيار ملف' },
        { status: 400 }
      );
    }

    // التحقق من نوع الملف
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      console.log('❌ نوع الملف غير مدعوم:', file.type);
      console.log('📁 معلومات الملف:', {
        name: file.name,
        type: file.type,
        size: file.size
      });
      return NextResponse.json(
        { success: false, error: `نوع الملف غير مدعوم: ${file.type}. الأنواع المدعومة: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // إنشاء المجلد إذا لم يكن موجوداً
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'students');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // إنشاء اسم فريد للملف
    const fileExtension = path.extname(file.name);
    // إنشاء اسم فريد للملف باستخدام timestamp
    const fileName = `photo_${Date.now()}${fileExtension}`;
    
    const filePath = path.join(uploadDir, fileName);

    // تحويل الملف إلى buffer وحفظه
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    console.log('✅ تم حفظ الملف:', filePath);

    return NextResponse.json({
      success: true,
      filename: fileName,
      path: `/uploads/students/${fileName}`
    });
  } catch (error) {
    console.error('خطأ في رفع الملف:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في رفع الملف' },
      { status: 500 }
    );
  }
}
