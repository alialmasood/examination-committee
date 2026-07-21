-- إضافة teacher_id إلى جدول المواد التدريسية لربطها بالتدريسي
-- هذا يسمح بالربط بين hr.teachers و examination_committee.teaching_subjects

ALTER TABLE examination_committee.teaching_subjects
ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES hr.teachers(id) ON DELETE SET NULL;

-- إنشاء فهرس للربط السريع
CREATE INDEX IF NOT EXISTS idx_teaching_subjects_teacher_id ON examination_committee.teaching_subjects(teacher_id);

-- محاولة ربط المواد الموجودة بالتدريسيين حسب الاسم (إذا تطابق)
-- يمكن تنفيذ هذا بشكل يدوي لاحقاً إذا لزم الأمر
UPDATE examination_committee.teaching_subjects ts
SET teacher_id = (
  SELECT t.id 
  FROM hr.teachers t 
  WHERE t.full_name_ar = ts.instructor_name 
     OR t.full_name = ts.instructor_name
  LIMIT 1
)
WHERE teacher_id IS NULL;

-- تعليق على العمود
COMMENT ON COLUMN examination_committee.teaching_subjects.teacher_id IS 'معرف التدريسي المرتبط بهذه المادة';

