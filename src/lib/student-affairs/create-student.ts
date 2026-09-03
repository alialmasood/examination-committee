/**
 * إنشاء طالب رسمي في student_affairs.students —
 * للاستخدام المباشر من API الطلبة ومسار تثبيت التسجيل الجديد (بدون fetch ذاتي).
 */
import { query } from '@/src/lib/db';
import { logAuditDirect } from '@/src/lib/audit';

export type CreateStudentBody = Record<string, unknown>;

export type CreateStudentAuditContext = {
  userId?: string | null;
  username?: string | null;
  fullName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type CreateStudentSuccess = {
  success: true;
  data: { id: string; university_id: string; created_at: string };
};

export type CreateStudentFailure = {
  success: false;
  error: string;
  status: number;
};

export type CreateStudentResult = CreateStudentSuccess | CreateStudentFailure;

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableDate(value: unknown): string | null {
  const s = asTrimmedString(value);
  if (!s) return null;
  // رفض التواريخ غير الصالحة مبكراً
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

export async function createStudentRecord(
  body: CreateStudentBody,
  audit?: CreateStudentAuditContext
): Promise<CreateStudentResult> {
  const fullName = asTrimmedString(body.full_name);
  const birthDate = nullableDate(body.birth_date);
  const gender = asTrimmedString(body.gender);

  if (!fullName || !birthDate || !gender) {
    return {
      success: false,
      status: 400,
      error:
        'البيانات المطلوبة مفقودة: الاسم الكامل، تاريخ الميلاد، أو الجنس',
    };
  }

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
    return {
      success: false,
      status: 400,
      error: `الطالب مسجل مسبقاً! الاسم الرباعي "${fullName}" موجود في النظام. الرقم الجامعي: ${existingStudent.university_id}`,
    };
  }

  const nationalIdRaw = asTrimmedString(body.national_id);
  const nationalId = nationalIdRaw || null;
  if (nationalId) {
    const existingStudent = await query(
      `SELECT id FROM student_affairs.students
       WHERE national_id = $1 AND national_id IS NOT NULL AND national_id != ''`,
      [nationalId]
    );
    if (existingStudent.rows.length > 0) {
      return {
        success: false,
        status: 400,
        error: 'رقم الهوية الوطنية مسجل مسبقاً',
      };
    }
  }

  const universityIdResult = await query(
    'SELECT student_affairs.generate_university_id() as university_id'
  );
  const university_id = universityIdResult.rows[0].university_id as string;

  const paymentStatus =
    asTrimmedString(body.payment_status) || 'pending';

  const insertQuery = `
    INSERT INTO student_affairs.students (
      university_id, student_number, first_name, last_name, full_name_ar, full_name, nickname,
      national_id, birth_date, birth_place, mother_name, area, gender, religion, marital_status,
      phone, email, address, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
      secondary_school_name, secondary_school_type, secondary_graduation_year, secondary_total_score,
      exam_attempt, exam_number, exam_password, branch, major, academic_year, secondary_gpa,
      study_type, level, semester, special_requirements, admission_type, admission_channel,
      username, password, national_id_copy, birth_certificate, secondary_certificate, photo,
      medical_certificate, medical_examination, other_documents, status, payment_status
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38,
      $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49
    ) RETURNING id, university_id, created_at
  `;

  const nameParts = fullName.split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  const graduationYear = asTrimmedString(body.secondary_graduation_year);
  const totalScore = asTrimmedString(body.secondary_total_score);
  const academicYear = asTrimmedString(body.academic_year) || '2025-2026';

  let secondaryGpa = 0;
  if (
    body.secondary_gpa !== undefined &&
    body.secondary_gpa !== null &&
    String(body.secondary_gpa).trim() !== ''
  ) {
    const gpaValue = parseFloat(String(body.secondary_gpa));
    secondaryGpa = Number.isNaN(gpaValue) ? 0 : Math.min(gpaValue, 100);
  }

  const result = await query(insertQuery, [
    university_id,
    university_id,
    firstName,
    lastName,
    body.full_name || '',
    body.full_name || '',
    body.nickname || '',
    nationalId,
    birthDate,
    body.birth_place || '',
    body.mother_name || '',
    body.area || '',
    gender,
    body.religion || 'مسلم',
    body.marital_status || 'single',
    body.phone || '',
    body.email || '',
    body.address || '',
    body.emergency_contact_name || '',
    body.emergency_contact_relationship || '',
    body.emergency_contact_phone || '',
    body.secondary_school_name || '',
    body.secondary_school_type || '',
    graduationYear || null,
    totalScore || null,
    body.exam_attempt || '',
    body.exam_number || '',
    body.exam_password || '',
    body.branch || '',
    body.department || body.major || '',
    academicYear,
    secondaryGpa,
    asTrimmedString(body.study_type) || 'morning',
    asTrimmedString(body.level) || 'bachelor',
    asTrimmedString(body.semester) || 'first',
    body.special_requirements || '',
    asTrimmedString(body.admission_type) || 'first',
    body.admission_channel || '',
    body.username || '',
    body.password || '',
    body.national_id_copy || '',
    body.birth_certificate || '',
    body.secondary_certificate || '',
    body.photo || '',
    body.medical_certificate || '',
    body.medical_examination || '',
    body.other_documents || '',
    'active',
    paymentStatus,
  ]);

  const newStudent = result.rows[0] as {
    id: string;
    university_id: string;
    created_at: string;
  };

  if (audit?.userId && audit?.username) {
    try {
      await logAuditDirect({
        user_id: audit.userId,
        username: audit.username,
        full_name: audit.fullName || null,
        action_type: 'create',
        entity_type: 'student',
        entity_id: newStudent.id,
        entity_name: fullName,
        description: `تم إضافة طالب جديد: ${fullName} (${newStudent.university_id})${
          paymentStatus === 'registration_pending' ? ' - قيد التسجيل' : ''
        }`,
        new_values: {
          university_id: newStudent.university_id,
          full_name: fullName,
          department: body.department || body.major || '',
          payment_status: paymentStatus,
        },
        ip_address: audit.ipAddress || 'unknown',
        user_agent: audit.userAgent || 'unknown',
      });
    } catch (error) {
      console.error('خطأ في تسجيل العملية:', error);
    }
  }

  return {
    success: true,
    data: {
      id: newStudent.id,
      university_id: newStudent.university_id,
      created_at: String(newStudent.created_at),
    },
  };
}
