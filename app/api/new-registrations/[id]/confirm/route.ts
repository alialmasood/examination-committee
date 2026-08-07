import { NextRequest, NextResponse } from 'next/server';
import {
  getNewRegistrationById,
  markNewRegistrationConfirmed,
} from '@/src/lib/new-registrations';
import {
  activateStudentsAsPaid,
  syncStudentAccountsAfterActivation,
} from '@/src/lib/accounts/activate-student-after-registration';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';

function normalizePhone(phone: string): string {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  if (raw.startsWith('+964')) return raw;
  if (raw.startsWith('964')) return `+${raw}`;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+964${digits}`;
  return raw;
}

function snapshotToStudentBody(
  payload: Record<string, any>,
  department: string
): Record<string, unknown> {
  const p = payload.personalData || {};
  const se = payload.secondaryEducation || {};
  const u = payload.universityAdmission || {};
  const docs = payload.documents || {};
  const fullName = String(p.fullName || '').trim();
  const nameParts = fullName.split(/\s+/);

  const docName = (key: string) => {
    const v = docs[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    return '';
  };

  return {
    full_name: fullName,
    full_name_ar: fullName,
    nickname: String(p.nickname || ''),
    first_name: nameParts[0] || '',
    last_name: nameParts.slice(1).join(' ') || '',
    mother_name: String(p.motherName || ''),
    national_id: String(p.nationalId || ''),
    birth_date: String(p.birthDate || ''),
    birth_place: String(p.birthPlace || ''),
    province: String(p.birthPlace || ''),
    area: String(p.area || ''),
    gender: String(p.gender || 'male'),
    religion: String(p.religion || 'مسلم'),
    marital_status: String(p.maritalStatus || 'single'),
    phone: normalizePhone(String(p.phone || '')),
    email: String(p.email || ''),
    address: '',
    emergency_contact_name: '',
    emergency_contact_relationship: '',
    emergency_contact_phone: '',
    secondary_school_name: String(se.schoolName || ''),
    secondary_school_type: String(se.schoolType || ''),
    secondary_graduation_year: String(se.graduationYear || ''),
    secondary_gpa: se.gpa ? Number(se.gpa) : 0,
    secondary_total_score: se.totalScore || '',
    exam_attempt: String(se.examAttempt || ''),
    exam_number: String(se.examNumber || ''),
    exam_password: String(se.examPassword || ''),
    branch: String(se.branch || ''),
    admission_type: String(u.admissionType || 'first'),
    admission_channel: String(u.admissionChannel || ''),
    department,
    major: department,
    study_type: String(u.studyType || 'morning'),
    level: String(u.level || 'bachelor'),
    semester: String(u.semester || 'first'),
    academic_year: String(u.academicYear || '2026-2027'),
    special_requirements: '',
    username: '',
    password: '',
    national_id_copy: docName('nationalIdFront'),
    birth_certificate: docName('nationalIdBack'),
    secondary_certificate: docName('secondaryCertificate'),
    photo: docName('personalPhoto'),
    medical_certificate: docName('residenceCardFront'),
    other_documents: docName('residenceCardBack'),
    medical_examination: docName('medicalExamination'),
    payment_status: 'pending',
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const department = String(body?.department || '').trim();
    if (!department) {
      return NextResponse.json({ success: false, error: 'يجب اختيار القسم للتثبيت' }, { status: 400 });
    }

    const row = await getNewRegistrationById(id);
    if (!row) {
      return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    }
    if (row.status === 'confirmed') {
      return NextResponse.json({ success: false, error: 'الطلب مثبت مسبقاً' }, { status: 400 });
    }

    const prefs = [row.preference_1, row.preference_2, row.preference_3].filter(Boolean);
    if (!prefs.includes(department)) {
      return NextResponse.json(
        { success: false, error: 'القسم المختار يجب أن يكون من ضمن الرغبات الثلاث' },
        { status: 400 }
      );
    }

    const studentBody = snapshotToStudentBody(row.payload as Record<string, any>, department);
    const origin = request.nextUrl.origin;
    const cookie = request.headers.get('cookie') || '';

    const createRes = await fetch(`${origin}/api/students`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify(studentBody),
    });
    const createData = await createRes.json();
    if (!createRes.ok || !createData.success) {
      return NextResponse.json(
        { success: false, error: createData.error || 'تعذر إنشاء الطالب الرسمي' },
        { status: createRes.status || 400 }
      );
    }

    const studentId = createData.data?.id as string;
    const universityId = createData.data?.university_id as string;

    // ترحيل للحسابات بنفس مسار إتمام التسجيل الرسمي (تفعيل + حساب مالي)
    let accountsSynced = false;
    try {
      const { updatedIds } = await activateStudentsAsPaid({
        studentIds: [studentId],
        fromStatuses: ['pending', 'registration_pending'],
      });
      if (updatedIds.length > 0) {
        let userId: string | null = null;
        const accessToken = request.cookies.get('access_token')?.value;
        if (accessToken) {
          const payload = verifyAccessToken(accessToken);
          if (payload) {
            const user = await validateUser(payload.user_id);
            userId = user?.id || null;
          }
        }
        await syncStudentAccountsAfterActivation(userId, updatedIds);
        accountsSynced = true;
      }
    } catch (e) {
      console.error('تحذير: تم إنشاء الطالب لكن تعذر ترحيل الحسابات:', e);
    }

    const confirmed = await markNewRegistrationConfirmed({
      id,
      department,
      studentId,
      universityId,
    });

    return NextResponse.json({
      success: true,
      data: confirmed,
      student: {
        id: studentId,
        university_id: universityId,
      },
      accountsSynced,
      message: accountsSynced
        ? 'تم تثبيت الطالب وترحيله إلى الطلبة والحسابات'
        : 'تم تثبيت الطالب في سجل الطلبة (تحقق من ترحيل الحسابات)',
    });
  } catch (error) {
    console.error('new-registrations confirm:', error);
    return NextResponse.json({ success: false, error: 'تعذر تثبيت الطلب' }, { status: 500 });
  }
}
