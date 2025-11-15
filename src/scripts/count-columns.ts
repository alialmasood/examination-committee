#!/usr/bin/env tsx

import { query } from '../lib/db';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🔍 فحص عدد الأعمدة في جدول students...');
    
    const result = await query(`
      SELECT COUNT(*) as count 
      FROM information_schema.columns 
      WHERE table_schema = 'student_affairs' 
      AND table_name = 'students'
    `);
    
    console.log(`عدد الأعمدة: ${result.rows[0].count}`);
    
    // عرض أسماء الأعمدة
    const columnsResult = await query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'student_affairs' 
      AND table_name = 'students'
      ORDER BY ordinal_position
    `);
    
    console.log('\nأسماء الأعمدة:');
    columnsResult.rows.forEach((row: any, index: number) => {
      console.log(`${index + 1}. ${row.column_name}`);
    });
    
  } catch (error) {
    console.error('❌ خطأ في فحص الأعمدة:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
