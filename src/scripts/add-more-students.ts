#!/usr/bin/env tsx

import { query } from '../lib/db';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🚀 إضافة المزيد من الطلاب...\n');
    
    const students = [
      {
        first_name: 'فاطمة',
        last_name: 'أحمد',
        national_id: '1234567891',
        birth_date: '2001-03-22',
        gender: 'female'
      },
      {
        first_name: 'محمد',
        last_name: 'عبدالله',
        national_id: '1234567892',
        birth_date: '1999-12-10',
        gender: 'male'
      },
      {
        first_name: 'نورا',
        last_name: 'خالد',
        national_id: '1234567893',
        birth_date: '1998-08-05',
        gender: 'female'
      },
      {
        first_name: 'عبدالرحمن',
        last_name: 'سعد',
        national_id: '1234567894',
        birth_date: '2002-01-18',
        gender: 'male'
      }
    ];
    
    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      
      // توليد الرقم الجامعي
      const universityIdResult = await query('SELECT student_affairs.generate_university_id() as university_id');
      const university_id = universityIdResult.rows[0].university_id;
      
      // إدراج الطالب
      const insertQuery = `
        INSERT INTO student_affairs.students (
          university_id, student_number, full_name_ar, first_name, last_name, national_id, birth_date, gender, status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        ) RETURNING id, university_id
      `;
      
      const result = await query(insertQuery, [
        university_id,
        university_id, // student_number
        `${student.first_name} ${student.last_name}`, // full_name_ar
        student.first_name,
        student.last_name,
        student.national_id,
        student.birth_date,
        student.gender,
        'active'
      ]);
      
      const newStudent = result.rows[0];
      console.log(`✅ تم إضافة الطالب: ${student.first_name} ${student.last_name} (${newStudent.university_id})`);
    }
    
    console.log('\n🎉 تم إضافة جميع الطلاب بنجاح!');
    
  } catch (error) {
    console.error('\n❌ خطأ في إضافة الطلاب:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
