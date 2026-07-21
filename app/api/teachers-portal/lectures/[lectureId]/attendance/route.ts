import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ lectureId: string }> }
) {
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

    const { lectureId } = await params;
    console.log('جاري جلب بيانات المحاضرة:', lectureId);

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
        ts.material_name as subject_name,
        ts.department,
        ts.stage,
        ts.study_type,
        ts.academic_year,
        ts.semester
      FROM examination_committee.lectures l
      JOIN examination_committee.teaching_subjects ts ON l.subject_id = ts.id
      WHERE l.id = $1
    `;

    const lectureResult = await query(lectureQuery, [lectureId]);

    if (lectureResult.rows.length === 0) {
      console.error(`المحاضرة غير موجودة: lectureId = ${lectureId}`);
      return NextResponse.json(
        { 
          success: false, 
          error: `المحاضرة غير موجودة. lectureId: ${lectureId}`,
          details: process.env.NODE_ENV === 'development' ? `لم يتم العثور على محاضرة بالمعرف: ${lectureId}` : undefined
        },
        { status: 404 }
      );
    }

    const lecture = lectureResult.rows[0];

    // جلب الطلاب المطابقين للمادة
    const studentsQuery = `
      SELECT 
        s.id as student_id,
        s.university_id,
        COALESCE(s.full_name_ar, s.full_name, CONCAT_WS(' ', s.first_name, s.last_name)) as full_name_ar,
        COALESCE(s.full_name, CONCAT_WS(' ', s.first_name, s.last_name)) as full_name
      FROM student_affairs.students s
      WHERE s.major = $1
        AND LOWER(COALESCE(s.admission_type, '')) = LOWER($2)
        AND LOWER(COALESCE(s.study_type, 'morning')) = LOWER($3)
        AND COALESCE(s.academic_year, '') = $4
        AND s.status = 'active'
      ORDER BY s.full_name_ar ASC, s.full_name ASC
    `;

    const studentsResult = await query(studentsQuery, [
      lecture.department,
      lecture.stage,
      lecture.study_type,
      lecture.academic_year
    ]);

    // جلب سجلات الحضور والغياب الموجودة
    let attendanceRecords: Record<string, any> = {};
    
    try {
      const attendanceQuery = `
        SELECT 
          student_id,
          status,
          arrival_time,
          notes,
          created_at
        FROM examination_committee.attendance_records
        WHERE lecture_id = $1
      `;

      const attendanceResult = await query(attendanceQuery, [lectureId]);
      attendanceResult.rows.forEach((row) => {
        attendanceRecords[row.student_id] = {
          status: row.status,
          arrival_time: row.arrival_time,
          notes: row.notes,
          created_at: row.created_at
        };
      });
    } catch {
      // إذا لم يكن الجدول موجوداً، نرجع سجلات فارغة
      attendanceRecords = {};
    }

    // دمج بيانات الطلاب مع سجلات الحضور
    const studentsWithAttendance = studentsResult.rows.map((student) => {
      const attendance = attendanceRecords[student.student_id] || null;
      return {
        student_id: student.student_id,
        university_id: student.university_id,
        full_name_ar: student.full_name_ar || student.full_name,
        full_name: student.full_name || student.full_name_ar,
        attendance_status: attendance?.status || null,
        arrival_time: attendance?.arrival_time || null,
        attendance_notes: attendance?.notes || null
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        lecture: {
          id: lecture.id,
          subject_id: lecture.subject_id,
          subject_name: lecture.subject_name,
          lecture_date: lecture.lecture_date,
          lecture_time: lecture.lecture_time,
          duration_minutes: lecture.duration_minutes,
          topic: lecture.topic,
          location: lecture.location,
          notes: lecture.notes,
          department: lecture.department,
          stage: lecture.stage,
          study_type: lecture.study_type,
          academic_year: lecture.academic_year,
          semester: lecture.semester
        },
        students: studentsWithAttendance
      }
    });

  } catch (error: unknown) {
    console.error('خطأ في جلب بيانات الحضور:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في جلب بيانات الحضور: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ lectureId: string }> }
) {
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

    const { lectureId } = await params;
    const body = await request.json();
    const { student_id, status, arrival_time, notes } = body;

    // التحقق من البيانات المطلوبة
    if (!student_id || !status) {
      return NextResponse.json(
        { success: false, error: 'رقم الطالب وحالة الحضور مطلوبان' },
        { status: 400 }
      );
    }

    // التحقق من صحة حالة الحضور
    if (!['present', 'absent', 'excused'].includes(status)) {
      return NextResponse.json(
        { success: false, error: 'حالة الحضور غير صحيحة' },
        { status: 400 }
      );
    }

    // حفظ أو تحديث سجل الحضور
    const upsertQuery = `
      INSERT INTO examination_committee.attendance_records (
        lecture_id,
        student_id,
        status,
        arrival_time,
        notes,
        recorded_by,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (lecture_id, student_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        arrival_time = EXCLUDED.arrival_time,
        notes = EXCLUDED.notes,
        recorded_by = EXCLUDED.recorded_by,
        updated_at = NOW()
      RETURNING id, status, arrival_time, notes, created_at, updated_at
    `;

    const result = await query(upsertQuery, [
      lectureId,
      student_id,
      status,
      arrival_time || null,
      notes || null,
      user.id
    ]);

    return NextResponse.json({
      success: true,
      data: {
        attendance_id: result.rows[0].id,
        status: result.rows[0].status,
        arrival_time: result.rows[0].arrival_time,
        notes: result.rows[0].notes
      },
      message: 'تم حفظ حالة الحضور بنجاح'
    });

  } catch (error: unknown) {
    console.error('خطأ في حفظ حالة الحضور:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في حفظ حالة الحضور: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

