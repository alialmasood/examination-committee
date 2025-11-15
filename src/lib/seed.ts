import bcrypt from 'bcrypt';
import { query } from './db';

// دالة لإنشاء مستخدم إداري أولي
export async function seedAdmin(): Promise<void> {
  try {
    console.log('بدء إنشاء المستخدم الإداري...');

    // تشفير كلمة المرور
    const password = 'admin123';
    const hashedPassword = await bcrypt.hash(password, 12);

    // إنشاء المستخدم الإداري
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
      ['admin', hashedPassword, 'المدير العام', 'admin@college.edu', true]
    );

    const userId = userResult.rows[0].id;
    console.log(`تم إنشاء/تحديث المستخدم الإداري (ID: ${userId})`);

    // ربط المستخدم بالأنظمة
    const systems = ['STUDENT_AFFAIRS', 'EXAM_COMMITTEE'];
    
    for (const systemCode of systems) {
      // الحصول على system_id
      const systemResult = await query(
        'SELECT id FROM platform.systems WHERE code = $1',
        [systemCode]
      );

      if (systemResult.rows.length === 0) {
        console.log(`تحذير: النظام ${systemCode} غير موجود`);
        continue;
      }

      const systemId = systemResult.rows[0].id;

      // الحصول على role_id (admin)
      const roleResult = await query(
        'SELECT id FROM student_affairs.roles WHERE code = $1',
        ['admin']
      );

      if (roleResult.rows.length === 0) {
        console.log(`تحذير: الدور admin غير موجود`);
        continue;
      }

      const roleId = roleResult.rows[0].id;

      // ربط المستخدم بالنظام
      await query(
        `INSERT INTO platform.user_system_roles (user_id, system_id, role_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, system_id) DO NOTHING`,
        [userId, systemId, roleId]
      );

      console.log(`تم ربط المستخدم بالنظام ${systemCode}`);
    }

    console.log('تم إنشاء المستخدم الإداري بنجاح!');
    console.log('بيانات تسجيل الدخول:');
    console.log('اسم المستخدم: admin');
    console.log('كلمة المرور: admin123');

  } catch (error) {
    console.error('خطأ في إنشاء المستخدم الإداري:', error);
    throw error;
  }
}

// دالة لإنشاء الأنظمة الأساسية
export async function seedSystems(): Promise<void> {
  try {
    console.log('بدء إنشاء الأنظمة الأساسية...');

    const systems = [
      {
        code: 'STUDENT_AFFAIRS',
        name_ar: 'شؤون الطلبة والتسجيل',
        base_path: '/student-affairs',
        description: 'نظام إدارة شؤون الطلبة والتسجيل'
      },
      {
        code: 'EXAM_COMMITTEE',
        name_ar: 'اللجنة الامتحانية',
        base_path: '/exam-committee',
        description: 'نظام إدارة اللجنة الامتحانية'
      },
      {
        code: 'ACCOUNTING',
        name_ar: 'نظام الحسابات',
        base_path: '/accounting',
        description: 'نظام إدارة الحسابات المالية'
      }
    ];

    for (const system of systems) {
      await query(
        `INSERT INTO platform.systems (code, name_ar, base_path, description, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar,
         base_path = EXCLUDED.base_path,
         description = EXCLUDED.description,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()`,
        [system.code, system.name_ar, system.base_path, system.description, true]
      );

      console.log(`تم إنشاء/تحديث النظام ${system.code}`);
    }

    console.log('تم إنشاء الأنظمة الأساسية بنجاح!');

  } catch (error) {
    console.error('خطأ في إنشاء الأنظمة الأساسية:', error);
    throw error;
  }
}

// دالة لإنشاء الأدوار الأساسية
export async function seedRoles(): Promise<void> {
  try {
    console.log('بدء إنشاء الأدوار الأساسية...');

    const roles = [
      {
        code: 'admin',
        name_ar: 'مدير',
        description: 'مدير النظام'
      },
      {
        code: 'user',
        name_ar: 'مستخدم',
        description: 'مستخدم عادي'
      }
    ];

    for (const role of roles) {
      await query(
        `INSERT INTO student_affairs.roles (code, name_ar)
         VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar`,
        [role.code, role.name_ar]
      );

      console.log(`تم إنشاء/تحديث الدور ${role.code}`);
    }

    console.log('تم إنشاء الأدوار الأساسية بنجاح!');

  } catch (error) {
    console.error('خطأ في إنشاء الأدوار الأساسية:', error);
    throw error;
  }
}
