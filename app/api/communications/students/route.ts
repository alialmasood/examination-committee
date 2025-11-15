import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/src/lib/db';

type StudentColumnCapabilities = {
  hasPhone: boolean;
  hasEmergencyPhone: boolean;
  hasMajor: boolean;
  hasAdmissionType: boolean;
  hasSemester: boolean;
  hasPaymentStatus: boolean;
  hasStatus: boolean;
  hasRegistrationStatus: boolean;
  hasFullNameAr: boolean;
  hasFullName: boolean;
  hasFirstName: boolean;
  hasLastName: boolean;
};

const sanitizeIdentifier = (value: string) =>
  value
    .toString()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\u0600-\u06FF-]+/g, '')
    .toLowerCase();

async function detectStudentColumnCapabilities(): Promise<StudentColumnCapabilities> {
  const targetColumns = [
    'phone',
    'emergency_contact_phone',
    'major',
    'admission_type',
    'semester',
    'payment_status',
    'status',
    'registration_status',
    'full_name_ar',
    'full_name',
    'first_name',
    'last_name',
  ];

  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'student_affairs'
        AND table_name = 'students'
        AND column_name = ANY($1::text[])
    `,
    [targetColumns]
  );

  const available = new Set(result.rows.map((row) => row.column_name as string));
  return {
    hasPhone: available.has('phone'),
    hasEmergencyPhone: available.has('emergency_contact_phone'),
    hasMajor: available.has('major'),
    hasAdmissionType: available.has('admission_type'),
    hasSemester: available.has('semester'),
    hasPaymentStatus: available.has('payment_status'),
    hasStatus: available.has('status'),
    hasRegistrationStatus: available.has('registration_status'),
    hasFullNameAr: available.has('full_name_ar'),
    hasFullName: available.has('full_name'),
    hasFirstName: available.has('first_name'),
    hasLastName: available.has('last_name'),
  };
}

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
    if (!query || query.length < 2) {
      return NextResponse.json({ success: true, data: [] });
    }

    const capabilities = await detectStudentColumnCapabilities();

    const namePieces: string[] = [];
    if (capabilities.hasFullNameAr) {
      namePieces.push('s.full_name_ar');
    }
    if (capabilities.hasFullName) {
      namePieces.push('s.full_name');
    }
    if (capabilities.hasFirstName && capabilities.hasLastName) {
      namePieces.push("s.first_name || ' ' || s.last_name");
    }

    const nameExpression = namePieces.length ? `COALESCE(${namePieces.join(', ')})` : `NULL`;
    const phoneExpression = capabilities.hasPhone
      ? 's.phone'
      : capabilities.hasEmergencyPhone
      ? 's.emergency_contact_phone'
      : 'NULL';
    const departmentExpression = capabilities.hasMajor ? 's.major' : 'NULL';

    const searchValue = `%${query}%`;
    const normalizedQuery = `%${sanitizeIdentifier(query)}%`;

    const whereConditions = [`s.id::text ILIKE $1`];
    if (namePieces.length) {
      whereConditions.push(`${nameExpression} ILIKE $1`);
      whereConditions.push(`normalize_arabic(COALESCE(${nameExpression}, '')) ILIKE normalize_arabic($2)`);
    }
    if (phoneExpression !== 'NULL') {
      whereConditions.push(`${phoneExpression} ILIKE $1`);
    }

    const result = await pool.query(
      `
        SELECT
          s.id::text AS id,
          ${nameExpression} AS name,
          ${phoneExpression} AS phone,
          ${departmentExpression} AS department
        FROM student_affairs.students s
        WHERE ${whereConditions.join(' OR ')}
        ORDER BY ${nameExpression} NULLS LAST
        LIMIT 20
      `,
      [searchValue, normalizedQuery]
    );

    const seen = new Set<string>();
    const students = result.rows
      .filter((row) => {
        const key = row.id;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .map((row) => ({
        id: row.id,
        name: row.name || 'طالب بدون اسم',
        phone: row.phone?.trim() || '',
        department: row.department || null,
      }));

    return NextResponse.json({ success: true, data: students });
  } catch (error) {
    console.error('خطأ أثناء البحث عن الطلبة:', error);
    return NextResponse.json({ success: false, error: 'تعذر البحث عن الطلبة' }, { status: 500 });
  }
}
