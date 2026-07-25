-- جهة الانتساب للمحاضرين الخارجيين ضمن سجل أشخاص الرواتب
ALTER TABLE accounts.payroll_people
  ADD COLUMN IF NOT EXISTS affiliation VARCHAR(200) NULL;
