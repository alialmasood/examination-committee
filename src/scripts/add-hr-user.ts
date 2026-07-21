import bcrypt from 'bcrypt';
import { query, closePool } from '../lib/db';

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

async function upsertUser(username: string, password: string, fullName: string, email: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  const res = await query(
    `INSERT INTO student_affairs.users (username, email, full_name, password_hash, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (username)
     DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash, is_active = TRUE
     RETURNING id, username;`,
    [username, email, fullName, passwordHash]
  );
  return res.rows[0];
}

async function upsertSystem(code: string, nameAr: string, basePath: string) {
  const res = await query(
    `INSERT INTO student_affairs.systems (code, name, name_ar, base_path, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (code)
     DO UPDATE SET name = EXCLUDED.name, name_ar = EXCLUDED.name_ar, base_path = EXCLUDED.base_path, is_active = TRUE
     RETURNING id, code;`,
    [code, 'HR System', nameAr, basePath]
  );
  return res.rows[0];
}

async function linkUserSystem(userId: string, systemId: string) {
  await query(
    `INSERT INTO student_affairs.user_systems (user_id, system_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, system_id) DO NOTHING;`,
    [userId, systemId]
  );
}

async function main() {
  try {
    console.log('🔗 تهيئة الجداول...');
    await ensureTables();

    console.log('👤 إنشاء/تحديث المستخدم hrhr ...');
    const user = await upsertUser(
      'hrhr',
      'hr123',
      'مدير الموارد البشرية',
      'hr@college.edu'
    );

    console.log('🧩 إنشاء/تحديث النظام HR ...');
    const system = await upsertSystem('HR', 'نظام الموارد البشرية', '/hr');

    console.log('🔗 ربط المستخدم بالنظام ...');
    await linkUserSystem(user.id, system.id);

    console.log('🎉 تم إنجاز المهمة بنجاح!');
    console.log(`📋 المستخدم: ${user.username} — كلمة المرور: hr123 — النظام: ${system.code} — المسار: http://localhost:3000/hr`);
  } catch (e) {
    console.error('❌ خطأ:', e);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();

