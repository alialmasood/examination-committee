#!/usr/bin/env tsx

import { query } from '../lib/db';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🔧 بدء إصلاح ربط المستخدم admin بنظام شؤون الطلبة...\n');
    
    // الحصول على المستخدم admin
    const userResult = await query(
      'SELECT id, username, full_name FROM student_affairs.users WHERE username = $1',
      ['admin']
    );

    if (userResult.rows.length === 0) {
      throw new Error('المستخدم admin غير موجود');
    }

    const adminUser = userResult.rows[0];
    console.log(`✅ تم العثور على المستخدم admin (ID: ${adminUser.id}, الاسم: ${adminUser.full_name})\n`);

    // الحصول على نظام شؤون الطلبة أو إنشاؤه
    let systemResult = await query(
      'SELECT id, code FROM student_affairs.systems WHERE code = $1',
      ['STUDENT_AFFAIRS']
    );

    let systemId: string;
    if (systemResult.rows.length === 0) {
      console.log('⚠️  نظام شؤون الطلبة غير موجود، جاري إنشاؤه...');
      const createSystemResult = await query(
        `INSERT INTO student_affairs.systems (code, name, name_ar, base_path, is_active)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING id, code`,
        ['STUDENT_AFFAIRS', 'Student Affairs System', 'شؤون الطلبة والتسجيل', '/student-affairs']
      );
      systemId = createSystemResult.rows[0].id;
      console.log(`✅ تم إنشاء نظام شؤون الطلبة (ID: ${systemId})\n`);
    } else {
      systemId = systemResult.rows[0].id;
      console.log(`✅ تم العثور على نظام شؤون الطلبة (ID: ${systemId})\n`);
    }

    // التحقق من وجود الربط
    const linkResult = await query(
      'SELECT * FROM student_affairs.user_systems WHERE user_id = $1 AND system_id = $2',
      [adminUser.id, systemId]
    );

    if (linkResult.rows.length === 0) {
      // إضافة الربط
      await query(
        `INSERT INTO student_affairs.user_systems (user_id, system_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, system_id) DO NOTHING`,
        [adminUser.id, systemId]
      );
      console.log('✅ تم ربط المستخدم admin بنظام شؤون الطلبة');
    } else {
      console.log('✅ المستخدم admin مرتبط بالفعل بنظام شؤون الطلبة');
    }

    // لجعل STUDENT_AFFAIRS أولاً، نحذف جميع الروابط ثم نعيد إضافتها بالترتيب المطلوب
    console.log('\n🔄 جاري إعادة ترتيب الأنظمة لجعل STUDENT_AFFAIRS أولاً...');
    
    // الحصول على جميع الأنظمة المرتبطة
    const allSystemsResult = await query(
      `SELECT s.id, s.code, s.name_ar, s.base_path
       FROM student_affairs.user_systems us
       JOIN student_affairs.systems s ON s.id = us.system_id
       WHERE us.user_id = $1`,
      [adminUser.id]
    );

    const allSystems = allSystemsResult.rows;
    
    // حذف جميع الروابط
    await query(
      'DELETE FROM student_affairs.user_systems WHERE user_id = $1',
      [adminUser.id]
    );
    console.log('✅ تم حذف جميع الروابط القديمة');

    // إعادة إضافة الروابط بالترتيب المطلوب (STUDENT_AFFAIRS أولاً)
    const orderedSystems = allSystems.sort((a, b) => {
      if (a.code === 'STUDENT_AFFAIRS') return -1;
      if (b.code === 'STUDENT_AFFAIRS') return 1;
      return a.code.localeCompare(b.code);
    });

    for (const system of orderedSystems) {
      await query(
        `INSERT INTO student_affairs.user_systems (user_id, system_id)
         VALUES ($1, $2)`,
        [adminUser.id, system.id]
      );
    }
    console.log('✅ تم إعادة إضافة الروابط بالترتيب الجديد');

    // عرض جميع الأنظمة المرتبطة بالمستخدم admin بعد إعادة الترتيب
    const finalSystemsResult = await query(
      `SELECT s.code, s.name_ar, s.base_path
       FROM student_affairs.user_systems us
       JOIN student_affairs.systems s ON s.id = us.system_id
       WHERE us.user_id = $1
       ORDER BY CASE WHEN s.code = 'STUDENT_AFFAIRS' THEN 0 ELSE 1 END, s.code`,
      [adminUser.id]
    );

    console.log('\n📋 الأنظمة المرتبطة بالمستخدم admin (بعد إعادة الترتيب):');
    finalSystemsResult.rows.forEach((system, index) => {
      console.log(`${index + 1}. ${system.code} - ${system.name_ar} (${system.base_path})`);
    });

    console.log('\n🎉 تم إصلاح الربط بنجاح!');
    console.log('💡 ملاحظة: إذا كان المستخدم مرتبطاً بأكثر من نظام، سيتم توجيهه إلى النظام الأول في القائمة.');
    console.log('   إذا أردت أن يكون نظام شؤون الطلبة أولاً، يجب حذف الربط ثم إعادة إضافته.');

  } catch (error) {
    console.error('❌ خطأ:', error);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();

