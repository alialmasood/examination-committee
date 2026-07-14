-- Migration: 074 — كشوف الحساب والتسوية المصرفية (المرحلة 4.D)
-- كيان موحّد: bank_statements (دورة DRAFT→IN_PROGRESS→RECONCILED→CLOSED)
-- Source of truth للحركات القابلة للمطابقة: journal_entries POSTED على Bank GL

BEGIN;

-- تسلسل رقم الكشف (جدول الأنواع من 073)
INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES ('BANK_STATEMENT', 'كشف حساب مصرفي', 'BST', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  prefix_default = EXCLUDED.prefix_default,
  is_active = TRUE,
  updated_at = NOW();

INSERT INTO accounts.document_sequences
  (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
SELECT 'BANK_STATEMENT', y.id, 'BST', 0, 6, TRUE, TRUE
FROM accounts.fiscal_years y
WHERE NOT EXISTS (
  SELECT 1 FROM accounts.document_sequences s
  WHERE s.document_type = 'BANK_STATEMENT' AND s.fiscal_year_id = y.id
);

CREATE TABLE IF NOT EXISTS accounts.bank_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_number VARCHAR(50) NOT NULL,
  bank_account_id UUID NOT NULL
    REFERENCES accounts.bank_accounts(id) ON DELETE RESTRICT,
  external_statement_reference VARCHAR(100),
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  opening_balance NUMERIC(18,3) NOT NULL,
  closing_balance NUMERIC(18,3) NOT NULL,
  currency_code CHAR(3) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  notes TEXT,
  imported_file_name VARCHAR(255),
  imported_at TIMESTAMPTZ,
  imported_by UUID REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  snapshot_json JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id),
  updated_by UUID REFERENCES student_affairs.users(id),
  started_by UUID REFERENCES student_affairs.users(id),
  reconciled_by UUID REFERENCES student_affairs.users(id),
  closed_by UUID REFERENCES student_affairs.users(id),
  cancelled_by UUID REFERENCES student_affairs.users(id),
  started_at TIMESTAMPTZ,
  reconciled_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_statements_status_check CHECK (
    status IN ('DRAFT', 'IN_PROGRESS', 'RECONCILED', 'CLOSED', 'CANCELLED')
  ),
  CONSTRAINT bank_statements_dates_check CHECK (date_from <= date_to),
  CONSTRAINT bank_statements_currency_check CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT bank_statements_version_positive CHECK (version >= 1),
  CONSTRAINT bank_statements_cancel_reason_check CHECK (
    status <> 'CANCELLED'
    OR (cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_statements_year_number
  ON accounts.bank_statements (statement_number);

CREATE INDEX IF NOT EXISTS idx_bank_statements_account_status
  ON accounts.bank_statements (bank_account_id, status);

CREATE INDEX IF NOT EXISTS idx_bank_statements_dates
  ON accounts.bank_statements (bank_account_id, date_from, date_to);

CREATE INDEX IF NOT EXISTS idx_bank_statements_status
  ON accounts.bank_statements (status);

-- منع تداخل فترات الكشوف غير الملغاة لنفس الحساب
CREATE OR REPLACE FUNCTION accounts.bank_statements_no_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'CANCELLED' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM accounts.bank_statements s
    WHERE s.bank_account_id = NEW.bank_account_id
      AND s.status <> 'CANCELLED'
      AND s.id IS DISTINCT FROM NEW.id
      AND s.date_from <= NEW.date_to
      AND s.date_to >= NEW.date_from
  ) THEN
    RAISE EXCEPTION 'bank statement period overlaps an existing non-cancelled statement'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_statements_no_overlap ON accounts.bank_statements;
CREATE TRIGGER trg_bank_statements_no_overlap
  BEFORE INSERT OR UPDATE OF bank_account_id, date_from, date_to, status
  ON accounts.bank_statements
  FOR EACH ROW
  EXECUTE FUNCTION accounts.bank_statements_no_overlap();

CREATE TABLE IF NOT EXISTS accounts.bank_statement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_statement_id UUID NOT NULL
    REFERENCES accounts.bank_statements(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  transaction_date DATE NOT NULL,
  value_date DATE,
  description TEXT NOT NULL,
  bank_reference VARCHAR(100),
  debit_amount NUMERIC(18,3) NOT NULL DEFAULT 0,
  credit_amount NUMERIC(18,3) NOT NULL DEFAULT 0,
  running_balance NUMERIC(18,3),
  currency_code CHAR(3) NOT NULL,
  external_line_id VARCHAR(100),
  fingerprint VARCHAR(64) NOT NULL,
  match_status VARCHAR(30) NOT NULL DEFAULT 'UNMATCHED',
  exclusion_reason TEXT,
  notes TEXT,
  adjustment_journal_entry_id UUID
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_statement_lines_line_number_positive CHECK (line_number >= 1),
  CONSTRAINT bank_statement_lines_amounts_nonneg CHECK (
    debit_amount >= 0 AND credit_amount >= 0
  ),
  CONSTRAINT bank_statement_lines_one_side CHECK (
    (debit_amount > 0 AND credit_amount = 0)
    OR (credit_amount > 0 AND debit_amount = 0)
  ),
  CONSTRAINT bank_statement_lines_currency_check CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT bank_statement_lines_description_check CHECK (length(trim(description)) > 0),
  CONSTRAINT bank_statement_lines_match_status_check CHECK (
    match_status IN ('UNMATCHED', 'PARTIALLY_MATCHED', 'MATCHED', 'EXCLUDED')
  ),
  CONSTRAINT bank_statement_lines_excluded_reason_check CHECK (
    match_status <> 'EXCLUDED'
    OR (exclusion_reason IS NOT NULL AND length(trim(exclusion_reason)) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_statement_lines_number
  ON accounts.bank_statement_lines (bank_statement_id, line_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_statement_lines_fingerprint
  ON accounts.bank_statement_lines (bank_statement_id, fingerprint);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_statement_lines_external
  ON accounts.bank_statement_lines (bank_statement_id, external_line_id)
  WHERE external_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_statement_status
  ON accounts.bank_statement_lines (bank_statement_id, match_status);

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_date
  ON accounts.bank_statement_lines (bank_statement_id, transaction_date);

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_reference
  ON accounts.bank_statement_lines (bank_reference)
  WHERE bank_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS accounts.bank_reconciliation_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_statement_id UUID NOT NULL
    REFERENCES accounts.bank_statements(id) ON DELETE CASCADE,
  bank_statement_line_id UUID NOT NULL
    REFERENCES accounts.bank_statement_lines(id) ON DELETE CASCADE,
  journal_entry_id UUID NOT NULL
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  journal_entry_line_id UUID
    REFERENCES accounts.journal_entry_lines(id) ON DELETE RESTRICT,
  matched_amount NUMERIC(18,3) NOT NULL,
  match_type VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  confidence NUMERIC(5,2),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_recon_matches_amount_positive CHECK (matched_amount > 0),
  CONSTRAINT bank_recon_matches_type_check CHECK (
    match_type IN (
      'MANUAL', 'REFERENCE', 'AMOUNT_DATE', 'SYSTEM_SUGGESTED', 'ADJUSTMENT'
    )
  ),
  CONSTRAINT bank_recon_matches_confidence_check CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 100)
  )
);

CREATE INDEX IF NOT EXISTS idx_bank_recon_matches_statement
  ON accounts.bank_reconciliation_matches (bank_statement_id);

CREATE INDEX IF NOT EXISTS idx_bank_recon_matches_line
  ON accounts.bank_reconciliation_matches (bank_statement_line_id);

CREATE INDEX IF NOT EXISTS idx_bank_recon_matches_journal
  ON accounts.bank_reconciliation_matches (journal_entry_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_recon_match_line_jel
  ON accounts.bank_reconciliation_matches (
    bank_statement_line_id, journal_entry_id, COALESCE(journal_entry_line_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- فهارس مساعدة لجلب حركات Bank GL
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account_entry
  ON accounts.journal_entry_lines (account_id, journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_journal_entries_status_date
  ON accounts.journal_entries (status, entry_date);

CREATE INDEX IF NOT EXISTS idx_journal_entries_reference_number
  ON accounts.journal_entries (reference_number)
  WHERE reference_number IS NOT NULL;

COMMENT ON TABLE accounts.bank_statements IS
  '4.D كشوف/تسوية مصرفية — دورة DRAFT→IN_PROGRESS→RECONCILED→CLOSED';
COMMENT ON TABLE accounts.bank_statement_lines IS
  'سطور كشف المصرف. Debit=خروج من الحساب بحسب المصرف؛ Credit=دخول.';
COMMENT ON TABLE accounts.bank_reconciliation_matches IS
  'مطابقات سطر كشف ↔ قيد/سطر دفتر. تدعم 1:1 و1:N وN:1 وجزئية.';
COMMENT ON COLUMN accounts.bank_statement_lines.debit_amount IS
  'خروج من الحساب البنكي بحسب المصرف (يقابل Credit على Bank GL)';
COMMENT ON COLUMN accounts.bank_statement_lines.credit_amount IS
  'دخول إلى الحساب البنكي بحسب المصرف (يقابل Debit على Bank GL)';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM accounts.document_sequence_types WHERE code = 'BANK_STATEMENT'
  ) THEN
    RAISE EXCEPTION '074 validation failed: BANK_STATEMENT sequence type missing';
  END IF;
  IF to_regclass('accounts.bank_statements') IS NULL THEN
    RAISE EXCEPTION '074 validation failed: bank_statements missing';
  END IF;
  IF to_regclass('accounts.bank_statement_lines') IS NULL THEN
    RAISE EXCEPTION '074 validation failed: bank_statement_lines missing';
  END IF;
  IF to_regclass('accounts.bank_reconciliation_matches') IS NULL THEN
    RAISE EXCEPTION '074 validation failed: bank_reconciliation_matches missing';
  END IF;
END $$;

COMMIT;
