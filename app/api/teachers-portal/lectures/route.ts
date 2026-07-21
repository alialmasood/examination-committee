import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';

// GET - جلب جميع المحاضرات المحفوظة للتدريسي
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

    // التحقق من وجود جدول lectures
    let hasLecturesTable = false;
    try {
      const checkTableQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'examination_committee' 
          AND table_name = 'lectures'
      `;
      const tableCheck = await query(checkTableQuery, []);
      hasLecturesTable = tableCheck.rows.length > 0;
    } catch {
      hasLecturesTable = false;
    }

    if (!hasLecturesTable) {
      return NextResponse.json({
        success: true,
        data: []
      });
    }

    // التحقق من وجود عمود teacher_id في جدول teaching_subjects
    let hasTeacherIdColumn = false;
    try {
      const checkColumnQuery = `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'examination_committee'
          AND table_name = 'teaching_subjects'
          AND column_name = 'teacher_id'
      `;
      const columnCheck = await query(checkColumnQuery, []);
      hasTeacherIdColumn = columnCheck.rows.length > 0;
    } catch {
      hasTeacherIdColumn = false;
    }

    // بناء استعلام لجلب المحاضرات
    let lecturesQuery = '';
    if (hasTeacherIdColumn) {
      // استخدام teacher_id إذا كان موجوداً
      lecturesQuery = `
        SELECT 
          l.id,
          l.subject_id,
          l.lecture_date,
          l.lecture_time,
          l.duration_minutes,
          l.topic,
          l.location,
          l.notes,
          l.created_at,
          l.updated_at,
          ts.material_name as subject_name,
          ts.department,
          ts.stage,
          ts.study_type,
          ts.academic_year,
          ts.semester,
          COALESCE(ts.instructor_name, '') as instructor_name
        FROM examination_committee.lectures l
        JOIN examination_committee.teaching_subjects ts ON l.subject_id = ts.id
        WHERE (ts.teacher_id = $1 OR ts.instructor_name = (SELECT full_name_ar FROM hr.teachers WHERE id = $1 LIMIT 1))
        ORDER BY l.lecture_date DESC, l.created_at DESC
      `;
    } else {
      // استخدام instructor_name فقط
      const teacherNameQuery = `
        SELECT full_name_ar
        FROM hr.teachers
        WHERE id = $1
        LIMIT 1
      `;
      const teacherNameResult = await query(teacherNameQuery, [teacherId]);
      
      if (teacherNameResult.rows.length === 0) {
        return NextResponse.json({
          success: true,
          data: []
        });
      }

      const teacherName = teacherNameResult.rows[0].full_name_ar;

      lecturesQuery = `
        SELECT 
          l.id,
          l.subject_id,
          l.lecture_date,
          l.lecture_time,
          l.duration_minutes,
          l.topic,
          l.location,
          l.notes,
          l.created_at,
          l.updated_at,
          ts.material_name as subject_name,
          ts.department,
          ts.stage,
          ts.study_type,
          ts.academic_year,
          ts.semester,
          COALESCE(ts.instructor_name, '') as instructor_name
        FROM examination_committee.lectures l
        JOIN examination_committee.teaching_subjects ts ON l.subject_id = ts.id
        WHERE ts.instructor_name = $1
        ORDER BY l.lecture_date DESC, l.created_at DESC
      `;
    }

    // تنفيذ الاستعلام
    let lecturesResult;
    if (hasTeacherIdColumn) {
      lecturesResult = await query(lecturesQuery, [teacherId]);
    } else {
      // جلب اسم التدريسي مرة أخرى للاستخدام في الاستعلام
      const teacherNameQuery = `
        SELECT full_name_ar
        FROM hr.teachers
        WHERE id = $1
        LIMIT 1
      `;
      const teacherNameResult = await query(teacherNameQuery, [teacherId]);
      
      if (teacherNameResult.rows.length === 0) {
        return NextResponse.json({
          success: true,
          data: []
        });
      }

      const teacherName = teacherNameResult.rows[0].full_name_ar;
      lecturesResult = await query(lecturesQuery, [teacherName]);
    }

    // جلب إحصائيات الحضور لكل محاضرة
    const lecturesWithStats = await Promise.all(
      lecturesResult.rows.map(async (lecture) => {
        let attendanceStats = {
          total: 0,
          present: 0,
          absent: 0,
          excused: 0
        };

        try {
          const statsQuery = `
            SELECT 
              COUNT(*) as total,
              COUNT(*) FILTER (WHERE status = 'present') as present,
              COUNT(*) FILTER (WHERE status = 'absent') as absent,
              COUNT(*) FILTER (WHERE status = 'excused') as excused
            FROM examination_committee.attendance_records
            WHERE lecture_id = $1
          `;
          const statsResult = await query(statsQuery, [lecture.id]);
          if (statsResult.rows.length > 0) {
            attendanceStats = {
              total: Number(statsResult.rows[0].total) || 0,
              present: Number(statsResult.rows[0].present) || 0,
              absent: Number(statsResult.rows[0].absent) || 0,
              excused: Number(statsResult.rows[0].excused) || 0
            };
          }
        } catch {
          attendanceStats = { total: 0, present: 0, absent: 0, excused: 0 };
        }

        return {
          id: lecture.id,
          subject_id: lecture.subject_id,
          subject_name: lecture.subject_name,
          department: lecture.department,
          stage: lecture.stage,
          study_type: lecture.study_type,
          academic_year: lecture.academic_year,
          semester: lecture.semester,
          lecture_date: lecture.lecture_date,
          lecture_time: lecture.lecture_time,
          duration_minutes: lecture.duration_minutes,
          topic: lecture.topic,
          location: lecture.location,
          notes: lecture.notes,
          created_at: lecture.created_at,
          updated_at: lecture.updated_at,
          attendance_stats: attendanceStats
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: lecturesWithStats
    });

  } catch (error: unknown) {
    console.error('خطأ في جلب المحاضرات:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في جلب المحاضرات: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

// POST - إنشاء محاضرة جديدة
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

    const body = await request.json();
    const { subject_id, lecture_date, lecture_time, duration_minutes, topic, location, notes } = body;

    // التحقق من البيانات المطلوبة
    if (!subject_id || !lecture_date) {
      return NextResponse.json(
        { success: false, error: 'معرف المادة وتاريخ المحاضرة مطلوبان' },
        { status: 400 }
      );
    }

    // التحقق من وجود جدول lectures
    let hasLecturesTable = false;
    try {
      const checkTableQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'examination_committee' 
          AND table_name = 'lectures'
      `;
      const tableCheck = await query(checkTableQuery, []);
      hasLecturesTable = tableCheck.rows.length > 0;
    } catch {
      hasLecturesTable = false;
    }

    if (!hasLecturesTable) {
      return NextResponse.json(
        { success: false, error: 'جدول المحاضرات غير موجود في قاعدة البيانات' },
        { status: 500 }
      );
    }

    // إنشاء المحاضرة
    const insertQuery = `
      INSERT INTO examination_committee.lectures (
        subject_id,
        lecture_date,
        lecture_time,
        duration_minutes,
        topic,
        location,
        notes,
        created_by,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING id, lecture_date, lecture_time, duration_minutes, topic, location, notes
    `;

    const result = await query(insertQuery, [
      subject_id,
      lecture_date,
      lecture_time || null,
      duration_minutes || 90,
      topic || null,
      location || null,
      notes || null,
      user.id
    ]);

    const lecture = result.rows[0];

    console.log('تم إنشاء المحاضرة بنجاح:', lecture.id);

    return NextResponse.json({
      success: true,
      data: {
        lecture_id: lecture.id,
        lecture_date: lecture.lecture_date,
        lecture_time: lecture.lecture_time,
        duration_minutes: lecture.duration_minutes,
        topic: lecture.topic,
        location: lecture.location,
        notes: lecture.notes
      },
      message: 'تم إنشاء المحاضرة بنجاح'
    });

  } catch (error: unknown) {
    console.error('خطأ في إنشاء المحاضرة:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في إنشاء المحاضرة: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}
