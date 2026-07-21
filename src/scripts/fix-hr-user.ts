import bcrypt from 'bcrypt';
import { query, closePool } from '../lib/db';

async function fixHRUser() {
  try {
    console.log('بدء إصلاح مستخدم HR...');

    // 1. التأكد من وجود نظام HR
    const systemResult = await query(
      `INSERT INTO platform.systems (code, name_ar, base_path, description, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (code) DO UPDATE SET
       name_ar = EXCLUDED.name_ar,
       base_path = EXCLUDED.base_path,
       description = EXCLUDED.description,
       is_active = EXCLUDED.is_active,
       updated_at = NOW()
       RETURNING id`,
      ['HR', 'نظام الموارد البشرية', '/hr', 'نظام إدارة الموارد البشرية', true]
    );

    const systemId = systemResult.rows[0].id;
    console.log(`✅ نظام HR موجود (ID: ${systemId})`);

    // 2. تشفير كلمة المرور الصحيحة: hr123
    const password = 'hr123';
    const hashedPassword = await bcrypt.hash(password, 12);
    console.log('✅ تم تشفير كلمة المرور');

    // 3. إنشاء أو تحديث المستخدم hrhr
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
      ['hrhr', hashedPassword, 'مدير الموارد البشرية', 'hr@college.edu', true]
    );

    const userId = userResult.rows[0].id;
    console.log(`✅ تم إنشاء/تحديث المستخدم hrhr (ID: ${userId})`);

    // 4. الحصول على دور admin أو إنشاء واحد
    let roleResult = await query(
      'SELECT id FROM student_affairs.roles WHERE code = $1 LIMIT 1',
      ['admin']
    );

    let roleId: string;
    if (roleResult.rows.length === 0) {
      // إنشاء دور admin إذا لم يكن موجوداً
      const newRoleResult = await query(
        `INSERT INTO student_affairs.roles (code, name_ar, description, is_active)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        ['admin', 'مدير', 'مدير النظام', true]
      );
      roleId = newRoleResult.rows[0].id;
      console.log('✅ تم إنشاء دور admin');
    } else {
      roleId = roleResult.rows[0].id;
      console.log('✅ دور admin موجود');
    }

    // 5. ربط المستخدم بنظام HR
    await query(
      `INSERT INTO platform.user_system_roles (user_id, system_id, role_id, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, system_id) DO UPDATE SET
       role_id = EXCLUDED.role_id`,
      [userId, systemId, roleId]
    );

    console.log('✅ تم ربط المستخدم بنظام HR');
    console.log('\n🎉 تم إصلاح مستخدم HR بنجاح!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 بيانات تسجيل الدخول:');
    console.log('   اسم المستخدم: hrhr');
    console.log('   كلمة المرور: hr123');
    console.log('   النظام: HR (/hr)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ خطأ في إصلاح مستخدم HR:', error);
    throw error;
  } finally {
    await closePool();
  }
}

// تشغيل الدالة
fixHRUser()
  .then(() => {
    console.log('✅ اكتمل بنجاح');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ فشل:', error);
    process.exit(1);
  });

