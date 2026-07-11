import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import fs from 'fs';
import path from 'path';

// GET /api/students/[id]/photo - جلب صورة الطالب
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: studentId } = await params;
    
    // جلب اسم ملف الصورة من قاعدة البيانات
    const result = await query(
      'SELECT photo FROM student_affairs.students WHERE id = $1',
      [studentId]
    );
    
    console.log('🔍 نتيجة الاستعلام عن الصورة:', result.rows);
    
    if (result.rows.length === 0) {
      console.log('❌ الطالب غير موجود');
      return new NextResponse('الطالب غير موجود', { status: 404 });
    }
    
    const photoValue = result.rows[0].photo;
    console.log('📷 قيمة حقل photo:', photoValue, 'نوع:', typeof photoValue);
    
    if (!photoValue || (typeof photoValue === 'boolean' && !photoValue)) {
      console.log('❌ لا توجد صورة محفوظة');
      return new NextResponse('الصورة غير موجودة', { status: 404 });
    }
    
    // إذا كانت القيمة boolean (true)، نبحث عن صورة افتراضية
    if (typeof photoValue === 'boolean') {
      console.log('⚠️ القيمة boolean، البحث عن صورة افتراضية');
      const photoFilename = `${studentId}.jpg`;
      const photoPath = path.join(process.cwd(), 'public', 'uploads', 'students', photoFilename);
      
      if (fs.existsSync(photoPath)) {
        const fileBuffer = fs.readFileSync(photoPath);
        return new NextResponse(new Uint8Array(fileBuffer), {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
      
      return new NextResponse('الصورة غير موجودة', { status: 404 });
    }
    
    // إذا كانت القيمة نص (اسم الملف)
    const photoFilename = String(photoValue);
    
    // مسار ملف الصورة
    const photoPath = path.join(process.cwd(), 'public', 'uploads', 'students', photoFilename);
    
    // التحقق من وجود الملف
    if (!fs.existsSync(photoPath)) {
      return new NextResponse('الملف غير موجود', { status: 404 });
    }
    
    // قراءة الملف
    const fileBuffer = fs.readFileSync(photoPath);
    
    // تحديد نوع الصورة
    const ext = path.extname(photoFilename).toLowerCase();
    let contentType = 'image/jpeg';
    if (ext === '.png') contentType = 'image/png';
    else if (ext === '.gif') contentType = 'image/gif';
    else if (ext === '.webp') contentType = 'image/webp';
    
    // إرجاع الصورة
    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('خطأ في جلب صورة الطالب:', error);
    return new NextResponse('خطأ في جلب الصورة', { status: 500 });
  }
}
