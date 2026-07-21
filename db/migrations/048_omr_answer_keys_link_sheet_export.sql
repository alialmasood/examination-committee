-- ربط مفتاح الإجابة بسجل «الامتحانات المكونة» (correction_sheet_exports)

ALTER TABLE examination_committee.omr_answer_keys
  ADD COLUMN IF NOT EXISTS sheet_export_id UUID REFERENCES examination_committee.correction_sheet_exports(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS examination_committee.idx_omr_answer_keys_subject_name_exam_date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_omr_answer_keys_sheet_export_id
  ON examination_committee.omr_answer_keys(sheet_export_id);
