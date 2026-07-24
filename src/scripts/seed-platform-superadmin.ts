/**
 * إنشاء/تحديث حساب السوبر أدمن لبوابة /platform-admin
 * بدون ربطه بأي نظام تشغيلي.
 */
import bcrypt from 'bcrypt';
import { query, closePool } from '../lib/db';
import { PLATFORM_SUPERADMIN_USERNAME } from '../lib/platform-superadmin';

const PASSWORD = 'SS@aarr##2926';
const FULL_NAME = 'مسؤول المنصة الأعلى';
const EMAIL = 'superadmin@platform.local';

async function main() {
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

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const res = await query(
    `INSERT INTO student_affairs.users (username, email, full_name, password_hash, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (username)
     DO UPDATE SET
       email = EXCLUDED.email,
       full_name = EXCLUDED.full_name,
       password_hash = EXCLUDED.password_hash,
       is_active = TRUE
     RETURNING id, username;`,
    [PLATFORM_SUPERADMIN_USERNAME, EMAIL, FULL_NAME, passwordHash]
  );

  const user = res.rows[0];
  console.log('✅ تم تجهيز حساب السوبر أدمن');
  console.log(`   username: ${user.username}`);
  console.log(`   id: ${user.id}`);
  console.log('   بوابة الدخول: http://localhost:3000/platform-admin');
}

main()
  .catch((e) => {
    console.error('❌ فشل تجهيز السوبر أدمن:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
