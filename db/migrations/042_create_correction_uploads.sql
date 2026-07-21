CREATE TABLE IF NOT EXISTS examination_committee.correction_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name VARCHAR(255) NOT NULL,
    inserted_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE examination_committee.correction_students
ADD COLUMN IF NOT EXISTS upload_id UUID REFERENCES examination_committee.correction_uploads(id) ON DELETE CASCADE;
