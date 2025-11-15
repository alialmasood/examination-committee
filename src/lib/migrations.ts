import { query } from './db';
import fs from 'fs';
import path from 'path';

// دالة لتشغيل migrations
export async function runMigrations(): Promise<void> {
  try {
    console.log('بدء تشغيل migrations...');

    // قراءة ملفات migrations
    const migrationsDir = path.join(process.cwd(), 'db', 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    console.log(`تم العثور على ${migrationFiles.length} ملف migration`);

    for (const file of migrationFiles) {
      const version = file.replace('.sql', '');
      
      // التحقق من أن migration لم يتم تشغيله من قبل
      const checkResult = await query(
        'SELECT version FROM platform.schema_migrations WHERE version = $1',
        [version]
      );

      if (checkResult.rows.length > 0) {
        console.log(`تم تشغيل ${version} من قبل، تخطي...`);
        continue;
      }

      console.log(`تشغيل ${version}...`);

      // قراءة محتوى ملف migration
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      // تشغيل migration
      await query(sql);

      // تسجيل migration كمنفذ
      await query(
        'INSERT INTO platform.schema_migrations (version) VALUES ($1)',
        [version]
      );

      console.log(`تم تشغيل ${version} بنجاح`);
    }

    console.log('تم تشغيل جميع migrations بنجاح');

  } catch (error) {
    console.error('خطأ في تشغيل migrations:', error);
    throw error;
  }
}

// دالة لعكس آخر migration
export async function rollbackLastMigration(): Promise<void> {
  try {
    // الحصول على آخر migration
    const lastMigration = await query(
      'SELECT version FROM platform.schema_migrations ORDER BY applied_at DESC LIMIT 1'
    );

    if (lastMigration.rows.length === 0) {
      console.log('لا توجد migrations للعكس');
      return;
    }

    const version = lastMigration.rows[0].version;
    console.log(`محاولة عكس ${version}...`);

    // قراءة ملف migration للعكس
    const migrationsDir = path.join(process.cwd(), 'db', 'migrations');
    const filePath = path.join(migrationsDir, `${version}.sql`);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`ملف migration ${version} غير موجود`);
    }

    // محاولة العكس (هذا يعتمد على محتوى migration)
    // في هذا المثال، سنحذف migration من جدول التتبع فقط
    await query(
      'DELETE FROM platform.schema_migrations WHERE version = $1',
      [version]
    );

    console.log(`تم عكس ${version} بنجاح`);

  } catch (error) {
    console.error('خطأ في عكس migration:', error);
    throw error;
  }
}

// دالة لعرض حالة migrations
export async function showMigrationStatus(): Promise<void> {
  try {
    const result = await query(
      'SELECT version, applied_at FROM platform.schema_migrations ORDER BY applied_at'
    );

    console.log('\nحالة migrations:');
    console.log('================');
    
    if (result.rows.length === 0) {
      console.log('لا توجد migrations منفذة');
    } else {
      result.rows.forEach((row: { version: string; applied_at: string }) => {
        console.log(`${row.version} - ${row.applied_at}`);
      });
    }

  } catch (error) {
    console.error('خطأ في عرض حالة migrations:', error);
    throw error;
  }
}
