/**
 * إنشاء/تحديث حساب السوبر أدمن لبوابة /platform-admin
 * بدون ربطه بأي نظام تشغيلي.
 *
 * يحمّل .env / .env.local / .env.production قبل الاتصال بقاعدة البيانات.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnvFile(fileName: string): void {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;

  let text = readFileSync(filePath);
  // بعض ملفات Windows تُحفظ UTF-16
  if (text.length >= 2 && text[0] === 0xff && text[1] === 0xfe) {
    text = Buffer.from(text.toString('utf16le'));
  } else if (text.includes(0) && !text.toString('utf8').includes('=')) {
    text = Buffer.from(text.toString('utf16le'));
  }

  const content = text.toString('utf8').replace(/^\uFEFF/, '');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile('.env.production');
loadEnvFile('.env.local');
loadEnvFile('.env');

async function main() {
  const { query, closePool } = await import('../lib/db');
  const { PLATFORM_SUPERADMIN_USERNAME } = await import('../lib/platform-superadmin');

  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5440';
  const database = process.env.DB_NAME || 'examination';
  console.log(`🔌 الاتصال بقاعدة البيانات: ${host}:${port}/${database}`);

  const PASSWORD = 'SS@aarr##2926';
  const FULL_NAME = 'مسؤول المنصة الأعلى';
  const EMAIL = 'superadmin@platform.local';

  try {
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

    const bcrypt = (await import('bcrypt')).default;
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
    console.log('   بوابة الدخول: /platform-admin');
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error('❌ فشل تجهيز السوبر أدمن:', e);
  console.error('');
  console.error('تحقق من:');
  console.error('  1) خدمة PostgreSQL تعمل على السيرفر');
  console.error('  2) ملف .env أو .env.local أو .env.production يحتوي DB_HOST و DB_PORT الصحيحين');
  console.error('  3) المنفذ ليس بالضرورة 5440 — استخدم نفس إعدادات تشغيل الموقع');
  process.exitCode = 1;
});
