import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { Student } from '@/src/lib/types';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import {
  createStudentRecord,
  type CreateStudentAuditContext,
} from '@/src/lib/student-affairs/create-student';

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
        admission_channel: row.admission_channel || '',
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

    let audit: CreateStudentAuditContext | undefined;
    try {
      const accessToken = request.cookies.get('access_token')?.value;
      if (accessToken) {
        const payload = verifyAccessToken(accessToken);
        if (payload) {
          const user = await validateUser(payload.user_id);
          if (user) {
            audit = {
              userId: user.id,
              username: user.username,
              fullName: user.full_name || null,
              ipAddress:
                request.headers.get('x-forwarded-for') ||
                request.headers.get('x-real-ip') ||
                'unknown',
              userAgent: request.headers.get('user-agent') || 'unknown',
            };
          }
        }
      }
    } catch {
      // تجاهل فشل التدقيق قبل الإنشاء
    }

    const result = await createStudentRecord(body, audit);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      message: 'تم إضافة الطالب بنجاح',
    });
  } catch (error) {
    console.error('خطأ في إضافة الطالب:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في إضافة الطالب' },
      { status: 500 }
    );
  }
}
