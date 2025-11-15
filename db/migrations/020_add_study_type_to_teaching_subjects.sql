-- إضافة حقل نوع الدراسة إلى جدول المواد التدريسية
ALTER TABLE examination_committee.teaching_subjects
ADD COLUMN IF NOT EXISTS study_type VARCHAR(20) DEFAULT 'morning';

-- تحديث البيانات الموجودة لتكون 'morning' كقيمة افتراضية
UPDATE examination_committee.teaching_subjects
SET study_type = 'morning'
WHERE study_type IS NULL;

-- إضافة قيد للتحقق من القيم
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'teaching_subjects_check_study_type' 
        AND conrelid = 'examination_committee.teaching_subjects'::regclass
    ) THEN
        ALTER TABLE examination_committee.teaching_subjects
        ADD CONSTRAINT teaching_subjects_check_study_type 
        CHECK (study_type IN ('morning', 'evening'));
    END IF;
END $$;

-- إنشاء فهرس لنوع الدراسة
CREATE INDEX IF NOT EXISTS idx_teaching_subjects_study_type ON examination_committee.teaching_subjects(study_type);

-- تعليق على العمود
COMMENT ON COLUMN examination_committee.teaching_subjects.study_type IS 'نوع الدراسة: صباحي أو مسائي';

