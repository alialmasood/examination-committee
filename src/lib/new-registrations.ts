import { query } from '@/src/lib/db';
import type { ApplicationSnapshot } from '@/src/lib/student-application-print';

let ensured = false;

export type NewRegistrationRow = {
  id: string;
  code: string;
  full_name: string;
  national_id: string;
  phone: string;
  preference_1: string;
  preference_2: string;
  preference_3: string;
  study_type: string;
  academic_year: string;
  status: string;
  confirmed_department?: string | null;
  student_id?: string | null;
  university_id?: string | null;
  payload: ApplicationSnapshot & {
    departmentPreferences?: { first: string; second: string; third: string };
  };
  created_at: string;
  updated_at?: string;
};

export async function ensureNewRegistrationsTable() {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS student_affairs.new_registrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(32) UNIQUE NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      national_id VARCHAR(50) NOT NULL DEFAULT '',
      phone VARCHAR(30) NOT NULL DEFAULT '',
      preference_1 TEXT NOT NULL DEFAULT '',
      preference_2 TEXT NOT NULL DEFAULT '',
      preference_3 TEXT NOT NULL DEFAULT '',
      study_type VARCHAR(30) NOT NULL DEFAULT '',
      academic_year VARCHAR(20) NOT NULL DEFAULT '',
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_new_registrations_created
    ON student_affairs.new_registrations (created_at DESC)
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_new_registrations_prefs
    ON student_affairs.new_registrations (preference_1, preference_2, preference_3)
  `);
  await query(`
    ALTER TABLE student_affairs.new_registrations
      ADD COLUMN IF NOT EXISTS confirmed_department TEXT,
      ADD COLUMN IF NOT EXISTS student_id UUID,
      ADD COLUMN IF NOT EXISTS university_id VARCHAR(50)
  `);
  ensured = true;
}

function randomCode(): string {
  const d = new Date();
  const y = String(d.getFullYear()).slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `NR${y}${m}${day}${rand}`;
}

export async function createNewRegistration(input: {
  payload: ApplicationSnapshot & {
    departmentPreferences?: { first: string; second: string; third: string };
  };
  preferences: { first: string; second: string; third: string };
}): Promise<NewRegistrationRow> {
  await ensureNewRegistrationsTable();
  const p = input.payload.personalData;
  const u = input.payload.universityAdmission;

  for (let i = 0; i < 5; i++) {
    const code = randomCode();
    try {
      const result = await query(
        `INSERT INTO student_affairs.new_registrations
          (code, full_name, national_id, phone, preference_1, preference_2, preference_3,
           study_type, academic_year, status, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10::jsonb)
         RETURNING *`,
        [
          code,
          p.fullName || '',
          p.nationalId || '',
          p.phone || '',
          input.preferences.first || '',
          input.preferences.second || '',
          input.preferences.third || '',
          u.studyType || '',
          u.academicYear || '',
          JSON.stringify({
            ...input.payload,
            departmentPreferences: input.preferences,
          }),
        ]
      );
      return result.rows[0] as NewRegistrationRow;
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === '23505') continue;
      throw err;
    }
  }
  throw new Error('تعذر توليد رمز تسجيل فريد');
}

export async function listNewRegistrations(filters: {
  search?: string;
  department?: string;
  studyType?: string;
  academicYear?: string;
  page?: number;
  limit?: number;
}) {
  await ensureNewRegistrationsTable();
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 40));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (filters.search?.trim()) {
    where.push(
      `(full_name ILIKE $${i} OR national_id ILIKE $${i} OR phone ILIKE $${i} OR code ILIKE $${i})`
    );
    params.push(`%${filters.search.trim()}%`);
    i++;
  }
  if (filters.department) {
    where.push(
      `(preference_1 = $${i} OR preference_2 = $${i} OR preference_3 = $${i})`
    );
    params.push(filters.department);
    i++;
  }
  if (filters.studyType) {
    where.push(`study_type = $${i}`);
    params.push(filters.studyType);
    i++;
  }
  if (filters.academicYear) {
    where.push(`academic_year = $${i}`);
    params.push(filters.academicYear);
    i++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM student_affairs.new_registrations ${whereSql}`,
    params
  );
  const total = countRes.rows[0]?.total || 0;

  const listRes = await query(
    `SELECT * FROM student_affairs.new_registrations
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    [...params, limit, offset]
  );

  const statsRes = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today,
      COUNT(*) FILTER (WHERE study_type = 'morning')::int AS morning,
      COUNT(*) FILTER (WHERE study_type = 'evening')::int AS evening
    FROM student_affairs.new_registrations
  `);

  const prefsRes = await query(`
    SELECT dept, COUNT(*)::int AS count FROM (
      SELECT preference_1 AS dept FROM student_affairs.new_registrations WHERE preference_1 <> ''
      UNION ALL
      SELECT preference_2 FROM student_affairs.new_registrations WHERE preference_2 <> ''
      UNION ALL
      SELECT preference_3 FROM student_affairs.new_registrations WHERE preference_3 <> ''
    ) t
    GROUP BY dept
    ORDER BY count DESC
    LIMIT 12
  `);

  return {
    rows: listRes.rows as NewRegistrationRow[],
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    },
    stats: {
      total: statsRes.rows[0]?.total || 0,
      today: statsRes.rows[0]?.today || 0,
      morning: statsRes.rows[0]?.morning || 0,
      evening: statsRes.rows[0]?.evening || 0,
      byDepartment: prefsRes.rows as { dept: string; count: number }[],
    },
  };
}

