#!/usr/bin/env tsx

import { query } from '../lib/db';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🔍 فحص الطلاب في قاعدة البيانات...');
    
    const result = await query(`
      SELECT id, university_id, first_name, last_name, national_id, status, created_at
      FROM student_affairs.students 
      ORDER BY created_at DESC
    `);
    
    console.log(`\nعدد الطلاب: ${result.rows.length}`);
    console.log('==================');
    
    result.rows.forEach((student: any, index: number) => {
      console.log(`${index + 1}. ${student.first_name} ${student.last_name} (${student.university_id}) - ${student.status}`);
    });
    
  } catch (error) {
    console.error('❌ خطأ في فحص الطلاب:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
