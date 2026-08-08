import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import {
  DOC_FILE_LABELS,
  sanitizeFilePart,
  sanitizePersonFolderName,
} from '@/src/lib/application-archive';

// POST /api/students/upload - رفع ملف صورة
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const studentFullName = String(formData.get('studentFullName') || '').trim();
    const docKey = String(formData.get('docKey') || '').trim();
    const archiveMode = String(formData.get('archiveMode') || '').trim(); // application | ''

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'لم يتم اختيار ملف' },
        { status: 400 }
      );
    }

    const validTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
    ];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        {
          success: false,
          error: `نوع الملف غير مدعوم: ${file.type}. الأنواع المدعومة: ${validTypes.join(', ')}`,
        },
        { status: 400 }
      );
    }

    const fileExtension =
      path.extname(file.name) || (file.type === 'application/pdf' ? '.pdf' : '.jpg');
    const label =
      DOC_FILE_LABELS[docKey] || sanitizeFilePart(docKey) || 'مستمسك';

    let uploadDir: string;
    let fileName: string;
    let publicPath: string;
    let storedName: string;

    if (studentFullName && archiveMode === 'application') {
      // طلب تسجيل جديد: مجلد باسم الطالب الرباعي
      const folderName = sanitizePersonFolderName(studentFullName);
      uploadDir = path.join(
        process.cwd(),
        'public',
        'uploads',
        'applications',
        folderName
      );
      fileName = `${sanitizeFilePart(studentFullName)}_${label}${fileExtension}`;
      storedName = `applications/${folderName}/${fileName}`;
      publicPath = `/uploads/${storedName}`;
    } else if (studentFullName) {
      // طالب رسمي: مجلد students لكن باسم الطالب وليس photo_رقم
      uploadDir = path.join(process.cwd(), 'public', 'uploads', 'students');
      fileName = `${sanitizeFilePart(studentFullName)}_${label}_${Date.now()}${fileExtension}`;
      storedName = fileName;
      publicPath = `/uploads/students/${fileName}`;
    } else {
      uploadDir = path.join(process.cwd(), 'public', 'uploads', 'students');
      fileName = `photo_${Date.now()}${fileExtension}`;
      storedName = fileName;
      publicPath = `/uploads/students/${fileName}`;
    }

    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, fileName);
    const bytes = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(bytes));

    return NextResponse.json({
      success: true,
      filename: storedName,
      path: publicPath,
    });
  } catch (error) {
    console.error('خطأ في رفع الملف:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في رفع الملف' },
      { status: 500 }
    );
  }
}
