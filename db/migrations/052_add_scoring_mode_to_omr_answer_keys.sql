ALTER TABLE examination_committee.omr_answer_keys
ADD COLUMN IF NOT EXISTS score_mode VARCHAR(16) NOT NULL DEFAULT 'variable';

ALTER TABLE examination_committee.omr_answer_keys
ADD COLUMN IF NOT EXISTS fixed_question_score NUMERIC(10,2);
