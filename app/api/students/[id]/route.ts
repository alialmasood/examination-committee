import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { Student } from '@/src/lib/types';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import { logAuditDirect } from '@/src/lib/audit';

// GET /api/students/[id] - جلب طالب محدد
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    
    const { id: studentId } = await params;
    console.log('🔍 جلب بيانات الطالب:', studentId);
    
    const studentQuery = `
      SELECT 
        s.id,
        s.university_id,
        s.first_name,
        s.last_name,
        s.middle_name,
        COALESCE(s.full_name, '') as full_name,
        COALESCE(s.full_name_ar, '') as full_name_ar,
        COALESCE(s.nickname, '') as nickname,
        s.national_id,
        TO_CHAR(s.birth_date, 'YYYY-MM-DD') as birth_date,
        s.birth_place,
        s.province,
        s.mother_name,
        s.area,
        s.gender,
        s.nationality,
        s.religion,
        s.marital_status,
        s.phone,
        s.email,
        s.address,
        s.city,
        s.postal_code,
        s.emergency_contact_name,
        s.emergency_contact_relationship,
        s.emergency_contact_phone,
        s.secondary_school_name,
        s.secondary_school_type,
        s.secondary_graduation_year,
        s.secondary_gpa,
        s.secondary_total_score,
        s.exam_attempt,
        s.exam_number,
        s.exam_password,
        s.branch,
        s.secondary_achievements,
        s.secondary_activities,
        s.admission_type,
        s.admission_channel,
        s.major,
        s.study_type,
        s.level,
        s.semester,
        s.academic_year,
        s.special_requirements,
        s.username,
        s.password,
        s.admission_score,
        s.english_level,
        s.math_level,
        s.science_level,
        s.national_id_copy,
        s.birth_certificate,
        s.secondary_certificate,
        s.photo,
        s.medical_certificate,
        s.medical_examination,
        s.other_documents,
        s.status,
        (to_jsonb(s)->>'academic_status') AS academic_status,
        s.registration_date,
        s.created_at,
        s.updated_at,
        s.created_by,
        s.updated_by
      FROM student_affairs.students s
      WHERE s.id = $1
    `;
    
    const result = await query(studentQuery, [studentId]);
    console.log('📊 نتيجة الاستعلام:', result.rows.length, 'صف');
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'الطالب غير موجود' },
        { status: 404 }
      );
    }
    
    const row = result.rows[0];
    console.log('📋 بيانات الطالب من قاعدة البيانات:', {
      full_name: row.full_name,
      full_name_ar: row.full_name_ar,
      nickname: row.nickname,
      first_name: row.first_name,
      last_name: row.last_name,
      mother_name: row.mother_name,
      area: row.area
    });
    
    const student: Student = {
      id: row.id,
      university_id: row.university_id,
      full_name: row.full_name && row.full_name !== 'غير محدد' ? row.full_name : `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'غير محدد',
      full_name_ar: row.full_name_ar && row.full_name_ar !== 'غير محدد' ? row.full_name_ar : `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'غير محدد',
      nickname: row.nickname || '',
      first_name: row.first_name || '',
      last_name: row.last_name || '',
      middle_name: row.middle_name || '',
      national_id: row.national_id,
      birth_date: row.birth_date || null,
      birth_place: row.birth_place,
      province: row.province || '',
      mother_name: row.mother_name || '',
      area: row.area || '',
      gender: row.gender,
      religion: row.religion,
      marital_status: row.marital_status,
      phone: row.phone,
      email: row.email,
      address: row.address,
      city: row.city,
      postal_code: row.postal_code,
      emergency_contact_name: row.emergency_contact_name,
      emergency_contact_relationship: row.emergency_contact_relationship,
      emergency_contact_phone: row.emergency_contact_phone,
      secondary_school_name: row.secondary_school_name,
      secondary_school_type: row.secondary_school_type,
      secondary_graduation_year: row.secondary_graduation_year,
      secondary_gpa: row.secondary_gpa,
      secondary_total_score: row.secondary_total_score,
      exam_attempt: row.exam_attempt,
      exam_number: row.exam_number,
      exam_password: row.exam_password,
      branch: row.branch,
      secondary_achievements: row.secondary_achievements,
      secondary_activities: row.secondary_activities,
      admission_type: row.admission_type,
      admission_channel: row.admission_channel || null,
      department: row.major,
      major: row.major,
      study_type: row.study_type,
      level: row.level,
      semester: row.semester,
      academic_year: row.academic_year,
      username: row.username || '',
      password: row.password || '',
      admission_score: row.admission_score,
      english_level: row.english_level,
      math_level: row.math_level,
      science_level: row.science_level,
      national_id_copy: row.national_id_copy,
      birth_certificate: row.birth_certificate,
      secondary_certificate: row.secondary_certificate,
      photo: row.photo,
      medical_certificate: row.medical_certificate,
      medical_examination: row.medical_examination,
      other_documents: row.other_documents,
      status: row.status,
      academic_status: row.academic_status || 'مستمر',
      registration_date: row.registration_date,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
      updated_by: row.updated_by
    };
    
    return NextResponse.json({
      success: true,
      data: student
    });
    
  } catch (error) {
    console.error('خطأ في جلب الطالب:', error);
    console.error('تفاصيل الخطأ:', error instanceof Error ? error.message : 'خطأ غير معروف');
    console.error('Stack trace:', error instanceof Error ? error.stack : 'غير متوفر');
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب بيانات الطالب: ' + (error instanceof Error ? error.message : 'خطأ غير معروف') },
      { status: 500 }
    );
  }
}

