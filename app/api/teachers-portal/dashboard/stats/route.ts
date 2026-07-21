import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';

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
        data: {
          totalStudents: 0,
          totalSubjects: 0,
          todayLectures: 0,
          upcomingExams: 0,
          recentLectures: []
        }
      });
    }

    const teacherId = teacherResult.rows[0].teacher_id;

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

    // بناء استعلام لجلب المواد الدراسية
    let subjectsResult: { rows: any[] };
    
    if (hasTeacherIdColumn) {
      const subjectsQuery = `
        SELECT DISTINCT id, material_name, department, stage, study_type, academic_year
        FROM examination_committee.teaching_subjects
        WHERE teacher_id = $1
      `;
      subjectsResult = await query(subjectsQuery, [teacherId]);
    } else {
      // Fallback للـ instructor_name إذا لم يكن teacher_id موجوداً
      const teacherNameQuery = `
        SELECT full_name_ar, full_name
        FROM hr.teachers
        WHERE id = $1
      `;
      const teacherNameResult = await query(teacherNameQuery, [teacherId]);
      if (teacherNameResult.rows.length === 0) {
        return NextResponse.json({
          success: true,
          data: {
            totalStudents: 0,
            totalSubjects: 0,
            todayLectures: 0,
            upcomingExams: 0,
            recentLectures: []
          }
        });
      }
      const instructorName = teacherNameResult.rows[0].full_name_ar || teacherNameResult.rows[0].full_name;
      const subjectsQuery = `
        SELECT DISTINCT id, material_name, department, stage, study_type, academic_year
        FROM examination_committee.teaching_subjects
        WHERE instructor_name = $1
      `;
      subjectsResult = await query(subjectsQuery, [instructorName]);
    }

    const subjects = subjectsResult.rows || [];
    const totalSubjects = subjects.length;

    // حساب إجمالي عدد الطلاب المميزين (DISTINCT) عبر جميع المواد
    // لضمان عدم حساب نفس الطالب عدة مرات إذا كان يدرس عدة مواد
    let totalStudents = 0;
    if (subjects.length > 0) {
      // بناء قائمة الشروط لكل مادة
      const studentConditions: string[] = [];
      const studentParams: (string | null)[] = [];
      let paramIndex = 1;

      for (const subject of subjects) {
        const conditions = [
          `s.major = $${paramIndex++}`,
          `LOWER(COALESCE(s.admission_type, '')) = LOWER($${paramIndex++})`,
          `LOWER(COALESCE(s.study_type, 'morning')) = LOWER($${paramIndex++})`,
          `COALESCE(s.academic_year, '') = $${paramIndex++}`
        ].join(' AND ');
        
        studentConditions.push(`(${conditions})`);
        studentParams.push(
          subject.department,
          subject.stage || '',
          subject.study_type || 'morning',
          subject.academic_year || ''
        );
      }

      // حساب عدد الطلاب المميزين الذين يطابقون أي من الشروط
      const totalStudentsQuery = `
        SELECT COUNT(DISTINCT s.id) as count
        FROM student_affairs.students s
        WHERE s.status = 'active'
          AND (${studentConditions.join(' OR ')})
      `;
      
      const totalStudentsResult = await query(totalStudentsQuery, studentParams);
      totalStudents = totalStudentsResult.rows[0]?.count ? Number(totalStudentsResult.rows[0].count) : 0;
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

    let todayLectures = 0;
    let recentLectures: any[] = [];

    if (hasLecturesTable && subjects.length > 0) {
      const subjectIds = subjects.map((s: any) => s.id);
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      // محاضرات اليوم
      const todayLecturesQuery = `
        SELECT COUNT(*) as count
        FROM examination_committee.lectures
        WHERE subject_id = ANY($1::uuid[])
          AND lecture_date = $2
      `;
      const todayLecturesResult = await query(todayLecturesQuery, [subjectIds, today]);
      todayLectures = todayLecturesResult.rows[0]?.count ? Number(todayLecturesResult.rows[0].count) : 0;

      // آخر 5 محاضرات
      const recentLecturesQuery = `
        SELECT 
          l.id,
          l.lecture_date,
          l.lecture_time,
          l.topic,
          ts.material_name as subject_name
        FROM examination_committee.lectures l
        JOIN examination_committee.teaching_subjects ts ON l.subject_id = ts.id
        WHERE l.subject_id = ANY($1::uuid[])
        ORDER BY l.lecture_date DESC, l.lecture_time DESC
        LIMIT 5
      `;
      const recentLecturesResult = await query(recentLecturesQuery, [subjectIds]);
      recentLectures = recentLecturesResult.rows || [];
    }

    // التحقق من وجود جدول calendar_events
    let hasCalendarEventsTable = false;
    try {
      const checkTableQuery = `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'examination_committee'
          AND table_name = 'calendar_events'
      `;
      const tableCheck = await query(checkTableQuery, []);
      hasCalendarEventsTable = tableCheck.rows.length > 0;
    } catch {
      hasCalendarEventsTable = false;
    }

    let upcomingExams = 0;
    if (hasCalendarEventsTable) {
      const today = new Date().toISOString().split('T')[0];
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      const nextWeekStr = nextWeek.toISOString().split('T')[0];

      const upcomingExamsQuery = `
        SELECT COUNT(*) as count
        FROM examination_committee.calendar_events
        WHERE teacher_id = $1
          AND event_type = 'exam'
          AND start_date >= $2
          AND start_date <= $3
          AND status = 'scheduled'
      `;
      const upcomingExamsResult = await query(upcomingExamsQuery, [teacherId, today, nextWeekStr]);
      upcomingExams = upcomingExamsResult.rows[0]?.count ? Number(upcomingExamsResult.rows[0].count) : 0;
    }

    return NextResponse.json({
      success: true,
      data: {
        totalStudents,
        totalSubjects,
        todayLectures,
        upcomingExams,
        recentLectures: recentLectures.map((lecture: any) => ({
          id: lecture.id,
          date: lecture.lecture_date,
          time: lecture.lecture_time,
          topic: lecture.topic,
          subject: lecture.subject_name
        }))
      }
    });

  } catch (error: unknown) {
    console.error('خطأ في جلب إحصائيات Dashboard:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في جلب الإحصائيات: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

