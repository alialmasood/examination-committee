import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const searchTerm = searchParams.get('q') || '';
    const limit = parseInt(searchParams.get('limit') || '10');

    if (searchTerm.trim().length < 1) {
      return NextResponse.json({ students: [] });
    }

    // البحث في الأسماء والبيانات المعروضة مع تطبيع العربية
    const tokens = searchTerm
      .trim()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      return NextResponse.json({ students: [] });
    }

    const tokenConditions = tokens.map((_, i) => {
      const p = i + 1;
      return `(
        normalize_arabic(COALESCE(s.full_name_ar, '')) ILIKE normalize_arabic($${p})
        OR normalize_arabic(COALESCE(s.full_name, '')) ILIKE normalize_arabic($${p})
        OR normalize_arabic(COALESCE(s.first_name, '')) ILIKE normalize_arabic($${p})
        OR normalize_arabic(COALESCE(s.middle_name, '')) ILIKE normalize_arabic($${p})
        OR normalize_arabic(COALESCE(s.last_name, '')) ILIKE normalize_arabic($${p})
        OR normalize_arabic(COALESCE(s.nickname, '')) ILIKE normalize_arabic($${p})
        OR CAST(s.university_id AS TEXT) ILIKE $${p}
        OR CAST(s.national_id AS TEXT) ILIKE $${p}
      )`;
    });

    const studentsQuery = `
      SELECT 
        s.id,
        s.university_id,
        s.full_name_ar,
        s.full_name,
        s.first_name,
        s.last_name,
        s.middle_name,
        s.national_id,
        s.status
      FROM student_affairs.students s
      WHERE s.status = 'active'
        AND (${tokenConditions.join(' AND ')})
      ORDER BY s.full_name_ar ASC
      LIMIT $${tokens.length + 1}
    `;

    const searchParamsValues = [...tokens.map((t) => `%${t}%`), limit];
    const result = await query(studentsQuery, searchParamsValues);

    const students = result.rows.map(row => ({
      id: row.id,
      universityId: row.university_id,
      fullNameAr: row.full_name_ar,
      fullName: row.full_name,
      firstName: row.first_name,
      lastName: row.last_name,
      middleName: row.middle_name,
      nationalId: row.national_id,
      status: row.status
    }));

    return NextResponse.json({ students }, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
    });

  } catch (error) {
    console.error('Error searching students:', error);
    return NextResponse.json(
      { error: 'فشل في البحث عن الطلبة' },
      { status: 500 }
    );
  }
}
