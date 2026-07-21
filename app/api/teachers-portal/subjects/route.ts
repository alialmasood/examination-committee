import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';

interface TeacherSubject {
  subject_id: string;
  subject_name: string;
  department: string;
  stage: string;
  study_type: string;
  academic_year: string;
  semester: string;
  units: number | null;
  student_count?: number;
}

interface Teacher {
  id: string;
  full_name: string;
  full_name_ar: string;
  department: string;
}

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

    // جلب معلومات التدريسي
    const teacherResult = await query(
      `SELECT id, full_name, full_name_ar, department 
       FROM hr.teachers 
       WHERE user_id = $1 AND status = 'active'`,
      [user.id]
    );

    if (teacherResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'التدريسي غير موجود أو غير نشط' },
        { status: 404 }
      );
    }

    const teacher = teacherResult.rows[0] as Teacher;

    // جلب المواد الدراسية للتدريسي
    let subjectsQuery = '';
    let subjectsParams: (string | null)[] = [];

    // التحقق من وجود عمود teacher_id
    const checkColumnQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'examination_committee' 
        AND table_name = 'teaching_subjects' 
        AND column_name = 'teacher_id'
    `;
    const columnCheck = await query(checkColumnQuery, []);
    const hasTeacherIdColumn = columnCheck.rows.length > 0;

    if (hasTeacherIdColumn) {
      // استخدام teacher_id إذا كان موجوداً
      subjectsQuery = `
        SELECT DISTINCT
          ts.id as subject_id,
          ts.material_name as subject_name,
          ts.department,
          ts.stage,
          ts.study_type,
          ts.academic_year,
          ts.semester,
          ts.units
        FROM examination_committee.teaching_subjects ts
        WHERE ts.teacher_id = $1
          AND ts.stage IS NOT NULL
          AND ts.study_type IS NOT NULL
          AND ts.academic_year IS NOT NULL
        ORDER BY 
          ts.academic_year DESC,
          ts.semester ASC,
          ts.stage ASC,
          ts.study_type ASC,
          ts.material_name ASC
      `;
      subjectsParams = [teacher.id];
    } else {
      // استخدام instructor_name للتوافق مع البيانات القديمة
      subjectsQuery = `
        SELECT DISTINCT
          ts.id as subject_id,
          ts.material_name as subject_name,
          ts.department,
          ts.stage,
          ts.study_type,
          ts.academic_year,
          ts.semester,
          ts.units
        FROM examination_committee.teaching_subjects ts
        WHERE (ts.instructor_name = $1 OR ts.instructor_name = $2)
          AND ts.stage IS NOT NULL
          AND ts.study_type IS NOT NULL
          AND ts.academic_year IS NOT NULL
        ORDER BY 
          ts.academic_year DESC,
          ts.semester ASC,
          ts.stage ASC,
          ts.study_type ASC,
          ts.material_name ASC
      `;
      subjectsParams = [teacher.full_name_ar, teacher.full_name];
    }

    const subjectsResult = await query(subjectsQuery, subjectsParams);

    // جلب عدد الطلاب لكل مادة
    const subjects: TeacherSubject[] = await Promise.all(
      subjectsResult.rows.map(async (row) => {
        // حساب عدد الطلاب لكل مادة
        const studentsCountQuery = `
          SELECT COUNT(*) as count
          FROM student_affairs.students s
          WHERE s.major = $1
            AND LOWER(COALESCE(s.admission_type, '')) = LOWER($2)
            AND LOWER(COALESCE(s.study_type, 'morning')) = LOWER($3)
            AND COALESCE(s.academic_year, '') = $4
            AND s.status = 'active'
        `;

        const countResult = await query(studentsCountQuery, [
          row.department,
          row.stage,
          row.study_type,
          row.academic_year
        ]);

        return {
          subject_id: row.subject_id,
          subject_name: row.subject_name,
          department: row.department,
          stage: row.stage || 'first',
          study_type: row.study_type || 'morning',
          academic_year: row.academic_year,
          semester: row.semester,
          units: row.units ? Number(row.units) : null,
          student_count: countResult.rows[0]?.count ? Number(countResult.rows[0].count) : 0
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: subjects,
      teacher: {
        id: teacher.id,
        full_name: teacher.full_name,
        full_name_ar: teacher.full_name_ar,
        department: teacher.department
      }
    });

  } catch (error: unknown) {
    console.error('خطأ في جلب المواد الدراسية:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    const errorDetails = error instanceof Error ? error.stack : String(error);
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في جلب المواد الدراسية: ${errorMessage}`,
        details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
      },
      { status: 500 }
    );
  }
}

