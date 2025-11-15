#!/usr/bin/env tsx

import bcrypt from 'bcrypt';
import { query } from '../lib/db';
import { closePool } from '../lib/db';

async function ensureTables() {
  await query(`CREATE SCHEMA IF NOT EXISTS student_affairs;`);
  await query(`
    CREATE TABLE IF NOT EXISTS student_affairs.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      full_name TEXT,
      password_hash TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS student_affairs.systems (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT UNIQUE NOT NULL,
      name_ar TEXT NOT NULL,
      base_path TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS student_affairs.user_systems (
      user_id UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE CASCADE,
      system_id UUID NOT NULL REFERENCES student_affairs.systems(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'ADMIN',
      PRIMARY KEY (user_id, system_id)
    );
  `);
}

async function upsertSystem(code: string, nameAr: string, basePath: string) {
  const res = await query(
    `INSERT INTO student_affairs.systems (code, name, name_ar, base_path, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (code)
     DO UPDATE SET name = EXCLUDED.name, name_ar = EXCLUDED.name_ar, base_path = EXCLUDED.base_path, is_active = TRUE
     RETURNING id, code;`,
    [code, 'Student Affairs System', nameAr, basePath]
  );
  return res.rows[0];
}

async function main() {
  try {
    console.log('🚀 بدء إنشاء المستخدمين الإضافيين لنظام شؤون الطلبة...\n');
    
    // التأكد من وجود الجداول
    await ensureTables();
    
    // إنشاء أو تحديث نظام شؤون الطلبة
    console.log('🧩 جاري إنشاء/تحديث نظام شؤون الطلبة...');
    const system = await upsertSystem('STUDENT_AFFAIRS', 'شؤون الطلبة والتسجيل', '/student-affairs');
    const systemId = system.id;
    console.log(`✅ تم إنشاء/تحديث نظام شؤون الطلبة (ID: ${systemId})\n`);

    // قائمة المستخدمين المطلوبين
    const users = [
      {
        username: 'user1',
        password: 'user123',
        fullName: 'سمير ناهض',
        email: 'user1@college.edu'
      },
      {
        username: 'user2',
        password: 'user456',
        fullName: 'احمد طالب',
        email: 'user2@college.edu'
      },
      {
        username: 'user3',
        password: 'user789',
        fullName: 'نورا ضياء',
        email: 'user3@college.edu'
      },
      {
        username: 'user4',
        password: 'user098',
        fullName: 'نور عبد السلام',
        email: 'user4@college.edu'
      }
    ];


    // إنشاء كل مستخدم
    for (const userData of users) {
      console.log(`👤 جاري إنشاء/تحديث المستخدم: ${userData.username}...`);
      
      // تشفير كلمة المرور
      const hashedPassword = await bcrypt.hash(userData.password, 12);

      // إنشاء أو تحديث المستخدم
      const userResult = await query(
        `INSERT INTO student_affairs.users 
         (username, password_hash, full_name, email, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (username) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         full_name = EXCLUDED.full_name,
         email = EXCLUDED.email,
         is_active = EXCLUDED.is_active
         RETURNING id, username, full_name`,
        [userData.username, hashedPassword, userData.fullName, userData.email, true]
      );

      const userId = userResult.rows[0].id;
      console.log(`   ✅ تم إنشاء/تحديث المستخدم (ID: ${userId}, الاسم: ${userData.fullName})`);

      // ربط المستخدم بنظام شؤون الطلبة
      await query(
        `INSERT INTO student_affairs.user_systems (user_id, system_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, system_id) DO NOTHING`,
        [userId, systemId]
      );

      console.log(`   ✅ تم ربط المستخدم بنظام شؤون الطلبة`);
      console.log(`   📋 اسم المستخدم: ${userData.username} | كلمة المرور: ${userData.password} | الاسم: ${userData.fullName}\n`);
    }

    console.log('🎉 تم إنشاء جميع المستخدمين بنجاح!');
    console.log('\n📝 ملخص المستخدمين:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.fullName}`);
      console.log(`   اسم المستخدم: ${user.username}`);
      console.log(`   كلمة المرور: ${user.password}`);
      console.log(`   الرابط: http://localhost:3000/student-affairs\n`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch (error) {
    console.error('❌ خطأ:', error);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();

