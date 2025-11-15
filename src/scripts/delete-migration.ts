#!/usr/bin/env tsx

import { query } from '../lib/db';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🗑️ حذف migration من التتبع...');
    
    await query('DELETE FROM platform.schema_migrations WHERE version = $1', ['003_create_student_tables']);
    
    console.log('✅ تم حذف migration من التتبع بنجاح');
    
  } catch (error) {
    console.error('❌ خطأ في حذف migration:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
