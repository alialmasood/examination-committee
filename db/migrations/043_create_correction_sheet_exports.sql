-- سجل عمليات تصدير شيتات التصحيح (باسم المادة وتاريخ الامتحان)

CREATE TABLE IF NOT EXISTS examination_committee.correction_sheet_exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_name VARCHAR(255) NOT NULL,
    exam_date DATE NOT NULL,
    teacher_name VARCHAR(255),
    department_filter VARCHAR(255),
    stage_filter VARCHAR(255),
    study_type_filter VARCHAR(20),
    student_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_correction_sheet_exports_subject_date
ON examination_committee.correction_sheet_exports(subject_name, exam_date);
