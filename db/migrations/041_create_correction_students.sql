CREATE TABLE IF NOT EXISTS examination_committee.correction_students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_no INT,
    student_code VARCHAR(100) NOT NULL,
    department VARCHAR(255) NOT NULL,
    student_name VARCHAR(255) NOT NULL,
    stage VARCHAR(100) NOT NULL,
    study_type VARCHAR(20) NOT NULL CHECK (study_type IN ('morning', 'evening')),
    sheet_code CHAR(5) NOT NULL UNIQUE CHECK (sheet_code ~ '^[0-9]{5}$'),
    source_file VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
