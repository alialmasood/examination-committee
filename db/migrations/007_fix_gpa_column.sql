-- Migration: إصلاح عمود المعدل التراكمي (secondary_gpa)
-- Date: 2025-10-25

-- تغيير نوع البيانات لعمود secondary_gpa ليدعم القيم بدون أصفار عشرية
ALTER TABLE student_affairs.students 
ALTER COLUMN secondary_gpa TYPE NUMERIC(5,0);

-- إضافة تعليق توضيحي
COMMENT ON COLUMN student_affairs.students.secondary_gpa IS 'المعدل التراكمي (0 - 99999)';
