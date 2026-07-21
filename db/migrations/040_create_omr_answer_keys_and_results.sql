CREATE TABLE IF NOT EXISTS examination_committee.omr_answer_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_name VARCHAR(255) NOT NULL,
    exam_date DATE,
    academic_year VARCHAR(10),
    total_questions INT NOT NULL DEFAULT 25,
    answer_key JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS examination_committee.omr_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES student_affairs.students(id) ON DELETE CASCADE,
    student_code VARCHAR(100) NOT NULL,
    subject_name VARCHAR(255) NOT NULL,
    exam_date DATE,
    total_questions INT NOT NULL,
    correct_count INT NOT NULL,
    wrong_count INT NOT NULL,
    empty_count INT NOT NULL,
    score DECIMAL(8,2) NOT NULL,
    max_score DECIMAL(8,2) NOT NULL,
    answer_key JSONB NOT NULL,
    detected_answers JSONB NOT NULL,
    details JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
