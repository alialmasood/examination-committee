-- مواد التصحيح: قسم وأستاذ ومرحلة + رمز مادة فريد يولّده النظام

ALTER TABLE examination_committee.correction_subjects
  ADD COLUMN IF NOT EXISTS department VARCHAR(255),
  ADD COLUMN IF NOT EXISTS teacher_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stage VARCHAR(100);

UPDATE examination_committee.correction_subjects
SET department = 'غير محدد'
WHERE department IS NULL OR TRIM(department) = '';

UPDATE examination_committee.correction_subjects
SET teacher_name = 'غير محدد'
WHERE teacher_name IS NULL OR TRIM(teacher_name) = '';

UPDATE examination_committee.correction_subjects
SET stage = 'غير محدد'
WHERE stage IS NULL OR TRIM(stage) = '';

UPDATE examination_committee.correction_subjects
SET subject_code = 'MAT' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', ''), 1, 12))
WHERE subject_code IS NULL OR TRIM(subject_code) = '';

ALTER TABLE examination_committee.correction_subjects
  ALTER COLUMN department SET NOT NULL,
  ALTER COLUMN teacher_name SET NOT NULL,
  ALTER COLUMN stage SET NOT NULL,
  ALTER COLUMN subject_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_correction_subjects_code_unique
  ON examination_committee.correction_subjects (subject_code);

CREATE INDEX IF NOT EXISTS idx_correction_subjects_department_stage
  ON examination_committee.correction_subjects (department, stage);
