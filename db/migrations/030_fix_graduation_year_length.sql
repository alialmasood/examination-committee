-- Migration: تعديل طول عمود سنة التخرج لدعم الصيغة YYYY-YYYY
-- Date: 2025-01-XX

-- تغيير نوع البيانات لعمود secondary_graduation_year لدعم الصيغة "2000-2001" (9 أحرف)
ALTER TABLE student_affairs.students 
ALTER COLUMN secondary_graduation_year TYPE VARCHAR(10);

-- إضافة تعليق توضيحي
COMMENT ON COLUMN student_affairs.students.secondary_graduation_year IS 'سنة التخرج من الدراسة الإعدادية بصيغة YYYY-YYYY (مثال: 2000-2001)';

