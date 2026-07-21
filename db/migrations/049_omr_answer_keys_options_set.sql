-- إضافة خيارات السؤال المسموحة لكل امتحان (A/B/C/D أو A/B/C/D/E ...)

ALTER TABLE examination_committee.omr_answer_keys
  ADD COLUMN IF NOT EXISTS options_set JSONB NOT NULL DEFAULT '["A","B","C","D"]'::jsonb;
