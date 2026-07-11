-- Migration: نواة القيود المحاسبية والقيد المزدوج (الخطوة 2)
-- Schema: accounts
-- لا يعدّل migrations 058 / 059 / 060

BEGIN;

-- =========================
-- رأس القيد
-- =========================
CREATE TABLE IF NOT EXISTS accounts.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number VARCHAR(50) NOT NULL,
  fiscal_year_id UUID NOT NULL REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  entry_date DATE NOT NULL,
  entry_type VARCHAR(30) NOT NULL,
  source_type VARCHAR(40),
  source_id UUID,
  reference_number VARCHAR(100),
  description TEXT NOT NULL,
  total_debit NUMERIC(18,3) NOT NULL DEFAULT 0,
  total_credit NUMERIC(18,3) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  is_reversal BOOLEAN NOT NULL DEFAULT FALSE,
  reverses_entry_id UUID REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  reversal_entry_id UUID REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  rejection_reason TEXT,
  cancellation_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id),
  updated_by UUID REFERENCES student_affairs.users(id),
  reviewed_by UUID REFERENCES student_affairs.users(id),
  approved_by UUID REFERENCES student_affairs.users(id),
  posted_by UUID REFERENCES student_affairs.users(id),
  reversed_by UUID REFERENCES student_affairs.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  CONSTRAINT journal_entries_entry_type_check CHECK (
    entry_type IN (
      'MANUAL', 'OPENING', 'RECEIPT', 'PAYMENT', 'TRANSFER',
      'STUDENT_FEE', 'SALARY', 'ADJUSTMENT', 'CLOSING', 'REVERSAL'
    )
  ),
  CONSTRAINT journal_entries_status_check CHECK (
    status IN (
      'DRAFT', 'PENDING_REVIEW', 'REVIEWED', 'APPROVED',
      'POSTED', 'REJECTED', 'REVERSED', 'CANCELLED'
    )
  ),
  CONSTRAINT journal_entries_amounts_nonneg_check CHECK (
    total_debit >= 0 AND total_credit >= 0
  ),
  CONSTRAINT journal_entries_version_positive_check CHECK (version >= 1),
  CONSTRAINT journal_entries_description_not_blank_check CHECK (
    length(trim(description)) > 0
  ),
  CONSTRAINT journal_entries_posted_integrity_check CHECK (
    status <> 'POSTED'
    OR (
      total_debit > 0
      AND total_credit > 0
      AND total_debit = total_credit
      AND posted_by IS NOT NULL
      AND posted_at IS NOT NULL
    )
  ),
  CONSTRAINT journal_entries_reversal_flags_check CHECK (
    (is_reversal = FALSE AND reverses_entry_id IS NULL)
    OR (is_reversal = TRUE AND reverses_entry_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_year_number
  ON accounts.journal_entries (fiscal_year_id, entry_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_source
  ON accounts.journal_entries (source_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_fiscal_year
  ON accounts.journal_entries (fiscal_year_id);

CREATE INDEX IF NOT EXISTS idx_journal_entries_fiscal_period
  ON accounts.journal_entries (fiscal_period_id);

CREATE INDEX IF NOT EXISTS idx_journal_entries_entry_date
  ON accounts.journal_entries (entry_date);

CREATE INDEX IF NOT EXISTS idx_journal_entries_status
  ON accounts.journal_entries (status);

CREATE INDEX IF NOT EXISTS idx_journal_entries_entry_type
  ON accounts.journal_entries (entry_type);

CREATE INDEX IF NOT EXISTS idx_journal_entries_source
  ON accounts.journal_entries (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_journal_entries_created_by
  ON accounts.journal_entries (created_by);

CREATE INDEX IF NOT EXISTS idx_journal_entries_posted_at
  ON accounts.journal_entries (posted_at);

CREATE INDEX IF NOT EXISTS idx_journal_entries_reverses
  ON accounts.journal_entries (reverses_entry_id);

COMMENT ON TABLE accounts.journal_entries IS 'رأس القيود المحاسبية (قيد مزدوج)';
COMMENT ON COLUMN accounts.journal_entries.version IS 'إصدار للتزامن المتفائل (optimistic concurrency)';

-- =========================
-- سطور القيد
-- =========================
CREATE TABLE IF NOT EXISTS accounts.journal_entry_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES accounts.journal_entries(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_center_id UUID REFERENCES accounts.cost_centers(id) ON DELETE RESTRICT,
  description TEXT,
  debit_amount NUMERIC(18,3) NOT NULL DEFAULT 0,
  credit_amount NUMERIC(18,3) NOT NULL DEFAULT 0,
  reference_type VARCHAR(40),
  reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT journal_entry_lines_line_number_positive CHECK (line_number > 0),
  CONSTRAINT journal_entry_lines_amounts_nonneg_check CHECK (
    debit_amount >= 0 AND credit_amount >= 0
  ),
  CONSTRAINT journal_entry_lines_one_side_check CHECK (
    (debit_amount > 0 AND credit_amount = 0)
    OR (credit_amount > 0 AND debit_amount = 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entry_lines_number
  ON accounts.journal_entry_lines (journal_entry_id, line_number);

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry
  ON accounts.journal_entry_lines (journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account
  ON accounts.journal_entry_lines (account_id);

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_cost_center
  ON accounts.journal_entry_lines (cost_center_id);

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_reference
  ON accounts.journal_entry_lines (reference_type, reference_id);

COMMENT ON TABLE accounts.journal_entry_lines IS 'سطور القيود المحاسبية (مدين/دائن)';

COMMIT;
