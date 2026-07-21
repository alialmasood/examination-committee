-- إضافة حقل اللقب العلمي إلى جدول التدريسيين

ALTER TABLE hr.teachers
ADD COLUMN IF NOT EXISTS academic_title VARCHAR(50);

-- تعليق على العمود
COMMENT ON COLUMN hr.teachers.academic_title IS 'اللقب العلمي (مدرس مساعد، مدرس، أستاذ مساعد، أستاذ)';

