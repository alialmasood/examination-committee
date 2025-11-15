#!/usr/bin/env tsx

import { seedAdmin } from '../lib/seed';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🚀 بدء إنشاء المستخدم الإداري...\n');
    
    await seedAdmin();
    
    console.log('\n✅ تم إنشاء المستخدم الإداري بنجاح!');
    console.log('\n📋 بيانات تسجيل الدخول:');
    console.log('   اسم المستخدم: admin');
    console.log('   كلمة المرور: admin123');
    
  } catch (error) {
    console.error('\n❌ خطأ في إنشاء المستخدم الإداري:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
