-- إضافة حقل الاسم الرباعي وحقل اللقب
-- Migration: 005_add_fullname_nickname

-- إضافة حقل الاسم الرباعي
ALTER TABLE student_affairs.students 
ADD COLUMN IF NOT EXISTS full_name VARCHAR(200);

-- إضافة حقل اللقب
ALTER TABLE student_affairs.students 
ADD COLUMN IF NOT EXISTS nickname VARCHAR(100);

-- إضافة تعليقات على الحقول الجديدة
COMMENT ON COLUMN student_affairs.students.full_name IS 'الاسم الرباعي الكامل للطالب';
COMMENT ON COLUMN student_affairs.students.nickname IS 'لقب الطالب (مثل: أبو محمد)';

-- إنشاء فهرس للبحث السريع في الاسم الرباعي
CREATE INDEX IF NOT EXISTS idx_students_full_name ON student_affairs.students(full_name);

-- إنشاء فهرس للبحث السريع في اللقب
CREATE INDEX IF NOT EXISTS idx_students_nickname ON student_affairs.students(nickname);
