CREATE TABLE IF NOT EXISTS examination_committee.omr_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    question_count INT NOT NULL CHECK (question_count > 0 AND question_count <= 200),
    choices_per_question INT NOT NULL DEFAULT 4 CHECK (choices_per_question >= 2 AND choices_per_question <= 8),
    python_template_name VARCHAR(128) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO examination_committee.omr_templates
    (code, name, question_count, choices_per_question, python_template_name, is_active)
VALUES
    ('OMR_25', 'تصحيح OMR - 25 سؤال', 25, 4, 'correction-exam-a4-v1', TRUE),
    ('OMR_50', 'تصحيح OMR - 50 سؤال', 50, 4, 'correction-exam-a4-50q-v1', TRUE),
    ('OMR_75', 'تصحيح OMR - 75 سؤال', 75, 4, 'correction-exam-a4-75q-v1', TRUE),
    ('OMR_100', 'تصحيح OMR - 100 سؤال', 100, 4, 'correction-exam-a4-100q-v1', TRUE)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    question_count = EXCLUDED.question_count,
    choices_per_question = EXCLUDED.choices_per_question,
    python_template_name = EXCLUDED.python_template_name,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();
