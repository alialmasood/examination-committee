-- ربط مفتاح الإجابة بمادة + تاريخ فريد، وحقل رمز المادة اختياري

ALTER TABLE examination_committee.omr_answer_keys
  ADD COLUMN IF NOT EXISTS subject_code VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS idx_omr_answer_keys_subject_name_exam_date
  ON examination_committee.omr_answer_keys (subject_name, exam_date);
