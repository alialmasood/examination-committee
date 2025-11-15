import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const searchTerm = searchParams.get('q') || '';
    const limit = parseInt(searchParams.get('limit') || '10');

    if (searchTerm.length < 1) {
      return NextResponse.json({ students: [] });
    }

    // البحث في الأسماء العربية والإنجليزية
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
        AND (
          s.full_name_ar ILIKE $1 
          OR s.full_name ILIKE $1
          OR s.first_name ILIKE $1
          OR s.last_name ILIKE $1
          OR s.middle_name ILIKE $1
          OR s.university_id ILIKE $1
          OR s.national_id ILIKE $1
        )
      ORDER BY s.full_name_ar ASC
      LIMIT $2
    `;

    const searchPattern = `%${searchTerm}%`;
    const result = await query(studentsQuery, [searchPattern, limit]);

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
