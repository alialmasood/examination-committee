#!/usr/bin/env tsx

import { seedSystems, seedRoles, seedAdmin } from '../lib/seed';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🚀 بدء إنشاء البيانات الأساسية...\n');
    
    console.log('1️⃣ إنشاء الأنظمة الأساسية...');
    await seedSystems();
    
    console.log('\n2️⃣ إنشاء الأدوار الأساسية...');
    await seedRoles();
    
    console.log('\n3️⃣ إنشاء المستخدم الإداري...');
    await seedAdmin();
    
    console.log('\n✅ تم إنشاء جميع البيانات الأساسية بنجاح!');
    console.log('\n📋 بيانات تسجيل الدخول:');
    console.log('   اسم المستخدم: admin');
    console.log('   كلمة المرور: admin123');
    
  } catch (error) {
    console.error('\n❌ خطأ في إنشاء البيانات الأساسية:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
