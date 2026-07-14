-- 082: إشعارات دائنة الطلبة — 5.C.2
BEGIN;

INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES
  ('STUDENT_CREDIT_NOTE', 'إشعار دائن طالب', 'SCN', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  prefix_default = EXCLUDED.prefix_default,
  is_active = TRUE;

INSERT INTO accounts.document_sequences
  (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
SELECT 'STUDENT_CREDIT_NOTE', fy.id, 'SCN', 0, 6, TRUE, TRUE
FROM accounts.fiscal_years fy
WHERE NOT EXISTS (
  SELECT 1 FROM accounts.document_sequences ds
  WHERE ds.document_type = 'STUDENT_CREDIT_NOTE' AND ds.fiscal_year_id = fy.id
);

CREATE TABLE IF NOT EXISTS accounts.student_credit_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_number VARCHAR(40) NOT NULL,
  student_account_id UUID NOT NULL
    REFERENCES accounts.student_accounts(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL
    REFERENCES student_affairs.students(id) ON DELETE RESTRICT,
  student_charge_id UUID NULL
    REFERENCES accounts.student_charges(id) ON DELETE RESTRICT,
  student_installment_id UUID NULL
    REFERENCES accounts.student_installments(id) ON DELETE RESTRICT,
  billing_plan_id UUID NULL
    REFERENCES accounts.student_billing_plans(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  credit_note_date DATE NOT NULL,
  reason_code VARCHAR(40) NOT NULL
    CHECK (reason_code IN (
      'FEE_CORRECTION',
      'DUPLICATE_CHARGE',
      'ACADEMIC_WITHDRAWAL',
      'SERVICE_NOT_PROVIDED',
      'ADMINISTRATIVE_ADJUSTMENT',
      'OTHER'
    )),
  reason TEXT NOT NULL,
  amount NUMERIC(18, 3) NOT NULL CHECK (amount > 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'IQD',
  application_mode VARCHAR(32) NOT NULL
    CHECK (application_mode IN ('DEBT_REDUCTION', 'CREDIT_BALANCE_CREATE')),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT','PENDING_APPROVAL','APPROVED','POSTED','REJECTED','VOID'
    )),
  revenue_adjustment_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  journal_entry_id UUID NULL
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  reversal_journal_entry_id UUID NULL
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  external_reference VARCHAR(100) NULL,
  requested_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  approved_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ NULL,
  rejected_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ NULL,
  rejection_reason TEXT NULL,
  posted_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ NULL,
  voided_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ NULL,
  void_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_student_credit_notes_number UNIQUE (credit_note_number),
  CONSTRAINT uq_student_credit_notes_journal UNIQUE (journal_entry_id),
  CONSTRAINT uq_student_credit_notes_rev_journal UNIQUE (reversal_journal_entry_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_scn_external_ref_active
  ON accounts.student_credit_notes (external_reference)
  WHERE external_reference IS NOT NULL
    AND status NOT IN ('VOID', 'REJECTED');

CREATE INDEX IF NOT EXISTS idx_scn_account ON accounts.student_credit_notes (student_account_id);
CREATE INDEX IF NOT EXISTS idx_scn_charge ON accounts.student_credit_notes (student_charge_id);
CREATE INDEX IF NOT EXISTS idx_scn_status ON accounts.student_credit_notes (status);
CREATE INDEX IF NOT EXISTS idx_scn_date ON accounts.student_credit_notes (credit_note_date);

COMMIT;
