-- مخصصات واستقطاعات أسطر كشوف صرف الرواتب
ALTER TABLE accounts.payroll_disbursement_lines
  ADD COLUMN IF NOT EXISTS allowances_amount NUMERIC(18, 3) NOT NULL DEFAULT 0;

ALTER TABLE accounts.payroll_disbursement_lines
  ADD COLUMN IF NOT EXISTS deductions_amount NUMERIC(18, 3) NOT NULL DEFAULT 0;
