-- Migration: إعادة دعم الكسور العشرية في عمود المعدل التراكمي
-- Date: 2025-01-XX

-- تغيير نوع البيانات لعمود secondary_gpa لدعم الكسور العشرية
-- NUMERIC(5,2) يعني: 5 أرقام إجمالية، 2 منازل عشرية (مثال: 999.99)
ALTER TABLE student_affairs.students 
ALTER COLUMN secondary_gpa TYPE NUMERIC(5,2);

-- إضافة تعليق توضيحي
COMMENT ON COLUMN student_affairs.students.secondary_gpa IS 'المعدل التراكمي (0.00 - 100.00) مع دعم الكسور العشرية';

