-- توسيع الشهادة + حقول الكادر الوظيفي
ALTER TABLE accounts.payroll_people
  ADD COLUMN IF NOT EXISTS job_classification VARCHAR(40) NULL;

ALTER TABLE accounts.payroll_people
  ADD COLUMN IF NOT EXISTS workplace VARCHAR(200) NULL;

-- إسقاط قيد الشهادة القديم (إن وُجد) ثم إعادة إنشائه بالقيم الموسّعة
DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'accounts'
    AND rel.relname = 'payroll_people'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%degree%';

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE accounts.payroll_people DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE accounts.payroll_people
  ADD CONSTRAINT ck_payroll_people_degree
  CHECK (
    degree IS NULL OR degree IN (
      'يقرأ ويكتب',
      'ابتدائية',
      'متوسطة',
      'اعدادية',
      'دبلوم',
      'دبلوم عالي',
      'بكالوريوس',
      'ماجستير',
      'دكتوراه'
    )
  );

DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'accounts'
    AND rel.relname = 'payroll_people'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%job_classification%';

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE accounts.payroll_people DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE accounts.payroll_people
  ADD CONSTRAINT ck_payroll_people_job_classification
  CHECK (
    job_classification IS NULL OR job_classification IN (
      'فني', 'اداري', 'خدمي', 'حرفي'
    )
  );
