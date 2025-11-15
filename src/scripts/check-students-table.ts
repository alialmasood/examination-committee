#!/usr/bin/env tsx

import { query } from '../lib/db';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🔍 فحص بنية جدول students...');
    
    const result = await query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_schema = 'student_affairs' 
      AND table_name = 'students' 
      ORDER BY ordinal_position
    `);
    
    console.log('\nبنية جدول students:');
    console.log('==================');
    
    if (result.rows.length === 0) {
      console.log('جدول students غير موجود');
    } else {
      result.rows.forEach((row: any) => {
        console.log(`${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
      });
    }
    
  } catch (error) {
    console.error('❌ خطأ في فحص الجدول:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
