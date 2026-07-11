import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import ExcelJS from 'exceljs';

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
      SELECT id as teacher_id, full_name_ar, department
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

    const teacher = teacherResult.rows[0];
    const teacherId = teacher.teacher_id;

    // جلب معايير التقرير من query parameters
    const searchParams = request.nextUrl.searchParams;
    const reportType = searchParams.get('type'); // 'day', 'range', 'month', 'semester'
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const month = searchParams.get('month'); // YYYY-MM format
    const semester = searchParams.get('semester'); // 'first' or 'second'
    const academicYear = searchParams.get('academicYear');

    // تحديد نطاق التاريخ بناءً على نوع التقرير
    let dateFrom: string | null = null;
    let dateTo: string | null = null;

    if (reportType === 'day' && startDate) {
      dateFrom = startDate;
      dateTo = startDate;
    } else if (reportType === 'range' && startDate && endDate) {
      dateFrom = startDate;
      dateTo = endDate;
    } else if (reportType === 'month' && month) {
      const [year, monthNum] = month.split('-');
      dateFrom = `${year}-${monthNum}-01`;
      const lastDay = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
      dateTo = `${year}-${monthNum}-${lastDay}`;
    } else if (reportType === 'semester' && semester && academicYear) {
      if (semester === 'first') {
        dateFrom = `${academicYear}-09-01`;
        dateTo = `${academicYear}-12-31`;
      } else {
        dateFrom = `${parseInt(academicYear) + 1}-01-01`;
        dateTo = `${parseInt(academicYear) + 1}-06-30`;
      }
    }

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { success: false, error: 'معايير التقرير غير صحيحة' },
        { status: 400 }
      );
    }

    // جلب المحاضرات في النطاق المحدد
    let lecturesQuery = `
      SELECT 
        l.id,
        l.subject_id,
        l.lecture_date,
        l.lecture_time,
        l.topic,
        l.location,
        ts.material_name as subject_name,
        ts.department,
        ts.stage,
        ts.study_type,
        ts.academic_year,
        ts.semester
      FROM examination_committee.lectures l
      JOIN examination_committee.teaching_subjects ts ON l.subject_id = ts.id
      WHERE l.lecture_date >= $1 AND l.lecture_date <= $2
    `;

    // إضافة فلتر teacher_id إذا كان موجوداً
    const hasTeacherIdColumn = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'examination_committee' 
        AND table_name = 'teaching_subjects' 
        AND column_name = 'teacher_id'
      LIMIT 1
    `);

    let lectures;
    if (hasTeacherIdColumn.rows.length > 0) {
      lecturesQuery += ` AND (ts.teacher_id = $3 OR ts.instructor_name = $4)`;
      const lecturesResult = await query(lecturesQuery, [
        dateFrom,
        dateTo,
        teacherId,
        teacher.full_name_ar
      ]);
      lectures = lecturesResult.rows;
    } else {
      lecturesQuery += ` AND ts.instructor_name = $3`;
      const lecturesResult = await query(lecturesQuery, [
        dateFrom,
        dateTo,
        teacher.full_name_ar
      ]);
      lectures = lecturesResult.rows;
    }

    if (lectures.length === 0) {
      return NextResponse.json(
        { success: false, error: 'لا توجد محاضرات في النطاق المحدد' },
        { status: 404 }
      );
    }

    // جلب سجلات الحضور لكل محاضرة
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('تقرير الحضور والغياب');

    // إعداد الخطوط العربية
    worksheet.columns = [
      { width: 10, header: 'ت' },
      { width: 30, header: 'اسم الطالب' },
      { width: 15, header: 'الرقم الجامعي' },
      { width: 30, header: 'المادة الدراسية' },
      { width: 15, header: 'تاريخ المحاضرة' },
      { width: 15, header: 'وقت المحاضرة' },
      { width: 20, header: 'عنوان المحاضرة' },
      { width: 15, header: 'المكان' },
      { width: 15, header: 'الحالة' },
      { width: 15, header: 'وقت الوصول' },
      { width: 30, header: 'ملاحظات' }
    ];

    // رأس الجدول
    const headerRow = worksheet.getRow(1);
    headerRow.values = [
      'ت',
      'اسم الطالب',
      'الرقم الجامعي',
      'المادة الدراسية',
      'تاريخ المحاضرة',
      'وقت المحاضرة',
      'عنوان المحاضرة',
      'المكان',
      'الحالة',
      'وقت الوصول',
      'ملاحظات'
    ];
    headerRow.font = { bold: true, size: 12 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDC2626' }
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    let rowIndex = 2;
    let serialNumber = 1;

    for (const lecture of lectures) {
      // جلب الطلاب للمحاضرة
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

      // جلب سجلات الحضور
      const attendanceQuery = `
        SELECT 
          student_id,
          status,
          arrival_time,
          notes
        FROM examination_committee.attendance_records
        WHERE lecture_id = $1
      `;

      const attendanceResult = await query(attendanceQuery, [lecture.id]);
      const attendanceMap = new Map();
      attendanceResult.rows.forEach((row: any) => {
        attendanceMap.set(row.student_id, row);
      });

      // إضافة بيانات كل طالب
      for (const student of studentsResult.rows) {
        const attendance = attendanceMap.get(student.student_id);
        const statusLabel = attendance
          ? attendance.status === 'present'
            ? 'حاضر'
            : attendance.status === 'absent'
            ? 'غائب'
            : 'مجاز'
          : 'غير محدد';

        const row = worksheet.getRow(rowIndex);
        row.values = [
          serialNumber++,
          student.full_name_ar || student.full_name,
          student.university_id,
          lecture.subject_name,
          new Date(lecture.lecture_date).toLocaleDateString('en-US'),
          lecture.lecture_time || '-',
          lecture.topic || '-',
          lecture.location || '-',
          statusLabel,
          attendance?.arrival_time || '-',
          attendance?.notes || '-'
        ];
        row.alignment = { vertical: 'middle', horizontal: 'center' };
        rowIndex++;
      }
    }

    // إنشاء buffer للكتاب
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const responseBody = new Uint8Array(buffer);

    // إرجاع الملف كـ response
    return new NextResponse(responseBody, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="attendance-report-${dateFrom}-${dateTo}.xlsx"`,
      },
    });

  } catch (error: unknown) {
    console.error('خطأ في تصدير تقرير الحضور:', error);
    const errorMessage = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
    return NextResponse.json(
      {
        success: false,
        error: `حدث خطأ في تصدير تقرير الحضور: ${errorMessage}`
      },
      { status: 500 }
    );
  }
}

