-- مواد دراسية لنظام التصحيح (قائمة مرجعية قبل التصدير)

CREATE TABLE IF NOT EXISTS examination_committee.correction_subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_name VARCHAR(255) NOT NULL,
    subject_code VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_correction_subjects_created
  ON examination_committee.correction_subjects (created_at DESC);
