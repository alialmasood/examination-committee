import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

// POST /api/students/bulk-import - استيراد طلاب جماعي
export async function POST(request: NextRequest) {
  try {
    // التحقق من وجود عمود username وإنشاؤه إذا لم يكن موجوداً
    try {
      await query(`
        ALTER TABLE student_affairs.students
        ADD COLUMN IF NOT EXISTS username VARCHAR(100)
      `);
    } catch (error) {
      console.log('عمود username موجود بالفعل أو حدث خطأ في التحقق:', error);
    }
    
    // التحقق من وجود عمود password وإنشاؤه إذا لم يكن موجوداً
    try {
      await query(`
        ALTER TABLE student_affairs.students
        ADD COLUMN IF NOT EXISTS password VARCHAR(255)
      `);
    } catch (error) {
      console.log('عمود password موجود بالفعل أو حدث خطأ في التحقق:', error);
    }

    const body = await request.json();
    
    // دعم النمط القديم (names فقط) والنمط الجديد (students)
    let studentsData: Array<{
      full_name: string;
      nickname?: string;
      mother_name?: string;
      birth_date?: string | null;
      national_id?: string | null;
      phone?: string | null;
      secondary_school_name?: string;
      secondary_gpa?: number | null;
      secondary_graduation_year?: string;
      exam_number?: string;
      exam_password?: string;
      department?: string;
      username?: string;
      password?: string;
      stage?: string;
      study_type?: string;
      level?: string;
      academic_year?: string;
      semester?: string;
    }> = [];

    if (body.students && Array.isArray(body.students)) {
      // النمط الجديد
      studentsData = body.students;
    } else if (body.names && Array.isArray(body.names)) {
      // النمط القديم (للتوافق)
      studentsData = body.names.map((name: string) => ({ full_name: name }));
    } else {
      return NextResponse.json(
        { success: false, error: 'يرجى إدخال بيانات صحيحة' },
        { status: 400 }
      );
    }

    if (studentsData.length === 0) {
      return NextResponse.json(
        { success: false, error: 'يرجى إدخال بيانات طلاب' },
        { status: 400 }
      );
    }

    let added = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const studentData of studentsData) {
      if (!studentData.full_name || typeof studentData.full_name !== 'string' || studentData.full_name.trim().length === 0) {
        failed++;
        continue;
      }

      const trimmedName = studentData.full_name.trim();

      try {
        // التحقق من عدم وجود طالب بنفس الاسم
        const existingStudent = await query(
          `SELECT id FROM student_affairs.students WHERE TRIM(full_name) = TRIM($1) OR TRIM(full_name_ar) = TRIM($1)`,
          [trimmedName]
        );

        if (existingStudent.rows.length > 0) {
          failed++;
          errors.push(`الطالب "${trimmedName}" موجود مسبقاً`);
          continue;
        }

        // التحقق من عدم وجود طالب بنفس رقم الهوية (إذا كان موجوداً)
        if (studentData.national_id && studentData.national_id.trim()) {
          const existingByNationalId = await query(
            `SELECT id FROM student_affairs.students WHERE national_id = $1 AND national_id IS NOT NULL AND national_id != ''`,
            [studentData.national_id.trim()]
          );

          if (existingByNationalId.rows.length > 0) {
            failed++;
            errors.push(`رقم الهوية "${studentData.national_id}" موجود مسبقاً للطالب "${trimmedName}"`);
            continue;
          }
        }

        // توليد الرقم الجامعي
        const universityIdResult = await query('SELECT student_affairs.generate_university_id() as university_id');
        const university_id = universityIdResult.rows[0].university_id;

        // تقسيم الاسم إلى أجزاء
        const nameParts = trimmedName.split(' ').filter(part => part.trim().length > 0);
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || firstName;

        // معالجة المعدل التراكمي
        let secondaryGpaValue: number | null = null;
        if (studentData.secondary_gpa !== undefined && studentData.secondary_gpa !== null) {
          const gpaValue = typeof studentData.secondary_gpa === 'string' 
            ? parseFloat(studentData.secondary_gpa) 
            : studentData.secondary_gpa;
          if (!isNaN(gpaValue) && gpaValue > 0) {
            secondaryGpaValue = Math.min(gpaValue, 100);
          }
        }

        // معالجة الحقول الجديدة
        const stageRaw = studentData.stage?.trim().toLowerCase();
        const stage = (stageRaw === 'first' || stageRaw === 'second' || stageRaw === 'third' || stageRaw === 'fourth') 
          ? stageRaw : null;
        
        const studyTypeRaw = studentData.study_type?.trim().toLowerCase();
        const studyType = (studyTypeRaw === 'morning' || studyTypeRaw === 'evening') 
          ? studyTypeRaw : null;
        
        const levelRaw = studentData.level?.trim().toLowerCase();
        const level = (levelRaw === 'bachelor' || levelRaw === 'master' || levelRaw === 'phd' || levelRaw === 'diploma') 
          ? levelRaw : null;
        
        const semesterRaw = studentData.semester?.trim().toLowerCase();
        const semester = (semesterRaw === 'first' || semesterRaw === 'second') 
          ? semesterRaw : null;

        // إدراج الطالب مع جميع البيانات
        const insertQuery = `
          INSERT INTO student_affairs.students (
            university_id, student_number, first_name, last_name, full_name_ar, full_name, nickname,
            mother_name, national_id, birth_date, phone, secondary_school_name, secondary_gpa,
            secondary_graduation_year, exam_number, exam_password, major, username, password,
            admission_type, study_type, level, academic_year, semester,
            gender, status, payment_status
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
          ) RETURNING id, university_id
        `;

        await query(insertQuery, [
          university_id,
          university_id,
          firstName,
          lastName,
          trimmedName,
          trimmedName,
          studentData.nickname?.trim() || null,
          studentData.mother_name?.trim() || null,
          studentData.national_id?.trim() || null,
          studentData.birth_date?.trim() || null,
          studentData.phone?.trim() || null,
          studentData.secondary_school_name?.trim() || null,
          secondaryGpaValue,
          studentData.secondary_graduation_year?.trim() || null,
          studentData.exam_number?.trim() || null,
          studentData.exam_password?.trim() || null,
          studentData.department?.trim() || null,
          studentData.username?.trim() || null,
          studentData.password?.trim() || null,
          stage, // stage يحتوي على القيمة (first/second/third/fourth) ويتم إدراجها في admission_type
          studyType,
          level,
          studentData.academic_year?.trim() || null,
          semester,
          'male', // افتراضي
          'active',
          'registration_pending' // قيد التسجيل
        ]);

        added++;
      } catch (error) {
        console.error(`خطأ في إضافة الطالب "${trimmedName}":`, error);
        failed++;
        errors.push(`خطأ في إضافة "${trimmedName}": ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        added,
        failed,
        total: studentsData.length,
        errors: errors.length > 0 ? errors.slice(0, 10) : [] // أول 10 أخطاء فقط
      },
      message: `تم إضافة ${added} طالب من أصل ${studentsData.length}`
    });
  } catch (error) {
    console.error('خطأ في الاستيراد الجماعي:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء الاستيراد الجماعي' },
      { status: 500 }
    );
  }
}

