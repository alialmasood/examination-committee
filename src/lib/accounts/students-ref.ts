/**
 * مرجع طالب من student_affairs.students — لا نسخة مكررة داخل accounts.
 */
import { AccountsHttpError } from './auth';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type StudentRef = {
  id: string;
  university_id: string | null;
  student_number: string;
  full_name_ar: string;
  major: string | null;
  admission_type: string | null;
  study_type: string | null;
  status: string;
  academic_year: string | null;
  academic_status: string | null;
  department_id: string | null;
};

export async function loadStudentRef(
  client: TxClient,
  studentId: string
): Promise<StudentRef> {
  const id = String(studentId ?? '').trim();
  if (!id) throw new AccountsHttpError('معرّف الطالب مطلوب', 400);

  const r = await txQuery<StudentRef>(
    client,
    `SELECT id,
            university_id,
            COALESCE(NULLIF(TRIM(student_number), ''), university_id, id::text) AS student_number,
            COALESCE(NULLIF(TRIM(full_name_ar), ''), full_name, '—') AS full_name_ar,
            major,
            admission_type,
            study_type,
            status,
            academic_year,
            academic_status,
            department_id
     FROM student_affairs.students
     WHERE id = $1::uuid`,
    [id]
  );
  if (!r.rows[0]) throw new AccountsHttpError('الطالب غير موجود', 404);
  return r.rows[0];
}

/** للطالب ACTIVE فقط — قبل إنشاء حساب مالي أو getOrCreate */
export async function assertStudentEligibleForAccount(
  client: TxClient,
  studentId: string
): Promise<StudentRef> {
  const student = await loadStudentRef(client, studentId);
  if (String(student.status).toLowerCase() !== 'active') {
    throw new AccountsHttpError(
      'لا يمكن فتح حساب مالي لطالب غير نشط',
      409
    );
  }
  return student;
}

/** للطالب ACTIVE فقط — يُستدعى قبل إنشاء مطالبات جديدة */
export async function assertStudentActiveForCharges(
  client: TxClient,
  studentId: string
): Promise<StudentRef> {
  const student = await loadStudentRef(client, studentId);
  if (String(student.status).toLowerCase() !== 'active') {
    throw new AccountsHttpError(
      'لا يمكن إنشاء مطالبة مالية لطالب غير نشط',
      409
    );
  }
  return student;
}
