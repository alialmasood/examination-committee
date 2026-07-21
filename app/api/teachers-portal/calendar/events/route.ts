import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';

// GET - جلب جميع الأحداث للتدريسي
export async function GET(request: NextRequest) {
  try {
    // التحقق من المصادقة
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

    // جلب معرف التدريسي
    const teacherQuery = `
      SELECT id as teacher_id
      FROM hr.teachers
      WHERE user_id = $1 AND status = 'active'
      LIMIT 1
    `;
    const teacherResult = await query(teacherQuery, [user.id]);

    if (teacherResult.rows.length === 0) {
      return NextResponse.json({
        success: true,
        data: []
      });
    }

    const teacherId = teacherResult.rows[0].teacher_id;

    // جلب معايير الفلترة من query parameters
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const eventType = searchParams.get('type');
    const subjectId = searchParams.get('subjectId');

    // بناء query جلب الأحداث
    let eventsQuery = `
      SELECT 
        e.id,
        e.teacher_id,
        e.title,
        e.description,
        e.event_type,
        e.event_category,
        e.start_date,
        e.end_date,
        e.start_time,
        e.end_time,
        e.all_day,
        e.location,
        e.lecture_id,
        e.subject_id,
        e.color,
        e.priority,
        e.status,
        e.is_shared_with_students,
        e.is_shared_with_teachers,
        e.shared_with_departments,
        e.shared_with_stages,
        e.shared_with_study_types,
        e.exam_type,
        e.exam_duration_minutes,
        e.is_recurring,
        e.recurrence_pattern,
        e.notes,
        e.created_at,
        e.updated_at,
        ts.material_name as subject_name,
        l.topic as lecture_topic,
        l.lecture_date as lecture_date,
        l.lecture_time as lecture_time
      FROM examination_committee.calendar_events e
      LEFT JOIN examination_committee.teaching_subjects ts ON e.subject_id = ts.id
      LEFT JOIN examination_committee.lectures l ON e.lecture_id = l.id
      WHERE e.teacher_id = $1
    `;

    const params: (string | null)[] = [teacherId];
    let paramIndex = 2;

    // فلتر التاريخ
    if (startDate) {
      eventsQuery += ` AND (e.end_date >= $${paramIndex} OR e.end_date IS NULL AND e.start_date >= $${paramIndex})`;
      params.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      eventsQuery += ` AND e.start_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    // فلتر نوع الحدث
    if (eventType && eventType !== 'all') {
      eventsQuery += ` AND e.event_type = $${paramIndex}`;
      params.push(eventType);
      paramIndex++;
    }

    // فلتر المادة الدراسية
    if (subjectId && subjectId !== 'all') {
      eventsQuery += ` AND e.subject_id = $${paramIndex}`;
      params.push(subjectId);
      paramIndex++;
    }

    eventsQuery += ` ORDER BY e.start_date ASC, e.start_time ASC NULLS LAST`;

    const eventsResult = await query(eventsQuery, params);

    // جلب الأحداث المشتركة أيضاً (من تدريسيين آخرين)
    let sharedEventsQuery = `
      SELECT 
        e.id,
        e.teacher_id,
        e.title,
        e.description,
        e.event_type,
        e.event_category,
        e.start_date,
        e.end_date,
        e.start_time,
        e.end_time,
        e.all_day,
        e.location,
        e.lecture_id,
        e.subject_id,
        e.color,
        e.priority,
        e.status,
        e.is_shared_with_students,
        e.is_shared_with_teachers,
        e.shared_with_departments,
        e.shared_with_stages,
        e.shared_with_study_types,
        e.exam_type,
        e.exam_duration_minutes,
        e.is_recurring,
        e.recurrence_pattern,
        e.notes,
        e.created_at,
        e.updated_at,
        ts.material_name as subject_name,
        l.topic as lecture_topic,
        l.lecture_date as lecture_date,
        l.lecture_time as lecture_time,
        t.full_name_ar as teacher_name
      FROM examination_committee.calendar_events e
      LEFT JOIN examination_committee.teaching_subjects ts ON e.subject_id = ts.id
      LEFT JOIN examination_committee.lectures l ON e.lecture_id = l.id
      LEFT JOIN hr.teachers t ON e.teacher_id = t.id
      WHERE e.teacher_id != $1
        AND (e.is_shared_with_teachers = TRUE OR e.visibility = 'public')
    `;

    const sharedParams: (string | null)[] = [teacherId];
    let sharedParamIndex = 2;

    if (startDate) {
      sharedEventsQuery += ` AND (e.end_date >= $${sharedParamIndex} OR e.end_date IS NULL AND e.start_date >= $${sharedParamIndex})`;
      sharedParams.push(startDate);
      sharedParamIndex++;
    }
    if (endDate) {
      sharedEventsQuery += ` AND e.start_date <= $${sharedParamIndex}`;
      sharedParams.push(endDate);
      sharedParamIndex++;
    }

    if (eventType && eventType !== 'all') {
      sharedEventsQuery += ` AND e.event_type = $${sharedParamIndex}`;
      sharedParams.push(eventType);
      sharedParamIndex++;
    }

    sharedEventsQuery += ` ORDER BY e.start_date ASC, e.start_time ASC NULLS LAST`;

    const sharedEventsResult = await query(sharedEventsQuery, sharedParams);

    // دمج الأحداث
    const allEvents = [
      ...eventsResult.rows.map((row: any) => ({ ...row, is_owner: true })),
      ...sharedEventsResult.rows.map((row: any) => ({ ...row, is_owner: false }))
    ];

    return NextResponse.json({
      success: true,
      data: allEvents
    });

  } catch (error: unknown) {
    console.error('خطأ في جلب الأحداث:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في جلب الأحداث: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

// POST - إنشاء حدث جديد
export async function POST(request: NextRequest) {
  try {
    // التحقق من المصادقة
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

    // جلب معرف التدريسي
    const teacherQuery = `
      SELECT id as teacher_id
      FROM hr.teachers
      WHERE user_id = $1 AND status = 'active'
      LIMIT 1
    `;
    const teacherResult = await query(teacherQuery, [user.id]);

    if (teacherResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'التدريسي غير موجود' },
        { status: 404 }
      );
    }

    const teacherId = teacherResult.rows[0].teacher_id;

    const body = await request.json();
    const {
      title,
      description,
      event_type,
      event_category,
      start_date,
      end_date,
      start_time,
      end_time,
      all_day,
      location,
      lecture_id,
      subject_id,
      color,
      priority,
      reminder_minutes,
      is_shared_with_students,
      is_shared_with_teachers,
      shared_with_departments,
      shared_with_stages,
      shared_with_study_types,
      exam_type,
      exam_duration_minutes,
      notes,
      is_recurring,
      recurrence_pattern,
      recurrence_end_date,
      recurrence_count,
      visibility
    } = body;

    // التحقق من البيانات المطلوبة
    if (!title || !event_type || !start_date) {
      return NextResponse.json(
        { success: false, error: 'العنوان، نوع الحدث، وتاريخ البداية مطلوبان' },
        { status: 400 }
      );
    }

    // إنشاء الحدث
    const insertQuery = `
      INSERT INTO examination_committee.calendar_events (
        teacher_id,
        title,
        description,
        event_type,
        event_category,
        start_date,
        end_date,
        start_time,
        end_time,
        all_day,
        location,
        lecture_id,
        subject_id,
        color,
        priority,
        reminder_minutes,
        is_shared_with_students,
        is_shared_with_teachers,
        shared_with_departments,
        shared_with_stages,
        shared_with_study_types,
        exam_type,
        exam_duration_minutes,
        notes,
        is_recurring,
        recurrence_pattern,
        recurrence_end_date,
        recurrence_count,
        visibility,
        created_by,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, NOW(), NOW()
      )
      RETURNING id, title, event_type, start_date, created_at
    `;

    const result = await query(insertQuery, [
      teacherId,
      title || null,
      description || null,
      event_type,
      event_category || null,
      start_date,
      end_date || start_date,
      start_time || null,
      end_time || null,
      all_day || false,
      location || null,
      lecture_id || null,
      subject_id || null,
      color || '#DC2626',
      priority || 'normal',
      reminder_minutes || null,
      is_shared_with_students || false,
      is_shared_with_teachers || false,
      shared_with_departments || null,
      shared_with_stages || null,
      shared_with_study_types || null,
      exam_type || null,
      exam_duration_minutes || null,
      notes || null,
      is_recurring || false,
      recurrence_pattern || null,
      recurrence_end_date || null,
      recurrence_count || null,
      visibility || 'private',
      user.id
    ]);

    return NextResponse.json({
      success: true,
      data: result.rows[0],
      message: 'تم إنشاء الحدث بنجاح'
    });

  } catch (error: unknown) {
    console.error('خطأ في إنشاء الحدث:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في إنشاء الحدث: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

