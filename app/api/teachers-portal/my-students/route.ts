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

interface Student {
  id: string;
  university_id: string;
  full_name_ar: string;
  full_name: string;
  phone?: string;
  email?: string;
  subject_id: string;
  subject_name: string;
}

interface SubjectStudents {
  subject: TeacherSubject;
  students: Student[];
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

    // التحقق من وجود عمود teacher_id أولاً
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
      // في حالة الخطأ، نفترض أن العمود غير موجود
      hasTeacherIdColumn = false;
    }

    // جلب جميع المواد الدراسية المرتبطة بالتدريسي
    // البحث إما عن طريق teacher_id (إذا كان موجوداً) أو instructor_name
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
      // في حالة عدم وجود teacher_id، نستخدم instructor_name فقط
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
        message: 'لا توجد مواد دراسية مرتبطة بهذا التدريسي. يرجى التأكد من ربط المواد الدراسية بالتدريسي في صفحات إدارة المواد.'
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

    // لكل مادة دراسية، جلب الطلاب المطابقين
    const result: SubjectStudents[] = [];

    for (const subject of subjects) {
      // البحث عن الطلاب المطابقين للمواصفات:
      // - نفس القسم (major = department)
      // - نفس المرحلة (admission_type = stage)
      // - نفس نوع الدراسة (study_type)
      // - نفس السنة الأكاديمية (academic_year)
      // - الطلاب النشطون فقط
      const studentsQuery = `
        SELECT 
          s.id,
          s.university_id,
          COALESCE(s.full_name_ar, s.full_name, CONCAT_WS(' ', s.first_name, s.last_name)) as full_name_ar,
          COALESCE(s.full_name, CONCAT_WS(' ', s.first_name, s.last_name)) as full_name,
          s.phone,
          s.email
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

      const students: Student[] = studentsResult.rows.map((row) => ({
        id: row.id,
        university_id: row.university_id,
        full_name_ar: row.full_name_ar || row.full_name,
        full_name: row.full_name || row.full_name_ar,
        phone: row.phone || undefined,
        email: row.email || undefined,
        subject_id: subject.subject_id,
        subject_name: subject.subject_name
      }));

      // إضافة المادة مع طلابها فقط إذا كان هناك طلاب
      if (students.length > 0) {
        result.push({
          subject,
          students
        });
      }
    }

    // إرجاع النتيجة حتى لو لم تكن هناك مواد دراسية أو طلاب
    return NextResponse.json({
      success: true,
      data: result,
      teacher: {
        id: teacher.id,
        full_name: teacher.full_name,
        full_name_ar: teacher.full_name_ar,
        department: teacher.department
      },
      message: result.length === 0 
        ? 'لا توجد مواد دراسية مرتبطة بهذا التدريسي أو لا توجد طلاب مسجلين في المواد'
        : `تم العثور على ${result.length} مادة دراسية`
    });
  } catch (error: unknown) {
    console.error('خطأ في جلب طلاب التدريسي:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    const errorDetails = error instanceof Error ? error.stack : String(error);
    
    console.error('تفاصيل الخطأ:', errorDetails);
    
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في جلب بيانات الطلاب: ${errorMessage}`,
        details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
      },
      { status: 500 }
    );
  }
}

