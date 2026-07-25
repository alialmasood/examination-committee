-- بيانات إضافية للكادر التدريسي ضمن سجل أشخاص الرواتب
ALTER TABLE accounts.payroll_people
  ADD COLUMN IF NOT EXISTS academic_title VARCHAR(40) NULL
    CHECK (
      academic_title IS NULL OR academic_title IN (
        'مدرس', 'مدرس مساعد', 'استاذ', 'استاذ مساعد'
      )
    );

ALTER TABLE accounts.payroll_people
  ADD COLUMN IF NOT EXISTS degree VARCHAR(40) NULL
    CHECK (
      degree IS NULL OR degree IN (
        'دبلوم', 'دبلوم عالي', 'بكالوريوس', 'ماجستير', 'دكتوراه'
      )
    );

ALTER TABLE accounts.payroll_people
  ADD COLUMN IF NOT EXISTS phone VARCHAR(40) NULL;

ALTER TABLE accounts.payroll_people
  ADD COLUMN IF NOT EXISTS job_title VARCHAR(200) NULL;

ALTER TABLE accounts.payroll_people
  ADD COLUMN IF NOT EXISTS university_id VARCHAR(64) NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_people_university_id
  ON accounts.payroll_people (university_id)
  WHERE university_id IS NOT NULL;
