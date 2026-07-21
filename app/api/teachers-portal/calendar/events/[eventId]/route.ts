import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';

// GET - جلب حدث معين
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
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

    const { eventId } = await params;

    const eventQuery = `
      SELECT 
        e.*,
        ts.material_name as subject_name,
        l.topic as lecture_topic,
        t.full_name_ar as teacher_name
      FROM examination_committee.calendar_events e
      LEFT JOIN examination_committee.teaching_subjects ts ON e.subject_id = ts.id
      LEFT JOIN examination_committee.lectures l ON e.lecture_id = l.id
      LEFT JOIN hr.teachers t ON e.teacher_id = t.id
      WHERE e.id = $1
    `;

    const eventResult = await query(eventQuery, [eventId]);

    if (eventResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'الحدث غير موجود' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: eventResult.rows[0]
    });

  } catch (error: unknown) {
    console.error('خطأ في جلب الحدث:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في جلب الحدث: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

// PUT - تحديث حدث
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
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

    const { eventId } = await params;
    const body = await request.json();

    // التحقق من أن المستخدم هو صاحب الحدث
    const checkQuery = `
      SELECT teacher_id
      FROM examination_committee.calendar_events
      WHERE id = $1
    `;
    const checkResult = await query(checkQuery, [eventId]);

    if (checkResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'الحدث غير موجود' },
        { status: 404 }
      );
    }

    // التحقق من أن المستخدم هو صاحب الحدث
    const teacherQuery = `
      SELECT id as teacher_id
      FROM hr.teachers
      WHERE user_id = $1 AND status = 'active'
      LIMIT 1
    `;
    const teacherResult = await query(teacherQuery, [user.id]);

    if (teacherResult.rows.length === 0 || checkResult.rows[0].teacher_id !== teacherResult.rows[0].teacher_id) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بتعديل هذا الحدث' },
        { status: 403 }
      );
    }

    // تحديث الحدث
    const updateQuery = `
      UPDATE examination_committee.calendar_events
      SET 
        title = COALESCE($1, title),
        description = $2,
        event_type = COALESCE($3, event_type),
        event_category = $4,
        start_date = COALESCE($5, start_date),
        end_date = $6,
        start_time = $7,
        end_time = $8,
        all_day = COALESCE($9, all_day),
        location = $10,
        lecture_id = $11,
        subject_id = $12,
        color = COALESCE($13, color),
        priority = COALESCE($14, priority),
        reminder_minutes = $15,
        is_shared_with_students = COALESCE($16, is_shared_with_students),
        is_shared_with_teachers = COALESCE($17, is_shared_with_teachers),
        shared_with_departments = $18,
        shared_with_stages = $19,
        shared_with_study_types = $20,
        exam_type = $21,
        exam_duration_minutes = $22,
        notes = $23,
        is_recurring = COALESCE($24, is_recurring),
        recurrence_pattern = $25,
        recurrence_end_date = $26,
        recurrence_count = $27,
        visibility = COALESCE($28, visibility),
        updated_by = $29,
        updated_at = NOW()
      WHERE id = $30
      RETURNING *
    `;

    const result = await query(updateQuery, [
      body.title || null,
      body.description || null,
      body.event_type || null,
      body.event_category || null,
      body.start_date || null,
      body.end_date || null,
      body.start_time || null,
      body.end_time || null,
      body.all_day || null,
      body.location || null,
      body.lecture_id || null,
      body.subject_id || null,
      body.color || null,
      body.priority || null,
      body.reminder_minutes || null,
      body.is_shared_with_students || null,
      body.is_shared_with_teachers || null,
      body.shared_with_departments || null,
      body.shared_with_stages || null,
      body.shared_with_study_types || null,
      body.exam_type || null,
      body.exam_duration_minutes || null,
      body.notes || null,
      body.is_recurring || null,
      body.recurrence_pattern || null,
      body.recurrence_end_date || null,
      body.recurrence_count || null,
      body.visibility || null,
      user.id,
      eventId
    ]);

    return NextResponse.json({
      success: true,
      data: result.rows[0],
      message: 'تم تحديث الحدث بنجاح'
    });

  } catch (error: unknown) {
    console.error('خطأ في تحديث الحدث:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في تحديث الحدث: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

// DELETE - حذف حدث
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
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

    const { eventId } = await params;

    // التحقق من أن المستخدم هو صاحب الحدث
    const checkQuery = `
      SELECT teacher_id
      FROM examination_committee.calendar_events
      WHERE id = $1
    `;
    const checkResult = await query(checkQuery, [eventId]);

    if (checkResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'الحدث غير موجود' },
        { status: 404 }
      );
    }

    const teacherQuery = `
      SELECT id as teacher_id
      FROM hr.teachers
      WHERE user_id = $1 AND status = 'active'
      LIMIT 1
    `;
    const teacherResult = await query(teacherQuery, [user.id]);

    if (teacherResult.rows.length === 0 || checkResult.rows[0].teacher_id !== teacherResult.rows[0].teacher_id) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بحذف هذا الحدث' },
        { status: 403 }
      );
    }

    // حذف الحدث
    const deleteQuery = `
      DELETE FROM examination_committee.calendar_events
      WHERE id = $1
      RETURNING id
    `;

    await query(deleteQuery, [eventId]);

    return NextResponse.json({
      success: true,
      message: 'تم حذف الحدث بنجاح'
    });

  } catch (error: unknown) {
    console.error('خطأ في حذف الحدث:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في حذف الحدث: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

