#!/usr/bin/env tsx

import bcrypt from 'bcrypt';
import { query } from '../lib/db';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🚀 بدء إنشاء مستخدم الطالب...\n');
    
    // تشفير كلمة المرور
    const password = 'student123';
    const hashedPassword = await bcrypt.hash(password, 12);

    // إنشاء مستخدم الطالب
    const userResult = await query(
      `INSERT INTO student_affairs.users 
       (id, username, password_hash, full_name, email, is_active, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
       ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       full_name = EXCLUDED.full_name,
       email = EXCLUDED.email,
       is_active = EXCLUDED.is_active
       RETURNING id`,
      ['student', hashedPassword, 'مستخدم شؤون الطلبة', 'student@college.edu', true]
    );

    const userId = userResult.rows[0].id;
    console.log(`تم إنشاء/تحديث مستخدم الطالب (ID: ${userId})`);

    // الحصول على نظام شؤون الطلبة
    const systemResult = await query(
      'SELECT id FROM platform.systems WHERE code = $1',
      ['STUDENT_AFFAIRS']
    );

    if (systemResult.rows.length === 0) {
      throw new Error('نظام شؤون الطلبة غير موجود');
    }

    const systemId = systemResult.rows[0].id;

    // الحصول على دور user
    const roleResult = await query(
      'SELECT id FROM student_affairs.roles WHERE code = $1',
      ['user']
    );

    if (roleResult.rows.length === 0) {
      throw new Error('دور user غير موجود');
    }

    const roleId = roleResult.rows[0].id;

    // ربط المستخدم بنظام شؤون الطلبة
    await query(
      `INSERT INTO platform.user_system_roles (user_id, system_id, role_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, system_id) DO NOTHING`,
      [userId, systemId, roleId]
    );

    console.log('تم ربط المستخدم بنظام شؤون الطلبة');

    console.log('\n✅ تم إنشاء مستخدم الطالب بنجاح!');
    console.log('\n📋 بيانات تسجيل الدخول:');
    console.log('   اسم المستخدم: student');
    console.log('   كلمة المرور: student123');
    
  } catch (error) {
    console.error('\n❌ خطأ في إنشاء مستخدم الطالب:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
