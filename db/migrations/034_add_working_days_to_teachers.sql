-- إضافة حقل عدد أيام الدوام إلى جدول التدريسيين

ALTER TABLE hr.teachers
ADD COLUMN IF NOT EXISTS working_days VARCHAR(50);

-- تعليق على العمود
COMMENT ON COLUMN hr.teachers.working_days IS 'عدد أيام الدوام في الأسبوع';