// PUT /api/students/[id] - تحديث طالب
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // التحقق من وجود عمود admission_channel وإنشاؤه إذا لم يكن موجوداً
    try {
      await query(`
        ALTER TABLE student_affairs.students
        ADD COLUMN IF NOT EXISTS admission_channel VARCHAR(50)
      `);
    } catch (error) {
      // تجاهل الخطأ إذا كان العمود موجوداً بالفعل
      console.log('عمود admission_channel موجود بالفعل أو حدث خطأ في التحقق:', error);
    }
    
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
    
    // التحقق من طول عمود secondary_graduation_year وتعديله إذا لزم الأمر
    try {
      const columnInfo = await query(`
        SELECT character_maximum_length 
        FROM information_schema.columns 
        WHERE table_schema = 'student_affairs' 
          AND table_name = 'students' 
          AND column_name = 'secondary_graduation_year'
      `);
      
      if (columnInfo.rows.length > 0) {
        const currentLength = columnInfo.rows[0].character_maximum_length;
        if (currentLength && parseInt(currentLength) < 10) {
          console.log('🔧 تعديل طول عمود secondary_graduation_year من', currentLength, 'إلى 10');
          await query(`
            ALTER TABLE student_affairs.students 
            ALTER COLUMN secondary_graduation_year TYPE VARCHAR(10)
          `);
          console.log('✅ تم تعديل طول العمود بنجاح');
        }
      }
    } catch (error) {
      console.log('⚠️ خطأ في التحقق من طول عمود secondary_graduation_year:', error);
      // لا نوقف العملية إذا فشل التحقق
    }
    
    const { id: studentId } = await params;
    const body = await request.json();
    const bodyRecord = body as Record<string, unknown>;
    console.log('🔄 تحديث بيانات الطالب:', studentId);
    console.log('📋 البيانات المرسلة:', body);
    console.log('🔍 حقول القبول الجامعي:', {
      admission_type: body.admission_type,
      level: body.level,
      semester: body.semester,
      academic_year: body.academic_year,
      study_type: body.study_type,
      department: bodyRecord.department,
      major: bodyRecord.major
    });
    console.log('🔍 حقل سنة التخرج:', {
      secondary_graduation_year: body.secondary_graduation_year,
      type: typeof body.secondary_graduation_year,
      length: body.secondary_graduation_year ? String(body.secondary_graduation_year).length : 0
    });
    console.log('💰 الحقول الرقمية المرسلة:', {
      secondary_gpa: body.secondary_gpa,
      secondary_total_score: body.secondary_total_score,
      admission_score: body.admission_score,
      secondary_gpa_type: typeof body.secondary_gpa,
      secondary_total_score_type: typeof body.secondary_total_score,
      admission_score_type: typeof body.admission_score
    });
    
    // التحقق من وجود الطالب وجلب بياناته القديمة (قبل التحديث)
    const existingStudent = await query(
      'SELECT id, full_name, university_id, major, admission_type FROM student_affairs.students WHERE id = $1',
      [studentId]
    );
    
    if (existingStudent.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'الطالب غير موجود' },
        { status: 404 }
      );
    }
    
    // حفظ البيانات القديمة قبل التحديث
    const studentDataBefore = existingStudent.rows[0];
    
    // تحديث بيانات الطالب
    const updateQuery = `
      UPDATE student_affairs.students SET
        full_name = COALESCE(NULLIF($2, ''), full_name),
        full_name_ar = COALESCE(NULLIF($3, ''), full_name_ar),
        nickname = COALESCE(NULLIF($4, ''), nickname),
        first_name = COALESCE(NULLIF($5, ''), first_name),
        last_name = COALESCE(NULLIF($6, ''), last_name),
        middle_name = COALESCE(NULLIF($7, ''), middle_name),
        national_id = COALESCE(NULLIF($8, ''), national_id),
        birth_date = COALESCE($9, birth_date),
        birth_place = COALESCE(NULLIF($10, ''), birth_place),
        province = COALESCE(NULLIF($57, ''), province),
        mother_name = COALESCE(NULLIF($11, ''), mother_name),
        area = COALESCE(NULLIF($12, ''), area),
        gender = COALESCE($13, gender),
        religion = COALESCE(NULLIF(CAST($14 AS text), ''), religion),
        marital_status = COALESCE(NULLIF(CAST($15 AS text), ''), marital_status),
        phone = COALESCE(NULLIF($16, ''), phone),
        email = COALESCE(NULLIF($17, ''), email),
        address = COALESCE(NULLIF($18, ''), address),
        city = COALESCE(NULLIF($19, ''), city),
        postal_code = COALESCE(NULLIF($20, ''), postal_code),
        emergency_contact_name = COALESCE(NULLIF($21, ''), emergency_contact_name),
        emergency_contact_relationship = COALESCE(NULLIF($22, ''), emergency_contact_relationship),
        emergency_contact_phone = COALESCE(NULLIF($23, ''), emergency_contact_phone),
        secondary_school_name = COALESCE(NULLIF($24, ''), secondary_school_name),
        secondary_school_type = COALESCE(NULLIF(CAST($25 AS text), ''), secondary_school_type),
        secondary_graduation_year = COALESCE(NULLIF($26, ''), secondary_graduation_year),
        secondary_gpa = COALESCE($27, secondary_gpa),
        secondary_total_score = COALESCE($28, secondary_total_score),
        exam_attempt = COALESCE(NULLIF($29, ''), exam_attempt),
        exam_number = COALESCE(NULLIF($30, ''), exam_number),
        exam_password = COALESCE(NULLIF($31, ''), exam_password),
        branch = COALESCE(NULLIF($32, ''), branch),
        secondary_achievements = COALESCE(NULLIF($33, ''), secondary_achievements),
        secondary_activities = COALESCE(NULLIF($34, ''), secondary_activities),
        admission_type = COALESCE(NULLIF($35, ''), admission_type),
        admission_channel = COALESCE(NULLIF($36, ''), admission_channel),
        major = COALESCE(NULLIF($37, ''), major),
        study_type = COALESCE(NULLIF($38, ''), study_type),
        level = COALESCE(NULLIF($39, ''), level),
        semester = COALESCE(NULLIF($40, ''), semester),
        academic_year = COALESCE(NULLIF($41, ''), academic_year),
        special_requirements = COALESCE(NULLIF($42, ''), special_requirements),
        username = COALESCE(NULLIF($43, ''), username),
        password = COALESCE(NULLIF($44, ''), password),
        admission_score = COALESCE($45, admission_score),
        english_level = COALESCE(NULLIF($46, ''), english_level),
        math_level = COALESCE(NULLIF($47, ''), math_level),
        science_level = COALESCE(NULLIF($48, ''), science_level),
        national_id_copy = COALESCE(NULLIF($49, ''), national_id_copy),
        birth_certificate = COALESCE(NULLIF($50, ''), birth_certificate),
        secondary_certificate = COALESCE(NULLIF($51, ''), secondary_certificate),
        photo = COALESCE(NULLIF($52, ''), photo),
        medical_certificate = COALESCE(NULLIF($53, ''), medical_certificate),
        medical_examination = COALESCE(NULLIF($54, ''), medical_examination),
        other_documents = COALESCE(NULLIF($55, ''), other_documents),
        status = COALESCE($56, status),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, university_id, updated_at
    `;
    
    // تحضير القيم الرقمية - استخدام null بدلاً من string فارغ
    const secondaryGpaValue = (body.secondary_gpa !== undefined && body.secondary_gpa !== null && body.secondary_gpa !== '' && String(body.secondary_gpa).trim() !== '') ? parseFloat(String(body.secondary_gpa)) : null;
    const secondaryTotalScoreValue = (body.secondary_total_score !== undefined && body.secondary_total_score !== null && body.secondary_total_score !== '' && String(body.secondary_total_score).trim() !== '') ? parseFloat(String(body.secondary_total_score)) : null;
    const admissionScoreValue = (body.admission_score !== undefined && body.admission_score !== null && body.admission_score !== '' && String(body.admission_score).trim() !== '') ? parseFloat(String(body.admission_score)) : null;
    
    console.log('📊 القيم الرقمية المحضرة:', {
      secondaryGpaValue,
      secondaryTotalScoreValue,
      admissionScoreValue,
      secondary_gpa_original: body.secondary_gpa,
      secondary_total_score_original: body.secondary_total_score,
      admission_score_original: body.admission_score,
      secondaryGpaValue_type: typeof secondaryGpaValue,
      secondaryGpaValue_string_length: secondaryGpaValue !== null ? String(secondaryGpaValue).length : null,
      secondaryGpaValue_hasDecimals: secondaryGpaValue !== null ? (secondaryGpaValue % 1 !== 0) : null
    });
    
    const result = await query(updateQuery, [
      studentId,
      body.full_name || '',
      body.full_name_ar || '',
      body.nickname || '',
      body.first_name || '',
      body.last_name || '',
      body.middle_name || '',
      body.national_id || '',
      body.birth_date || null,
      body.birth_place || '',
      body.mother_name || '',
      body.area || '',
      body.gender !== undefined ? body.gender : null,
      body.religion !== undefined ? String(body.religion || '') : null,
      body.marital_status !== undefined ? String(body.marital_status || '') : null,
      body.phone || '',
      body.email || '',
      body.address || '',
      body.city || '',
      body.postal_code || '',
      body.emergency_contact_name || '',
      body.emergency_contact_relationship || '',
      body.emergency_contact_phone || '',
      body.secondary_school_name || '',
      body.secondary_school_type !== undefined ? String(body.secondary_school_type || '') : null,
      body.secondary_graduation_year || '',
      secondaryGpaValue,
      secondaryTotalScoreValue,
      body.exam_attempt || '',
      body.exam_number || '',
      body.exam_password || '',
      body.branch || '',
      body.secondary_achievements || '',
      body.secondary_activities || '',
      body.admission_type || '',
      bodyRecord.admission_channel || '',
      (bodyRecord.major ?? bodyRecord.department) || '',
      body.study_type || '',
      body.level || '',
      body.semester || '',
      body.academic_year || '',
      body.special_requirements || '',
      (bodyRecord.username || '') as string,
      (bodyRecord.password || '') as string,
      admissionScoreValue,
      body.english_level || '',
      body.math_level || '',
      body.science_level || '',
      body.national_id_copy || '',
      body.birth_certificate || '',
      body.secondary_certificate || '',
      body.photo || '',
      body.medical_certificate || '',
      body.medical_examination || '',
      body.other_documents || '',
      body.status || null,
      body.province || body.birth_place || ''
    ]);

    // تحديث academic_status إذا كان موجوداً في قاعدة البيانات
    if (bodyRecord.academic_status) {
      try {
        // التحقق من وجود العمود أولاً
        const columnCheck = await query(`
          SELECT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'student_affairs' 
              AND table_name = 'students' 
              AND column_name = 'academic_status'
          ) as exists
        `);
        
        const hasColumn = columnCheck.rows[0]?.exists || false;
        
        if (!hasColumn) {
          // إنشاء العمود إذا لم يكن موجوداً
          await query(`
            ALTER TABLE student_affairs.students
            ADD COLUMN IF NOT EXISTS academic_status VARCHAR(100) DEFAULT 'مستمر'
          `);
          
          // تحديث القيم الموجودة إلى 'مستمر'
          await query(`
            UPDATE student_affairs.students
            SET academic_status = 'مستمر'
            WHERE academic_status IS NULL
          `);
          
          // إنشاء فهرس
          await query(`
            CREATE INDEX IF NOT EXISTS idx_students_academic_status
            ON student_affairs.students (academic_status)
          `);
        }
        
        // تحديث الحالة
        await query(
          `UPDATE student_affairs.students 
           SET academic_status = $1 
           WHERE id = $2`,
          [bodyRecord.academic_status, studentId]
        );
        
        console.log('✅ تم تحديث academic_status بنجاح:', bodyRecord.academic_status);
      } catch (error: unknown) {
        console.error('❌ خطأ في تحديث academic_status:', error instanceof Error ? error.message : error);
        // نسجل الخطأ لكن لا نوقف العملية
        // لأن التحديث الأساسي قد يكون نجح
      }
    }
    
    // تسجيل العملية في سجل العمليات
    try {
      console.log('🔍 محاولة تسجيل عملية التحديث في سجل العمليات...');
      const accessToken = request.cookies.get('access_token')?.value;
      console.log('🔍 Access Token موجود:', !!accessToken);
      
      if (accessToken) {
        const payload = verifyAccessToken(accessToken);
        console.log('🔍 Payload صالح:', !!payload);
        
        if (payload) {
          const user = await validateUser(payload.user_id);
          console.log('🔍 المستخدم موجود:', !!user, user?.username);
          
          if (user) {
            const ip_address = request.headers.get('x-forwarded-for') || 
                              request.headers.get('x-real-ip') || 
                              'unknown';
            const user_agent = request.headers.get('user-agent') || 'unknown';
            
            console.log('📝 بيانات العملية:', {
              studentId,
              studentName: studentDataBefore?.full_name,
              username: user.username,
            });
            
            // استخدام البيانات القديمة المحفوظة قبل التحديث
            await logAuditDirect({
              user_id: user.id,
              username: user.username,
              full_name: user.full_name || null,
              action_type: 'update',
              entity_type: 'student',
              entity_id: studentId,
              entity_name: studentDataBefore?.full_name || 'غير محدد',
              description: `تم تحديث بيانات الطالب: ${studentDataBefore?.full_name || 'غير محدد'} (${studentDataBefore?.university_id || 'غير محدد'})`,
              old_values: {
                full_name: studentDataBefore?.full_name,
                major: studentDataBefore?.major,
                admission_type: studentDataBefore?.admission_type,
              },
              new_values: {
                full_name: body.full_name || studentDataBefore?.full_name,
                department: bodyRecord.department || bodyRecord.major || studentDataBefore?.major,
                admission_type: body.admission_type || studentDataBefore?.admission_type,
              },
              ip_address,
              user_agent,
            });
          } else {
            console.log('⚠️ المستخدم غير موجود بعد التحقق');
          }
        } else {
          console.log('⚠️ Payload غير صالح');
        }
      } else {
        console.log('⚠️ Access Token غير موجود');
      }
    } catch (error) {
      console.error('❌ خطأ في تسجيل العملية في سجل العمليات:', error);
      if (error instanceof Error) {
        console.error('❌ تفاصيل الخطأ:', error.message);
        console.error('❌ Stack:', error.stack);
      }
    }
    
    return NextResponse.json({
      success: true,
      data: {
        id: result.rows[0].id,
        university_id: result.rows[0].university_id,
        updated_at: result.rows[0].updated_at
      },
      message: 'تم تحديث بيانات الطالب بنجاح'
    });
    
  } catch (error) {
    console.error('❌ خطأ في تحديث الطالب:', error);
    console.error('❌ تفاصيل الخطأ:', {
      message: error instanceof Error ? error.message : 'خطأ غير معروف',
      code: (error as { code?: string })?.code,
      detail: (error as { detail?: string })?.detail,
      stack: error instanceof Error ? error.stack : undefined
    });
    
    // إرجاع رسالة خطأ أكثر تفصيلاً للمطورين
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'خطأ غير معروف';
    const errorDetail = (error as { detail?: string })?.detail || '';
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'خطأ في تحديث بيانات الطالب',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
        detail: process.env.NODE_ENV === 'development' ? errorDetail : undefined
      },
      { status: 500 }
    );
  }
}

