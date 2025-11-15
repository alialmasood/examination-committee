-- Migration: توسيع حقل photo لاستيعاب أسماء الملفات الطويلة
-- Date: 2025-01-27

-- تغيير نوع البيانات لعمود photo من VARCHAR(20) إلى TEXT
ALTER TABLE student_affairs.students 
ALTER COLUMN photo TYPE TEXT;

-- إضافة تعليق توضيحي
COMMENT ON COLUMN student_affairs.students.photo IS 'اسم ملف الصورة الشخصية (يحتوي على المسار الكامل أو اسم الملف)';
