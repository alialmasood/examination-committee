import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { Student } from '@/src/lib/types';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import { logAuditDirect } from '@/src/lib/audit';

// GET /api/students - جلب قائمة الطلاب
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const search = searchParams.get('search') || '';
    const department = searchParams.get('department') || '';
    const level = searchParams.get('level') || '';
    const admission_type = searchParams.get('admission_type') || '';
    const study_type = searchParams.get('study_type') || '';
    const semester = searchParams.get('semester') || '';
    const academic_year = searchParams.get('academic_year') || '';
    const status = searchParams.get('status') || '';
    
    const offset = (page - 1) * limit;
    
    // بناء استعلام البحث
    const whereConditions = [];
    const queryParams: (string | number | string[])[] = [];
    let paramIndex = 1;
    
    if (search) {
      const tokens = search
        .trim()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean);

      // كل كلمة يجب أن تطابق أحد الحقول المعروضة/القابلة للبحث
      if (tokens.length > 0) {
        for (const token of tokens) {
          whereConditions.push(`(
            normalize_arabic(COALESCE(s.full_name_ar, '')) ILIKE normalize_arabic($${paramIndex})
            OR normalize_arabic(COALESCE(s.full_name, '')) ILIKE normalize_arabic($${paramIndex})
            OR normalize_arabic(COALESCE(s.first_name, '')) ILIKE normalize_arabic($${paramIndex})
            OR normalize_arabic(COALESCE(s.middle_name, '')) ILIKE normalize_arabic($${paramIndex})
            OR normalize_arabic(COALESCE(s.last_name, '')) ILIKE normalize_arabic($${paramIndex})
            OR normalize_arabic(COALESCE(s.nickname, '')) ILIKE normalize_arabic($${paramIndex})
            OR normalize_arabic(COALESCE(s.mother_name, '')) ILIKE normalize_arabic($${paramIndex})
            OR normalize_arabic(COALESCE(s.major, '')) ILIKE normalize_arabic($${paramIndex})
            OR CAST(s.university_id AS TEXT) ILIKE $${paramIndex}
            OR CAST(s.student_number AS TEXT) ILIKE $${paramIndex}
            OR CAST(s.national_id AS TEXT) ILIKE $${paramIndex}
            OR CAST(s.phone AS TEXT) ILIKE $${paramIndex}
          )`);
          queryParams.push(`%${token}%`);
          paramIndex++;
        }
      }
    }
    
    if (department) {
      if (department === '__other__' || department === 'other' || department === 'أخرى') {
        // طلبة بلا قسم أو بقسم لا يطابق الأقسام المعتمدة
        const knownDepartments = [
          'تقنيات التخدير',
          'تقنيات الاشعة',
          'تقنيات الأشعة',
          'تقنيات صناعة الاسنان',
          'تقنيات صناعة الأسنان',
          'هندسة تقنيات البناء والانشاءات',
          'تقنيات البناء والاستشارات',
          'تقنيات هندسة النفط والغاز',
          'تقنيات الفيزياء الصحية',
          'تقنيات البصريات',
          'تقنيات صحة المجتمع',
          'تقنيات طب الطوارئ',
          'تقنيات العلاج الطبيعي',
          'هندسة تقنيات الامن السيبراني والحوسبة السحابية',
          'تقنيات الامن السيبراني',
          'تقنيات الأمن السيبراني',
          'القانون',
        ];
        whereConditions.push(`(
          TRIM(COALESCE(s.major, '')) = ''
          OR NOT EXISTS (
            SELECT 1
            FROM unnest($${paramIndex}::text[]) AS known(name)
            WHERE normalize_arabic(known.name) = normalize_arabic(COALESCE(s.major, ''))
          )
        )`);
        queryParams.push(knownDepartments);
        paramIndex++;
      } else {
        whereConditions.push(
          `normalize_arabic(COALESCE(s.major, '')) = normalize_arabic($${paramIndex})`
        );
        queryParams.push(department);
        paramIndex++;
      }
    }
    
    if (level) {
      whereConditions.push(`s.level = $${paramIndex}`);
      queryParams.push(level);
      paramIndex++;
    }
    
    if (admission_type) {
      whereConditions.push(`s.admission_type = $${paramIndex}`);
      queryParams.push(admission_type);
      paramIndex++;
    }
    
    if (study_type) {
      whereConditions.push(`s.study_type = $${paramIndex}`);
      queryParams.push(study_type);
      paramIndex++;
    }
    
    if (semester) {
      whereConditions.push(`s.semester = $${paramIndex}`);
      queryParams.push(semester);
      paramIndex++;
    }
    
    if (academic_year) {
      whereConditions.push(`s.academic_year = $${paramIndex}`);
      queryParams.push(academic_year);
      paramIndex++;
    }
    
    if (status) {
      whereConditions.push(`s.status = $${paramIndex}`);
      queryParams.push(status);
      paramIndex++;
    }
    
    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    
    // جلب إجمالي عدد الطلاب
    const countQuery = `
      SELECT COUNT(*) as total
      FROM student_affairs.students s
      ${whereClause}
    `;
    
    const countResult = await query(countQuery, queryParams);
    const total = parseInt(countResult.rows[0].total);
    
    // جلب الطلاب
    const studentsQuery = `
      SELECT 
        s.id,
        s.university_id,
        s.full_name_ar,
        s.full_name,
        s.nickname,
        s.first_name,
        s.last_name,
        s.middle_name,
        s.national_id,
        TO_CHAR(s.birth_date, 'YYYY-MM-DD') as birth_date,
        s.birth_place,
        s.province,
        s.mother_name,
        s.area,
        s.gender,
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
        s.admission_score,
        s.english_level,
        s.math_level,
        s.science_level,
        s.national_id_copy,
        s.birth_certificate,
        s.secondary_certificate,
        s.photo,
        s.medical_certificate,
        s.other_documents,
        s.status,
        (to_jsonb(s)->>'payment_status') AS payment_status,
        TO_CHAR(s.registration_date, 'YYYY-MM-DD') as registration_date,
        s.created_at,
        s.updated_at,
        s.created_by,
        s.updated_by
      FROM student_affairs.students s
      ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    queryParams.push(limit, offset);
    const studentsResult = await query(studentsQuery, queryParams);
    
    // جلب academic_status لكل طالب بشكل منفصل (إذا كان العمود موجوداً)
    const academicStatusMap: Record<string, string> = {};
    try {
      const statusCheck = await query(`
        SELECT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_schema = 'student_affairs' 
            AND table_name = 'students' 
            AND column_name = 'academic_status'
        ) as exists
      `);
      
      if (statusCheck.rows[0]?.exists) {
        const studentIds = studentsResult.rows.map(r => r.id);
        if (studentIds.length > 0) {
          const placeholders = studentIds.map((_, i) => `$${i + 1}`).join(', ');
          const statusResult = await query(
            `SELECT id, COALESCE(academic_status, 'مستمر') as academic_status 
             FROM student_affairs.students 
             WHERE id IN (${placeholders})`,
            studentIds
          );
          
          statusResult.rows.forEach(row => {
            academicStatusMap[row.id] = row.academic_status;
          });
        }
      }
    } catch (error) {
      console.warn('تحذير: لم يتم جلب academic_status:', error);
    }
    
    const students: (Student & { academic_status?: string })[] = studentsResult.rows.map(row => {
      return {
        id: row.id,
        university_id: row.university_id,
        full_name_ar: row.full_name_ar || row.full_name || `${row.first_name} ${row.last_name}`,
        full_name: row.full_name || `${row.first_name} ${row.last_name}`,
        nickname: row.nickname,
        first_name: row.first_name,
        last_name: row.last_name,
        middle_name: row.middle_name,
        national_id: row.national_id,
        birth_date: row.birth_date,
        birth_place: row.birth_place,
        province: row.province,
        mother_name: row.mother_name,
        area: row.area,
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
        secondary_gpa: row.secondary_gpa !== null && row.secondary_gpa !== undefined ? Number(row.secondary_gpa) : 0,
        secondary_total_score: row.secondary_total_score,
        exam_attempt: row.exam_attempt,
        exam_number: row.exam_number,
        exam_password: row.exam_password,
        branch: row.branch,
        secondary_achievements: row.secondary_achievements,
        secondary_activities: row.secondary_activities,
        admission_type: row.admission_type,
        department: row.major, // استخدام major كـ department
        major: row.major,
        study_type: row.study_type || 'morning',
        level: row.level,
        semester: row.semester || 'first',
        academic_year: row.academic_year,
        admission_score: row.admission_score,
        english_level: row.english_level,
        math_level: row.math_level,
        science_level: row.science_level,
        national_id_copy: row.national_id_copy,
        birth_certificate: row.birth_certificate,
        secondary_certificate: row.secondary_certificate,
        photo: row.photo,
        medical_certificate: row.medical_certificate,
        other_documents: row.other_documents,
        status: row.status,
        academic_status: academicStatusMap[row.id] || 'مستمر',
        payment_status: row.payment_status || 'pending',
        registration_date: row.registration_date,
        created_at: row.created_at,
        updated_at: row.updated_at,
        created_by: row.created_by,
        updated_by: row.updated_by
      } as Student & { academic_status: string };
    });
    
    const response = {
      success: true,
      students: students,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit)
      }
    };
    
    return NextResponse.json(response, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    });
    
  } catch (error) {
    console.error('خطأ في جلب الطلاب:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب بيانات الطلاب' },
      { status: 500 }
    );
  }
}

// POST /api/students - إضافة طالب جديد
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;

    // التحقق من البيانات المطلوبة
    if (!body.full_name || !body.birth_date || !body.gender) {
      return NextResponse.json(
        { success: false, error: 'البيانات المطلوبة مفقودة: الاسم الكامل، تاريخ الميلاد، أو الجنس' },
        { status: 400 }
      );
    }
    
    // التحقق من عدم وجود طالب بنفس الاسم الرباعي (مقارنة بدون مسافات زائدة)
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
    if (fullName) {
      const existingStudentByName = await query(
        `SELECT id, university_id, full_name 
         FROM student_affairs.students 
         WHERE TRIM(full_name) = TRIM($1) 
           AND full_name IS NOT NULL 
           AND full_name != ''`,
        [fullName]
      );
      
      if (existingStudentByName.rows.length > 0) {
        const existingStudent = existingStudentByName.rows[0];
        return NextResponse.json(
          { 
            success: false, 
            error: `الطالب مسجل مسبقاً! الاسم الرباعي "${fullName}" موجود في النظام. الرقم الجامعي: ${existingStudent.university_id}` 
          },
          { status: 400 }
        );
      }
    }
    
    // التحقق من عدم وجود رقم الهوية مكرر (فقط إذا كان موجوداً)
    if (body.national_id && typeof body.national_id === 'string' && body.national_id.trim() !== '') {
      const existingStudent = await query(
        'SELECT id FROM student_affairs.students WHERE national_id = $1 AND national_id IS NOT NULL AND national_id != \'\'',
        [body.national_id]
      );
      
      if (existingStudent.rows.length > 0) {
        return NextResponse.json(
          { success: false, error: 'رقم الهوية الوطنية مسجل مسبقاً' },
          { status: 400 }
        );
      }
    }
    
    // توليد الرقم الجامعي
    const universityIdResult = await query('SELECT student_affairs.generate_university_id() as university_id');
    const university_id = universityIdResult.rows[0].university_id;
    
    // تحديد payment_status (افتراضي: 'pending' ما لم يتم تحديد 'registration_pending')
    const paymentStatus = (body as Record<string, unknown>).payment_status || 'pending';
    
    // إدراج الطالب الجديد مع جميع الحقول
    const insertQuery = `
      INSERT INTO student_affairs.students (
        university_id, student_number, first_name, last_name, full_name_ar, full_name, nickname, national_id, birth_date, birth_place, mother_name, area, gender, religion, marital_status, phone, email, address, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, secondary_school_name, secondary_school_type, secondary_graduation_year, secondary_total_score, exam_attempt, exam_number, exam_password, branch, major, academic_year, secondary_gpa, study_type, level, semester, special_requirements, admission_type, admission_channel, username, password, national_id_copy, birth_certificate, secondary_certificate, photo, medical_certificate, medical_examination, other_documents, status, payment_status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49
      ) RETURNING id, university_id, created_at
    `;

    const nationalId =
      typeof body.national_id === 'string' && body.national_id.trim() !== ''
        ? body.national_id.trim()
        : null;
    
    // تقسيم الاسم الكامل إلى الاسم الأول والأخير (استخدام القيمة المحددة مسبقاً في fullName)
    const nameParts = fullName.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    const result = await query(insertQuery, [
      university_id,
      university_id, // student_number
      firstName, // first_name
      lastName, // last_name
      body.full_name || '', // full_name_ar
      body.full_name || '', // full_name (الاسم الرباعي)
      body.nickname || '', // nickname (اللقب)
      nationalId, // national_id (يمكن أن يكون null)
      body.birth_date,
      body.birth_place || '', // مكان الميلاد
      body.mother_name || '', // اسم الأم الثلاثي
      body.area || '', // المنطقة
      body.gender,
      body.religion || 'مسلم', // الديانة - $14
      body.marital_status || 'single', // الحالة الاجتماعية - $15
      body.phone || '', // رقم الهاتف - $16
      body.email || '', // $17
      body.address || '', // $18
      body.emergency_contact_name || '', // اسم جهة الاتصال في حالات الطوارئ - $19
      body.emergency_contact_relationship || '', // صلة القرابة - $20
      body.emergency_contact_phone || '', // رقم الهاتف العراقي - $21
      body.secondary_school_name || '', // اسم المدرسة - $22
      body.secondary_school_type || '', // نوع المدرسة - $23
      body.secondary_graduation_year && body.secondary_graduation_year !== '' ? body.secondary_graduation_year : null, // سنة التخرج - $24
      body.secondary_total_score && body.secondary_total_score !== '' ? body.secondary_total_score : null, // إجمالي الدرجات - $25
      body.exam_attempt || '', // الدور - $26
      body.exam_number || '', // الرقم الامتحاني - $27
      body.exam_password || '', // الرقم السري - $28
      body.branch || '', // الفرع - $29
      body.department || body.major || '', // القسم (استخدام department أولاً) - $30
      body.academic_year && body.academic_year !== '' ? body.academic_year : '2025-2026', // السنة الأكاديمية - $31
      (() => {
        // تحويل المعدل التراكمي إلى decimal مع الحفاظ على الكسور العشرية
        if (body.secondary_gpa !== undefined && body.secondary_gpa !== null && body.secondary_gpa !== '' && String(body.secondary_gpa).trim() !== '') {
          const gpaValue = parseFloat(String(body.secondary_gpa));
          const finalValue = isNaN(gpaValue) ? 0 : Math.min(gpaValue, 100);
          return finalValue;
        }
        return 0;
      })(), // المعدل التراكمي - $32
      body.study_type && body.study_type !== '' ? body.study_type : 'morning', // نوع الدراسة - $33
      body.level && body.level !== '' ? body.level : 'bachelor', // المرحلة الدراسية - $34
      body.semester && body.semester !== '' ? body.semester : 'first', // الفصل الدراسي - $35
      body.special_requirements || '', // متطلبات خاصة - $36
      body.admission_type && body.admission_type !== '' ? body.admission_type : 'first', // نوع القبول (المرحلة) - $37
      (body as Record<string, unknown>).admission_channel || '', // قناة القبول - $38
      (body as Record<string, unknown>).username || '', // الاسم المستخدم - $39
      (body as Record<string, unknown>).password || '', // كلمة المرور - $40
      body.national_id_copy || '', // صورة الهوية الوطنية - $41
      body.birth_certificate || '', // شهادة الميلاد - $42
      body.secondary_certificate || '', // شهادة الثانوية - $43
      body.photo || '', // الصورة الشخصية - $44
      body.medical_certificate || '', // الشهادة الطبية - $45
      body.medical_examination || '', // الفحص الطبي - $46
      body.other_documents || '', // وثائق أخرى - $47
      'active', // status - $48
      paymentStatus // payment_status - $49
    ]);
    
    const newStudent = result.rows[0];
    
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
              action_type: paymentStatus === 'registration_pending' ? 'create' : 'create',
              entity_type: 'student',
              entity_id: newStudent.id,
              entity_name: fullName,
              description: `تم إضافة طالب جديد: ${fullName} (${newStudent.university_id})${paymentStatus === 'registration_pending' ? ' - قيد التسجيل' : ''}`,
              new_values: {
                university_id: newStudent.university_id,
                full_name: fullName,
                department: body.department || body.major || '',
                payment_status: paymentStatus,
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
      data: {
        id: newStudent.id,
        university_id: newStudent.university_id,
        created_at: newStudent.created_at
      },
      message: 'تم إضافة الطالب بنجاح'
    });
    
  } catch (error) {
    console.error('خطأ في إضافة الطالب:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في إضافة الطالب' },
      { status: 500 }
    );
  }
}
