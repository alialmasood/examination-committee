import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ subjectId: string }> }
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

    const { subjectId } = await params;

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
        data: [],
        message: 'لا توجد محاضرات محفوظة'
      });
    }

    // جلب المحاضرات للمادة الدراسية
    const lecturesQuery = `
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
        ts.material_name as subject_name
      FROM examination_committee.lectures l
      JOIN examination_committee.teaching_subjects ts ON l.subject_id = ts.id
      WHERE l.subject_id = $1
      ORDER BY l.lecture_date DESC, l.created_at DESC
    `;

    const lecturesResult = await query(lecturesQuery, [subjectId]);

    // جلب عدد الطلاب المسجلين في الحضور لكل محاضرة
    const lecturesWithStats = await Promise.all(
      lecturesResult.rows.map(async (lecture) => {
        // حساب إحصائيات الحضور
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
          // إذا لم يكن جدول attendance_records موجوداً
          attendanceStats = { total: 0, present: 0, absent: 0, excused: 0 };
        }

        return {
          id: lecture.id,
          subject_id: lecture.subject_id,
          subject_name: lecture.subject_name,
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

