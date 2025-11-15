#!/usr/bin/env tsx

import { query } from '../lib/db';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🚀 بدء إنشاء جدول migrations...\n');
    
    // إنشاء جدول migrations إذا لم يكن موجوداً
    await query(`
      CREATE TABLE IF NOT EXISTS platform.schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // إنشاء فهرس لتحسين الأداء
    await query(`
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at 
      ON platform.schema_migrations(applied_at);
    `);
    
    console.log('✅ تم إنشاء جدول migrations بنجاح!');
    
  } catch (error) {
    console.error('\n❌ خطأ في إنشاء جدول migrations:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
