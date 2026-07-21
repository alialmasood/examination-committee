import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

/**
 * GET /api/master-sheet/[system]/notes
 * جلب الملاحظات للطلاب
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ system: string }> }
) {
  try {
    const { system } = await params;
    const { searchParams } = new URL(request.url);
    const studentIds = searchParams.get('studentIds')?.split(',') || [];
    const academicYear = searchParams.get('academicYear') || '2025-2026';

    if (studentIds.length === 0) {
      return NextResponse.json({ success: true, notes: {} });
    }

    // إنشاء الجدول إذا لم يكن موجوداً
    await query(`
      CREATE TABLE IF NOT EXISTS examination_committee.master_sheet_notes (
        id SERIAL PRIMARY KEY,
        student_id UUID NOT NULL,
        academic_year VARCHAR(20) NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(student_id, academic_year)
      )
    `);

    // جلب الملاحظات
    const placeholders = studentIds.map((_, i) => `$${i + 1}`).join(',');
    const notesQuery = `
      SELECT student_id, notes
      FROM examination_committee.master_sheet_notes
      WHERE student_id IN (${placeholders}) AND academic_year = $${studentIds.length + 1}
    `;
    const notesResult = await query(notesQuery, [...studentIds, academicYear]);

    // تحويل النتائج إلى كائن
    const notes: Record<string, string> = {};
    notesResult.rows.forEach((row: any) => {
      notes[row.student_id] = row.notes || '';
    });

    return NextResponse.json({ success: true, notes });
  } catch (error) {
    console.error('خطأ في جلب الملاحظات:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب الملاحظات' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/master-sheet/[system]/notes
 * حفظ أو تحديث ملاحظات طالب
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ system: string }> }
) {
  try {
    const { system } = await params;
    const { studentId, notes, academicYear } = await request.json();

    if (!studentId) {
      return NextResponse.json(
        { success: false, error: 'معرف الطالب مطلوب' },
        { status: 400 }
      );
    }

    // إنشاء الجدول إذا لم يكن موجوداً
    await query(`
      CREATE TABLE IF NOT EXISTS examination_committee.master_sheet_notes (
        id SERIAL PRIMARY KEY,
        student_id UUID NOT NULL,
        academic_year VARCHAR(20) NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(student_id, academic_year)
      )
    `);

    // حفظ أو تحديث الملاحظات
    const upsertQuery = `
      INSERT INTO examination_committee.master_sheet_notes (student_id, academic_year, notes)
      VALUES ($1, $2, $3)
      ON CONFLICT (student_id, academic_year) DO UPDATE
      SET notes = $3, updated_at = NOW()
      RETURNING id
    `;
    await query(upsertQuery, [studentId, academicYear || '2025-2026', notes || '']);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('خطأ في حفظ الملاحظات:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في حفظ الملاحظات' },
      { status: 500 }
    );
  }
}

