import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';

// POST /api/students/test - اختبار إضافة طالب
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    console.log('بيانات الطالب المستلمة:', body);
    
    // التحقق من البيانات المطلوبة
    if (!body.first_name || !body.last_name || !body.national_id || !body.birth_date || !body.gender) {
      return NextResponse.json(
        { success: false, error: 'البيانات المطلوبة مفقودة' },
        { status: 400 }
      );
    }
    
    // توليد الرقم الجامعي
    const universityIdResult = await query('SELECT student_affairs.generate_university_id() as university_id');
    const university_id = universityIdResult.rows[0].university_id;
    
    console.log('الرقم الجامعي المولد:', university_id);
    
    // إدراج الطالب الجديد (بسيط)
    const insertQuery = `
      INSERT INTO student_affairs.students (
        university_id, student_number, full_name_ar, first_name, last_name, national_id, birth_date, gender, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      ) RETURNING id, university_id, created_at
    `;
    
    const result = await query(insertQuery, [
      university_id,
      university_id, // student_number
      `${body.first_name} ${body.last_name}`, // full_name_ar
      body.first_name,
      body.last_name,
      body.national_id,
      body.birth_date,
      body.gender,
      'active'
    ]);
    
    const newStudent = result.rows[0];
    
    console.log('تم إضافة الطالب بنجاح:', newStudent);
    
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
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'خطأ غير معروف';
    return NextResponse.json(
      { success: false, error: 'خطأ في إضافة الطالب: ' + message },
      { status: 500 }
    );
  }
}