// DELETE /api/students/[id] - حذف طالب
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: studentId } = await params;
    console.log('محاولة حذف الطالب:', studentId);
    
    // التحقق من وجود الطالب
    const existingStudent = await query(
      'SELECT id, university_id, first_name, last_name FROM student_affairs.students WHERE id = $1',
      [studentId]
    );
    
    console.log('نتيجة البحث عن الطالب:', existingStudent.rows.length);
    
    if (existingStudent.rows.length === 0) {
      console.log('الطالب غير موجود');
      return NextResponse.json(
        { success: false, error: 'الطالب غير موجود' },
        { status: 404 }
      );
    }
    
    console.log('الطالب موجود:', existingStudent.rows[0]);
    const studentData = existingStudent.rows[0];
    const studentFullName = `${studentData.first_name || ''} ${studentData.last_name || ''}`.trim();
    
    // حذف الطالب
    let deleteResult;
    try {
      deleteResult = await query(
        'DELETE FROM student_affairs.students WHERE id = $1',
        [studentId]
      );
    } catch (error) {
      const databaseError = error as {
        code?: string;
        constraint?: string;
        table?: string;
      };

      // لا يجوز حذف السجلات المالية أو الأكاديمية التابعة للطالب قسرياً.
      if (databaseError.code === '23503') {
        console.warn('تعذر حذف الطالب لوجود سجلات مرتبطة:', {
          studentId,
          table: databaseError.table,
          constraint: databaseError.constraint,
        });
        return NextResponse.json(
          {
            success: false,
            error:
              'لا يمكن حذف هذا الطالب لارتباطه بسجلات مالية أو أكاديمية محفوظة. يمكنك تغيير حالته الأكاديمية بدلاً من الحذف.',
            code: 'STUDENT_HAS_RELATED_RECORDS',
          },
          { status: 409 }
        );
      }

      throw error;
    }
    console.log('نتيجة الحذف:', deleteResult.rowCount);

    if (deleteResult.rowCount !== 1) {
      return NextResponse.json(
        { success: false, error: 'لم يتم حذف الطالب، يرجى تحديث الصفحة والمحاولة مجدداً' },
        { status: 409 }
      );
    }
    
    // تسجيل العملية في سجل العمليات
    try {
      const accessToken = request.cookies.get('access_token')?.value;
      if (accessToken) {
        const payload = verifyAccessToken(accessToken);
        if (payload) {
          const user = await validateUser(payload.user_id);
          if (user) {
            const ip_address = request.headers.get('x-forwarded-for') || 
                              request.headers.get('x-real-ip') || 
                              'unknown';
            const user_agent = request.headers.get('user-agent') || 'unknown';
            
            await logAuditDirect({
              user_id: user.id,
              username: user.username,
              full_name: user.full_name || null,
              action_type: 'delete',
              entity_type: 'student',
              entity_id: studentId,
              entity_name: studentFullName || studentData.university_id,
              description: `تم حذف الطالب: ${studentFullName || 'غير محدد'} (${studentData.university_id})`,
              old_values: {
                university_id: studentData.university_id,
                first_name: studentData.first_name,
                last_name: studentData.last_name,
              },
              ip_address,
              user_agent,
            });
          }
        }
      }
    } catch (error) {
      console.error('خطأ في تسجيل العملية:', error);
    }
    
    return NextResponse.json({
      success: true,
      message: 'تم حذف الطالب بنجاح'
    });
    
  } catch (error) {
    console.error('خطأ في حذف الطالب:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في حذف الطالب: ' + (error instanceof Error ? error.message : 'خطأ غير معروف') },
      { status: 500 }
    );
  }
}
