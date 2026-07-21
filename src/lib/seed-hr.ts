import bcrypt from 'bcrypt';
import { query } from './db';

// دالة لإنشاء نظام HR والمستخدم
export async function seedHR(): Promise<void> {
  try {
    console.log('بدء إنشاء نظام HR والمستخدم...');

    // 1. إنشاء/تحديث نظام HR
    await query(
      `INSERT INTO platform.systems (code, name_ar, base_path, description, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (code) DO UPDATE SET
       name_ar = EXCLUDED.name_ar,
       base_path = EXCLUDED.base_path,
       description = EXCLUDED.description,
       is_active = EXCLUDED.is_active,
       updated_at = NOW()`,
      ['HR', 'نظام الموارد البشرية', '/hr', 'نظام إدارة الموارد البشرية', true]
    );

    console.log('تم إنشاء/تحديث نظام HR');

    // 2. تشفير كلمة المرور: hr123
    const password = 'hr123';
    const hashedPassword = await bcrypt.hash(password, 12);

    // 3. إنشاء/تحديث المستخدم hrhr
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
    console.log(`تم إنشاء/تحديث المستخدم hrhr (ID: ${userId})`);

    // 4. الحصول على معرف نظام HR
    const systemResult = await query(
      'SELECT id FROM platform.systems WHERE code = $1',
      ['HR']
    );

    if (systemResult.rows.length === 0) {
      throw new Error('فشل في العثور على نظام HR');
    }

    const systemId = systemResult.rows[0].id;

    // 5. الحصول على دور (admin أو أي دور موجود)
    const roleResult = await query(
      'SELECT id FROM student_affairs.roles WHERE code = $1 OR code = $2 LIMIT 1',
      ['admin', 'user']
    );

    let roleId: string;
    if (roleResult.rows.length === 0) {
      // إنشاء دور افتراضي إذا لم يكن موجوداً
      const newRoleResult = await query(
        `INSERT INTO student_affairs.roles (code, name_ar, description, is_active)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        ['admin', 'مدير', 'مدير النظام', true]
      );
      roleId = newRoleResult.rows[0].id;
    } else {
      roleId = roleResult.rows[0].id;
    }

    // 6. ربط المستخدم بنظام HR
    await query(
      `INSERT INTO platform.user_system_roles (user_id, system_id, role_id, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, system_id) DO UPDATE SET
       role_id = EXCLUDED.role_id`,
      [userId, systemId, roleId]
    );

    console.log('تم ربط المستخدم بنظام HR');
    console.log('تم إنشاء نظام HR والمستخدم بنجاح!');
    console.log('بيانات تسجيل الدخول:');
    console.log('اسم المستخدم: hrhr');
    console.log('كلمة المرور: hr123');

  } catch (error) {
    console.error('خطأ في إنشاء نظام HR والمستخدم:', error);
    throw error;
  }
}

