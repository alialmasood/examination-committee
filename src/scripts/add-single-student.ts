#!/usr/bin/env tsx

import { query } from '../lib/db';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🚀 إضافة طالب واحد...\n');
    
    // توليد الرقم الجامعي
    const universityIdResult = await query('SELECT student_affairs.generate_university_id() as university_id');
    const university_id = universityIdResult.rows[0].university_id;
    
    console.log(`الرقم الجامعي المولد: ${university_id}`);
    
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
      'أحمد محمد', // full_name_ar
      'أحمد',
      'محمد',
      '1234567890',
      '2000-05-15',
      'male',
      'active'
    ]);
    
    const newStudent = result.rows[0];
    console.log(`✅ تم إضافة الطالب: ${newStudent.university_id}`);
    
  } catch (error) {
    console.error('\n❌ خطأ في إضافة الطالب:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
