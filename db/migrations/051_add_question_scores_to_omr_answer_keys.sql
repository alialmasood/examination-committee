ALTER TABLE examination_committee.omr_answer_keys
ADD COLUMN IF NOT EXISTS question_scores JSONB NOT NULL DEFAULT '{}'::jsonb;
