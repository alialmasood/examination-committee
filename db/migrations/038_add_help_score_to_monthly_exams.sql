-- إضافة عمود help_score (مساعدة) إلى جدول monthly_exams

ALTER TABLE examination_committee.monthly_exams
ADD COLUMN IF NOT EXISTS help_score DECIMAL(5,2);

COMMENT ON COLUMN examination_committee.monthly_exams.help_score IS 'درجة المساعدة للطالب';

