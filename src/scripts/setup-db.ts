#!/usr/bin/env tsx

import { query } from '../lib/db';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🚀 بدء إعداد قاعدة البيانات...\n');
    
    // إنشاء schemas إذا لم تكن موجودة
    console.log('1️⃣ إنشاء schemas...');
    await query('CREATE SCHEMA IF NOT EXISTS student_affairs;');
    await query('CREATE SCHEMA IF NOT EXISTS platform;');
    console.log('✅ تم إنشاء schemas بنجاح');
    
    // إنشاء جدول migrations
    console.log('\n2️⃣ إنشاء جدول migrations...');
    await query(`
      CREATE TABLE IF NOT EXISTS platform.schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ تم إنشاء جدول migrations بنجاح');
    
    // إنشاء فهرس
    await query(`
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at 
      ON platform.schema_migrations(applied_at);
    `);
    console.log('✅ تم إنشاء فهرس migrations بنجاح');
    
    console.log('\n🎉 تم إعداد قاعدة البيانات بنجاح!');
    
  } catch (error) {
    console.error('\n❌ خطأ في إعداد قاعدة البيانات:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
