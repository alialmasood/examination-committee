#!/usr/bin/env tsx

import { query } from '../lib/db';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🔍 فحص الجداول الموجودة...\n');
    
    // فحص الجداول في schema student_affairs
    console.log('📋 جداول student_affairs:');
    const studentTables = await query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'student_affairs' 
      ORDER BY table_name, ordinal_position;
    `);
    
    if (studentTables.rows.length > 0) {
      studentTables.rows.forEach((row: any) => {
        console.log(`  ${row.table_name}.${row.column_name}: ${row.data_type}`);
      });
    } else {
      console.log('  لا توجد جداول في student_affairs');
    }
    
    console.log('\n📋 جداول platform:');
    const platformTables = await query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'platform' 
      ORDER BY table_name, ordinal_position;
    `);
    
    if (platformTables.rows.length > 0) {
      platformTables.rows.forEach((row: any) => {
        console.log(`  ${row.table_name}.${row.column_name}: ${row.data_type}`);
      });
    } else {
      console.log('  لا توجد جداول في platform');
    }
    
  } catch (error) {
    console.error('\n❌ خطأ في فحص الجداول:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
