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
}

interface StudentGrade {
  student_id: string;
  university_id: string;
  full_name_ar: string;
  full_name: string;
  month1_score: number | null;
  month2_score: number | null;
  month3_score: number | null;
  semester_attendance_score: number | null;
  help_score?: number | null; // مساعدة
  notes: string | null;
  grade_id?: string;
}

interface SubjectWithGrades {
  subject: TeacherSubject;
  students: StudentGrade[];
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

    // التحقق من صحة Access Token
    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'رمز المصادقة غير صالح أو منتهي الصلاحية' },
        { status: 401 }
      );
    }

    // التحقق من وجود المستخدم
    const user = await validateUser(payload.user_id);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود أو غير نشط' },
        { status: 401 }
      );
    }

    const userId = user.id;

    // جلب بيانات التدريسي المرتبط بالمستخدم
    const teacherQuery = `
      SELECT id, full_name, full_name_ar, department
      FROM hr.teachers
      WHERE user_id = $1 AND status = 'active'
      LIMIT 1
    `;

    const teacherResult = await query(teacherQuery, [userId]);

    if (teacherResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'التدريسي غير موجود أو غير نشط' },
        { status: 404 }
      );
    }

    const teacher = teacherResult.rows[0];
    const teacherId = teacher.id;

    // التحقق من وجود عمود teacher_id
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

    // جلب جميع المواد الدراسية المرتبطة بالتدريسي
    let subjectsQuery: string;
    let subjectsParams: (string | null)[];
    
    if (hasTeacherIdColumn) {
      subjectsQuery = `
        SELECT 
          ts.id as subject_id,
          ts.material_name as subject_name,
          ts.department,
          ts.stage,
          ts.study_type,
          ts.academic_year,
          ts.semester,
          ts.units
        FROM examination_committee.teaching_subjects ts
        WHERE (ts.teacher_id = $1 OR ts.instructor_name = $2 OR ts.instructor_name = $3)
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
      subjectsParams = [teacherId, teacher.full_name_ar, teacher.full_name];
    } else {
      subjectsQuery = `
        SELECT 
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

    if (subjectsResult.rows.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        teacher: {
          id: teacher.id,
          full_name: teacher.full_name,
          full_name_ar: teacher.full_name_ar,
          department: teacher.department
        },
        message: 'لا توجد مواد دراسية مرتبطة بهذا التدريسي'
      });
    }

    const subjects: TeacherSubject[] = subjectsResult.rows.map((row) => ({
      subject_id: row.subject_id,
      subject_name: row.subject_name,
      department: row.department,
      stage: row.stage || 'first',
      study_type: row.study_type || 'morning',
      academic_year: row.academic_year,
      semester: row.semester,
      units: row.units ? Number(row.units) : null
    }));

    // لكل مادة دراسية، جلب الطلاب مع درجاتهم
    const result: SubjectWithGrades[] = [];

    for (const subject of subjects) {
      // جلب الطلاب المطابقين للمواصفات
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
        subject.department,
        subject.stage,
        subject.study_type,
        subject.academic_year
      ]);

      if (studentsResult.rows.length === 0) {
        continue; // تخطي المادة إذا لم يكن هناك طلاب
      }

      // جلب درجات الطلاب من جدول monthly_exams
      const studentIds = studentsResult.rows.map((row) => row.student_id);
      
      // التحقق من وجود جدول monthly_exams أولاً
      let hasMonthlyExamsTable = false;
      try {
        const checkTableQuery = `
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'examination_committee' 
            AND table_name = 'monthly_exams'
        `;
        const tableCheck = await query(checkTableQuery, []);
        hasMonthlyExamsTable = tableCheck.rows.length > 0;
      } catch {
        hasMonthlyExamsTable = false;
      }

      let gradesResult: { rows: any[] } = { rows: [] };
      
      if (hasMonthlyExamsTable && studentIds.length > 0) {
        const placeholders = studentIds.map((_: unknown, i: number) => `$${i + 4}`).join(', ');

        const gradesQuery = `
          SELECT 
            me.student_id,
            me.month1_total_score,
            me.month2_total_score,
            me.month3_total_score,
            me.semester_attendance_score,
            me.help_score,
            me.notes,
            me.id as grade_id
          FROM examination_committee.monthly_exams me
          WHERE me.subject_id = $1
            AND me.academic_year = $2
            AND me.semester = $3
            AND me.student_id IN (${placeholders})
        `;

        const gradesParams = [
          subject.subject_id,
          subject.academic_year,
          subject.semester,
          ...studentIds
        ];

        try {
          gradesResult = await query(gradesQuery, gradesParams);
        } catch (error) {
          console.error('خطأ في جلب الدرجات:', error);
          gradesResult = { rows: [] };
        }
      }

      // إنشاء خريطة للدرجات حسب student_id
      const gradesMap = new Map<string, any>();
      gradesResult.rows.forEach((row: any) => {
        gradesMap.set(row.student_id, {
          month1_score: row.month1_total_score ? Number(row.month1_total_score) : null,
          month2_score: row.month2_total_score ? Number(row.month2_total_score) : null,
          month3_score: row.month3_total_score ? Number(row.month3_total_score) : null,
          semester_attendance_score: row.semester_attendance_score ? Number(row.semester_attendance_score) : null,
          help_score: row.help_score ? Number(row.help_score) : null,
          notes: row.notes || null,
          grade_id: row.grade_id || null
        });
      });

      // دمج بيانات الطلاب مع درجاتهم
      const studentsWithGrades: StudentGrade[] = studentsResult.rows.map((row) => {
        const grade = gradesMap.get(row.student_id) || {
          month1_score: null,
          month2_score: null,
          month3_score: null,
          semester_attendance_score: null,
          help_score: null,
          notes: null,
          grade_id: null
        };

        return {
          student_id: row.student_id,
          university_id: row.university_id,
          full_name_ar: row.full_name_ar || row.full_name,
          full_name: row.full_name || row.full_name_ar,
          month1_score: grade.month1_score,
          month2_score: grade.month2_score,
          month3_score: grade.month3_score,
          semester_attendance_score: grade.semester_attendance_score,
          help_score: grade.help_score,
          notes: grade.notes,
          grade_id: grade.grade_id
        };
      });

      result.push({
        subject,
        students: studentsWithGrades
      });
    }

    return NextResponse.json({
      success: true,
      data: result,
      teacher: {
        id: teacher.id,
        full_name: teacher.full_name,
        full_name_ar: teacher.full_name_ar,
        department: teacher.department
      }
    });
  } catch (error: unknown) {
    console.error('خطأ في جلب درجات الطلاب:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    const errorDetails = error instanceof Error ? error.stack : String(error);
    
    console.error('تفاصيل الخطأ:', errorDetails);
    
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في جلب بيانات الدرجات: ${errorMessage}`,
        details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
      },
      { status: 500 }
    );
  }
}

