-- Migration: إزالة الأرقام العشرية من عمود المعدل التراكمي
-- Date: 2025-01-XX

-- تغيير نوع البيانات لعمود secondary_gpa لإزالة الأرقام العشرية
ALTER TABLE student_affairs.students 
ALTER COLUMN secondary_gpa TYPE NUMERIC(5,0);

-- إضافة تعليق توضيحي
COMMENT ON COLUMN student_affairs.students.secondary_gpa IS 'المعدل التراكمي (0 - 99999) بدون أرقام عشرية';
