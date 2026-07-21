import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';

// GET - جلب معلومات محاضرة معينة
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ lectureId: string }> }
) {
  try {
    const accessToken = request.cookies.get('access_token')?.value;

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح' },
        { status: 401 }
      );
    }

    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'رمز المصادقة غير صالح أو منتهي الصلاحية' },
        { status: 401 }
      );
    }

    const user = await validateUser(payload.user_id);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود أو غير نشط' },
        { status: 401 }
      );
    }

    const { lectureId } = await params;

    // جلب معلومات المحاضرة
    const lectureQuery = `
      SELECT 
        l.id,
        l.subject_id,
        l.lecture_date,
        l.lecture_time,
        l.duration_minutes,
        l.topic,
        l.location,
        l.notes,
        ts.material_name as subject_name
      FROM examination_committee.lectures l
      JOIN examination_committee.teaching_subjects ts ON l.subject_id = ts.id
      WHERE l.id = $1
    `;

    const lectureResult = await query(lectureQuery, [lectureId]);

    if (lectureResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحاضرة غير موجودة' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: lectureResult.rows[0]
    });

  } catch (error: unknown) {
    console.error('خطأ في جلب معلومات المحاضرة:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في جلب معلومات المحاضرة: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

// PUT - تحديث معلومات المحاضرة
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ lectureId: string }> }
) {
  try {
    const accessToken = request.cookies.get('access_token')?.value;

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح' },
        { status: 401 }
      );
    }

    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'رمز المصادقة غير صالح أو منتهي الصلاحية' },
        { status: 401 }
      );
    }

    const user = await validateUser(payload.user_id);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود أو غير نشط' },
        { status: 401 }
      );
    }

    const { lectureId } = await params;
    const body = await request.json();
    const { lecture_date, lecture_time, duration_minutes, topic, location, notes } = body;

    // التحقق من وجود المحاضرة
    const checkQuery = `
      SELECT id 
      FROM examination_committee.lectures 
      WHERE id = $1
    `;
    const checkResult = await query(checkQuery, [lectureId]);

    if (checkResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحاضرة غير موجودة' },
        { status: 404 }
      );
    }

    // تحديث المحاضرة
    const updateQuery = `
      UPDATE examination_committee.lectures
      SET 
        lecture_date = COALESCE($1, lecture_date),
        lecture_time = $2,
        duration_minutes = COALESCE($3, duration_minutes),
        topic = $4,
        location = $5,
        notes = $6,
        updated_at = NOW()
      WHERE id = $7
      RETURNING id, lecture_date, lecture_time, duration_minutes, topic, location, notes, updated_at
    `;

    const result = await query(updateQuery, [
      lecture_date || null,
      lecture_time || null,
      duration_minutes || null,
      topic || null,
      location || null,
      notes || null,
      lectureId
    ]);

    return NextResponse.json({
      success: true,
      data: result.rows[0],
      message: 'تم تحديث المحاضرة بنجاح'
    });

  } catch (error: unknown) {
    console.error('خطأ في تحديث المحاضرة:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في تحديث المحاضرة: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

// DELETE - حذف المحاضرة
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ lectureId: string }> }
) {
  try {
    const accessToken = request.cookies.get('access_token')?.value;

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح' },
        { status: 401 }
      );
    }

    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'رمز المصادقة غير صالح أو منتهي الصلاحية' },
        { status: 401 }
      );
    }

    const user = await validateUser(payload.user_id);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود أو غير نشط' },
        { status: 401 }
      );
    }

    const { lectureId } = await params;

    // التحقق من وجود المحاضرة
    const checkQuery = `
      SELECT id 
      FROM examination_committee.lectures 
      WHERE id = $1
    `;
    const checkResult = await query(checkQuery, [lectureId]);

    if (checkResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحاضرة غير موجودة' },
        { status: 404 }
      );
    }

    // حذف المحاضرة (سيتم حذف سجلات الحضور تلقائياً بسبب CASCADE)
    const deleteQuery = `
      DELETE FROM examination_committee.lectures
      WHERE id = $1
      RETURNING id
    `;

    await query(deleteQuery, [lectureId]);

    return NextResponse.json({
      success: true,
      message: 'تم حذف المحاضرة بنجاح'
    });

  } catch (error: unknown) {
    console.error('خطأ في حذف المحاضرة:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في حذف المحاضرة: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

