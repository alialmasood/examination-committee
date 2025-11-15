-- إضافة حقل المرحلة إلى جدول المواد التدريسية
ALTER TABLE examination_committee.teaching_subjects
ADD COLUMN IF NOT EXISTS stage VARCHAR(20); -- 'first', 'second', 'third', 'fourth'

-- تحديث البيانات الموجودة لتكون 'first' كقيمة افتراضية
UPDATE examination_committee.teaching_subjects
SET stage = 'first'
WHERE stage IS NULL;

-- إنشاء فهرس للمرحلة
CREATE INDEX IF NOT EXISTS idx_teaching_subjects_stage ON examination_committee.teaching_subjects(stage);

-- تعليق على العمود
COMMENT ON COLUMN examination_committee.teaching_subjects.stage IS 'المرحلة الدراسية: الأولى، الثانية، الثالثة، الرابعة';

