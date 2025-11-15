#!/usr/bin/env tsx

import { query } from '../lib/db';
import { closePool } from '../lib/db';

async function main() {
  try {
    console.log('🚀 بدء إصلاح عمود المعدل التراكمي لدعم الكسور العشرية...\n');
    
    // التحقق من نوع العمود الحالي
    console.log('1️⃣ التحقق من نوع العمود الحالي...');
    const checkResult = await query(`
      SELECT 
        data_type,
        numeric_precision,
        numeric_scale
      FROM information_schema.columns 
      WHERE table_schema = 'student_affairs' 
        AND table_name = 'students' 
        AND column_name = 'secondary_gpa'
    `);
    
    if (checkResult.rows.length > 0) {
      const currentType = checkResult.rows[0];
      console.log(`📊 نوع العمود الحالي: ${currentType.data_type}(${currentType.numeric_precision},${currentType.numeric_scale})`);
      
      if (currentType.numeric_scale === '0') {
        console.log('⚠️ العمود لا يدعم الكسور العشرية حالياً');
        console.log('\n2️⃣ تغيير نوع العمود إلى NUMERIC(5,2)...');
        
        // تغيير نوع العمود
        await query(`
          ALTER TABLE student_affairs.students 
          ALTER COLUMN secondary_gpa TYPE NUMERIC(5,2)
        `);
        
        console.log('✅ تم تغيير نوع العمود بنجاح');
        
        // إضافة تعليق
        await query(`
          COMMENT ON COLUMN student_affairs.students.secondary_gpa IS 'المعدل التراكمي (0.00 - 100.00) مع دعم الكسور العشرية'
        `);
        
        console.log('✅ تم إضافة التعليق بنجاح');
        
        // التحقق من النوع الجديد
        const verifyResult = await query(`
          SELECT 
            data_type,
            numeric_precision,
            numeric_scale
          FROM information_schema.columns 
          WHERE table_schema = 'student_affairs' 
            AND table_name = 'students' 
            AND column_name = 'secondary_gpa'
        `);
        
        const newType = verifyResult.rows[0];
        console.log(`\n✅ نوع العمود الجديد: ${newType.data_type}(${newType.numeric_precision},${newType.numeric_scale})`);
        console.log('✅ الآن العمود يدعم الكسور العشرية!');
        
      } else {
        console.log('✅ العمود يدعم الكسور العشرية بالفعل');
      }
    } else {
      console.log('❌ لم يتم العثور على العمود secondary_gpa');
    }
    
    console.log('\n🎉 تم إصلاح العمود بنجاح!');
    
  } catch (error) {
    console.error('\n❌ خطأ في إصلاح العمود:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();

