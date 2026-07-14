-- 075: Student Accounts & Receivables Foundation (5.A)
-- Link: student_id -> student_affairs.students(id) — no duplicate students table
-- SoT: journal_entries POSTED; Student Ledger = operational subledger

BEGIN;

INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES
  ('STUDENT_ACCOUNT', 'حساب مالي للطالب', 'STA', TRUE),
  ('STUDENT_CHARGE', 'مطالبة مالية على طالب', 'SCH', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  prefix_default = EXCLUDED.prefix_default,
  is_active = TRUE,
  updated_at = NOW();

INSERT INTO accounts.document_sequences
  (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
SELECT 'STUDENT_ACCOUNT', fy.id, 'STA', 0, 6, TRUE, TRUE
FROM accounts.fiscal_years fy
WHERE NOT EXISTS (
  SELECT 1 FROM accounts.document_sequences ds
  WHERE ds.document_type = 'STUDENT_ACCOUNT' AND ds.fiscal_year_id = fy.id
);

INSERT INTO accounts.document_sequences
  (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
SELECT 'STUDENT_CHARGE', fy.id, 'SCH', 0, 6, TRUE, TRUE
FROM accounts.fiscal_years fy
WHERE NOT EXISTS (
  SELECT 1 FROM accounts.document_sequences ds
  WHERE ds.document_type = 'STUDENT_CHARGE' AND ds.fiscal_year_id = fy.id
);

CREATE TABLE IF NOT EXISTS accounts.student_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL
    REFERENCES student_affairs.students(id) ON DELETE RESTRICT,
  account_number VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
  receivable_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  department_id UUID NULL
    REFERENCES student_affairs.departments(id) ON DELETE SET NULL,
  academic_year VARCHAR(20) NULL,
  opening_reference TEXT NULL,
  notes TEXT NULL,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  suspended_at TIMESTAMPTZ NULL,
  suspended_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ NULL,
  closed_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  CONSTRAINT uq_student_accounts_number UNIQUE (account_number),
  CONSTRAINT uq_student_accounts_student_currency UNIQUE (student_id, currency_code)
);

CREATE INDEX IF NOT EXISTS idx_student_accounts_student ON accounts.student_accounts (student_id);
CREATE INDEX IF NOT EXISTS idx_student_accounts_status ON accounts.student_accounts (status);
CREATE INDEX IF NOT EXISTS idx_student_accounts_gl ON accounts.student_accounts (receivable_gl_account_id);
CREATE INDEX IF NOT EXISTS idx_student_accounts_department ON accounts.student_accounts (department_id);

COMMENT ON TABLE accounts.student_accounts IS
  'One financial account per student/currency — detail in Student Subledger';
COMMENT ON COLUMN accounts.student_accounts.opening_reference IS
  'Reference note only — never included in ledger balance (5.A)';

CREATE TABLE IF NOT EXISTS accounts.student_fee_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NULL,
  category VARCHAR(40) NOT NULL
    CHECK (category IN (
      'TUITION', 'REGISTRATION', 'LAB', 'EXAM', 'SERVICE',
      'TRANSPORT', 'ACCOMMODATION', 'OTHER'
    )),
  revenue_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  default_amount NUMERIC(18, 3) NULL
    CHECK (default_amount IS NULL OR default_amount > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
  requires_cost_center BOOLEAN NOT NULL DEFAULT FALSE,
  default_cost_center_id UUID NULL
    REFERENCES accounts.cost_centers(id) ON DELETE SET NULL,
  is_tuition BOOLEAN NOT NULL DEFAULT FALSE,
  is_refundable BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT NULL,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_student_fee_types_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_student_fee_types_active ON accounts.student_fee_types (is_active);
CREATE INDEX IF NOT EXISTS idx_student_fee_types_category ON accounts.student_fee_types (category);
CREATE INDEX IF NOT EXISTS idx_student_fee_types_revenue ON accounts.student_fee_types (revenue_gl_account_id);

CREATE TABLE IF NOT EXISTS accounts.student_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_number VARCHAR(40) NOT NULL,
  student_account_id UUID NOT NULL
    REFERENCES accounts.student_accounts(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL
    REFERENCES student_affairs.students(id) ON DELETE RESTRICT,
  fee_type_id UUID NOT NULL
    REFERENCES accounts.student_fee_types(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  academic_year VARCHAR(20) NULL,
  charge_date DATE NOT NULL,
  due_date DATE NULL,
  original_amount NUMERIC(18, 3) NOT NULL CHECK (original_amount > 0),
  outstanding_amount NUMERIC(18, 3) NOT NULL CHECK (outstanding_amount >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
  cost_center_id UUID NULL
    REFERENCES accounts.cost_centers(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  external_reference VARCHAR(100) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'POSTED', 'PARTIALLY_SETTLED', 'SETTLED', 'VOID')),
  journal_entry_id UUID NULL
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  reversal_journal_entry_id UUID NULL
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  posted_at TIMESTAMPTZ NULL,
  posted_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ NULL,
  voided_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  void_reason TEXT NULL,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_student_charges_number UNIQUE (charge_number),
  CONSTRAINT chk_student_charges_outstanding_le_original
    CHECK (outstanding_amount <= original_amount)
);

CREATE INDEX IF NOT EXISTS idx_student_charges_account ON accounts.student_charges (student_account_id, status);
CREATE INDEX IF NOT EXISTS idx_student_charges_student ON accounts.student_charges (student_id, status);
CREATE INDEX IF NOT EXISTS idx_student_charges_date ON accounts.student_charges (charge_date);
CREATE INDEX IF NOT EXISTS idx_student_charges_fee_type ON accounts.student_charges (fee_type_id);
CREATE INDEX IF NOT EXISTS idx_student_charges_fiscal ON accounts.student_charges (fiscal_year_id, fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_student_charges_journal
  ON accounts.student_charges (journal_entry_id) WHERE journal_entry_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS accounts.student_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_account_id UUID NOT NULL
    REFERENCES accounts.student_accounts(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL
    REFERENCES student_affairs.students(id) ON DELETE RESTRICT,
  entry_date DATE NOT NULL,
  entry_type VARCHAR(40) NOT NULL
    CHECK (entry_type IN ('CHARGE', 'CHARGE_REVERSAL', 'OPENING_REFERENCE', 'ADJUSTMENT')),
  source_type VARCHAR(40) NOT NULL,
  source_id UUID NOT NULL,
  description TEXT NOT NULL,
  debit_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
  journal_entry_id UUID NULL
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  created_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_student_ledger_one_side CHECK (
    (debit_amount > 0 AND credit_amount = 0)
    OR (credit_amount > 0 AND debit_amount = 0)
  ),
  CONSTRAINT uq_student_ledger_source_type UNIQUE (source_type, source_id, entry_type)
);

CREATE INDEX IF NOT EXISTS idx_student_ledger_account_date
  ON accounts.student_ledger_entries (student_account_id, entry_date, created_at);
CREATE INDEX IF NOT EXISTS idx_student_ledger_student
  ON accounts.student_ledger_entries (student_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_student_ledger_source
  ON accounts.student_ledger_entries (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_student_ledger_journal
  ON accounts.student_ledger_entries (journal_entry_id) WHERE journal_entry_id IS NOT NULL;

COMMENT ON TABLE accounts.student_ledger_entries IS
  'Operational Student Subledger — general SoT remains POSTED journal entries';

COMMIT;
