-- كشوف صرف الرواتب الشهرية اليدوية (منفصلة عن محرك التشغيلات)
CREATE TABLE IF NOT EXISTS accounts.payroll_disbursement_months (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  year_label VARCHAR(10) NOT NULL,
  month_number SMALLINT NOT NULL CHECK (month_number BETWEEN 1 AND 12),
  status VARCHAR(20) NOT NULL DEFAULT 'EMPTY'
    CHECK (status IN ('EMPTY', 'DRAFT', 'SAVED', 'LOCKED', 'DISBURSED')),
  notes TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_disbursement_months UNIQUE (fiscal_year_id, month_number)
);

CREATE INDEX IF NOT EXISTS idx_payroll_disbursement_months_year
  ON accounts.payroll_disbursement_months (fiscal_year_id);

CREATE TABLE IF NOT EXISTS accounts.payroll_disbursement_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disbursement_month_id UUID NOT NULL
    REFERENCES accounts.payroll_disbursement_months(id) ON DELETE CASCADE,
  person_category VARCHAR(30) NOT NULL
    CHECK (person_category IN (
      'TEACHING_STAFF', 'EXTERNAL_LECTURER', 'EMPLOYEE', 'DAILY_WORKER'
    )),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SAVED', 'LOCKED', 'DISBURSED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_disbursement_sheets UNIQUE (disbursement_month_id, person_category)
);

CREATE INDEX IF NOT EXISTS idx_payroll_disbursement_sheets_month
  ON accounts.payroll_disbursement_sheets (disbursement_month_id);

CREATE TABLE IF NOT EXISTS accounts.payroll_disbursement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL
    REFERENCES accounts.payroll_disbursement_sheets(id) ON DELETE CASCADE,
  payroll_person_id UUID NOT NULL
    REFERENCES accounts.payroll_people(id) ON DELETE RESTRICT,
  person_code_snapshot VARCHAR(40) NOT NULL,
  person_name_snapshot VARCHAR(200) NOT NULL,
  base_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (base_amount >= 0),
  notes TEXT NULL,
  line_status VARCHAR(20) NOT NULL DEFAULT 'EMPTY'
    CHECK (line_status IN ('EMPTY', 'ENTERED', 'SAVED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_disbursement_lines UNIQUE (sheet_id, payroll_person_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_disbursement_lines_sheet
  ON accounts.payroll_disbursement_lines (sheet_id);
CREATE INDEX IF NOT EXISTS idx_payroll_disbursement_lines_person
  ON accounts.payroll_disbursement_lines (payroll_person_id);

CREATE TABLE IF NOT EXISTS accounts.payroll_disbursement_assignment_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disbursement_line_id UUID NOT NULL
    REFERENCES accounts.payroll_disbursement_lines(id) ON DELETE CASCADE,
  payroll_assignment_id UUID NOT NULL
    REFERENCES accounts.payroll_assignments(id) ON DELETE RESTRICT,
  assignment_code_snapshot VARCHAR(40) NOT NULL,
  assignment_title_snapshot VARCHAR(200) NOT NULL,
  amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  is_partial BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_disbursement_assignment_lines UNIQUE (disbursement_line_id, payroll_assignment_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_disbursement_assignment_lines_line
  ON accounts.payroll_disbursement_assignment_lines (disbursement_line_id);