export async function getNewRegistrationById(id: string): Promise<NewRegistrationRow | null> {
  await ensureNewRegistrationsTable();
  const result = await query(
    `SELECT * FROM student_affairs.new_registrations WHERE id = $1 LIMIT 1`,
    [id]
  );
  return (result.rows[0] as NewRegistrationRow) || null;
}

export async function updateNewRegistration(
  id: string,
  input: {
    payload: ApplicationSnapshot & {
      departmentPreferences?: { first: string; second: string; third: string };
    };
    preferences: { first: string; second: string; third: string };
  }
): Promise<NewRegistrationRow | null> {
  await ensureNewRegistrationsTable();
  const existing = await getNewRegistrationById(id);
  if (!existing) return null;
  if (existing.status === 'confirmed') {
    throw new Error('لا يمكن تعديل طلب مثبت');
  }

  const p = input.payload.personalData;
  const u = input.payload.universityAdmission;
  const result = await query(
    `UPDATE student_affairs.new_registrations SET
      full_name = $2,
      national_id = $3,
      phone = $4,
      preference_1 = $5,
      preference_2 = $6,
      preference_3 = $7,
      study_type = $8,
      academic_year = $9,
      payload = $10::jsonb,
      updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      p.fullName || '',
      p.nationalId || '',
      p.phone || '',
      input.preferences.first || '',
      input.preferences.second || '',
      input.preferences.third || '',
      u.studyType || '',
      u.academicYear || '',
      JSON.stringify({
        ...input.payload,
        departmentPreferences: input.preferences,
      }),
    ]
  );
  return result.rows[0] as NewRegistrationRow;
}

export async function deleteNewRegistration(id: string): Promise<boolean> {
  await ensureNewRegistrationsTable();
  const result = await query(
    `DELETE FROM student_affairs.new_registrations WHERE id = $1 RETURNING id`,
    [id]
  );
  return result.rows.length > 0;
}

export async function markNewRegistrationConfirmed(input: {
  id: string;
  department: string;
  studentId: string;
  universityId: string;
}): Promise<NewRegistrationRow | null> {
  await ensureNewRegistrationsTable();
  const result = await query(
    `UPDATE student_affairs.new_registrations SET
      status = 'confirmed',
      confirmed_department = $2,
      student_id = $3::uuid,
      university_id = $4,
      updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [input.id, input.department, input.studentId, input.universityId]
  );
  return (result.rows[0] as NewRegistrationRow) || null;
}
