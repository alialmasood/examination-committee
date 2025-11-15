-- إضافة حقل وجود العملي إلى جدول المواد التدريسية
ALTER TABLE examination_committee.teaching_subjects
ADD COLUMN IF NOT EXISTS has_practical BOOLEAN DEFAULT true;

-- تحديث البيانات الموجودة لتكون true كقيمة افتراضية (المواد الحالية كلها لها عملي)
UPDATE examination_committee.teaching_subjects
SET has_practical = true
WHERE has_practical IS NULL;

-- تعليق على العمود
COMMENT ON COLUMN examination_committee.teaching_subjects.has_practical IS 'هل المادة لها جزء عملي: true = لها عملي ونظري (60 درجة), false = نظري فقط (70 درجة)';

