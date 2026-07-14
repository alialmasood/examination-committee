-- 083: استردادات الطلبة + credit_note_amount + توسيع Ledger — 5.C.2
BEGIN;

INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES
  ('STUDENT_REFUND', 'استرداد طالب', 'SRF', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  prefix_default = EXCLUDED.prefix_default,
  is_active = TRUE;

INSERT INTO accounts.document_sequences
  (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
SELECT 'STUDENT_REFUND', fy.id, 'SRF', 0, 6, TRUE, TRUE
FROM accounts.fiscal_years fy
WHERE NOT EXISTS (
  SELECT 1 FROM accounts.document_sequences ds
  WHERE ds.document_type = 'STUDENT_REFUND' AND ds.fiscal_year_id = fy.id
);

ALTER TABLE accounts.student_installments
  ADD COLUMN IF NOT EXISTS credit_note_amount NUMERIC(18, 3) NOT NULL DEFAULT 0
    CHECK (credit_note_amount >= 0);

ALTER TABLE accounts.student_installments
  DROP CONSTRAINT IF EXISTS chk_student_installments_outstanding_eq;

ALTER TABLE accounts.student_installments
  ADD CONSTRAINT chk_student_installments_outstanding_eq CHECK (
    outstanding_amount = amount - paid_amount - relief_amount - credit_note_amount
  );

ALTER TABLE accounts.student_installments
  DROP CONSTRAINT IF EXISTS chk_student_installments_settlement_le_amount;

ALTER TABLE accounts.student_installments
  ADD CONSTRAINT chk_student_installments_settlement_le_amount CHECK (
    paid_amount + relief_amount + credit_note_amount <= amount
  );

ALTER TABLE accounts.student_ledger_entries
  DROP CONSTRAINT IF EXISTS student_ledger_entries_entry_type_check;

ALTER TABLE accounts.student_ledger_entries
  ADD CONSTRAINT student_ledger_entries_entry_type_check CHECK (
    entry_type IN (
      'CHARGE',
      'CHARGE_REVERSAL',
      'COLLECTION',
      'COLLECTION_REVERSAL',
      'RELIEF',
      'RELIEF_REVERSAL',
      'CREDIT_NOTE',
      'CREDIT_NOTE_REVERSAL',
      'REFUND',
      'REFUND_REVERSAL',
      'OPENING_REFERENCE',
      'ADJUSTMENT'
    )
  );

CREATE TABLE IF NOT EXISTS accounts.student_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_number VARCHAR(40) NOT NULL,
  student_account_id UUID NOT NULL
    REFERENCES accounts.student_accounts(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL
    REFERENCES student_affairs.students(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  refund_date DATE NOT NULL,
  amount NUMERIC(18, 3) NOT NULL CHECK (amount > 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'IQD',
  payment_method VARCHAR(10) NOT NULL
    CHECK (payment_method IN ('CASH', 'BANK')),
  cash_box_id UUID NULL
    REFERENCES accounts.cash_boxes(id) ON DELETE RESTRICT,
  cash_box_session_id UUID NULL
    REFERENCES accounts.cash_box_sessions(id) ON DELETE RESTRICT,
  bank_account_id UUID NULL
    REFERENCES accounts.bank_accounts(id) ON DELETE RESTRICT,
  cash_voucher_id UUID NULL
    REFERENCES accounts.cash_vouchers(id) ON DELETE RESTRICT,
  bank_voucher_id UUID NULL
    REFERENCES accounts.bank_vouchers(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT','PENDING_APPROVAL','APPROVED','POSTED','REJECTED','VOID'
    )),
  reason TEXT NOT NULL,
  beneficiary_name VARCHAR(200) NULL,
  payer_reference VARCHAR(100) NULL,
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
  CONSTRAINT uq_student_refunds_number UNIQUE (refund_number),
  CONSTRAINT uq_student_refunds_cash_voucher UNIQUE (cash_voucher_id),
  CONSTRAINT uq_student_refunds_bank_voucher UNIQUE (bank_voucher_id),
  CONSTRAINT chk_student_refunds_cash_fields CHECK (
    payment_method <> 'CASH'
    OR (cash_box_id IS NOT NULL AND cash_box_session_id IS NOT NULL)
  ),
  CONSTRAINT chk_student_refunds_bank_fields CHECK (
    payment_method <> 'BANK' OR bank_account_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_srf_external_ref_active
  ON accounts.student_refunds (external_reference)
  WHERE external_reference IS NOT NULL
    AND status NOT IN ('VOID', 'REJECTED');

CREATE INDEX IF NOT EXISTS idx_srf_account ON accounts.student_refunds (student_account_id);
CREATE INDEX IF NOT EXISTS idx_srf_status ON accounts.student_refunds (status);
CREATE INDEX IF NOT EXISTS idx_srf_date ON accounts.student_refunds (refund_date);

CREATE TABLE IF NOT EXISTS accounts.student_refund_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id UUID NOT NULL
    REFERENCES accounts.student_refunds(id) ON DELETE RESTRICT,
  student_collection_id UUID NOT NULL
    REFERENCES accounts.student_collections(id) ON DELETE RESTRICT,
  student_collection_allocation_id UUID NULL
    REFERENCES accounts.student_collection_allocations(id) ON DELETE RESTRICT,
  refundable_amount_before NUMERIC(18, 3) NOT NULL CHECK (refundable_amount_before >= 0),
  refunded_amount NUMERIC(18, 3) NOT NULL CHECK (refunded_amount > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_srf_alloc_le_before CHECK (refunded_amount <= refundable_amount_before)
);

CREATE INDEX IF NOT EXISTS idx_srf_alloc_refund ON accounts.student_refund_allocations (refund_id);
CREATE INDEX IF NOT EXISTS idx_srf_alloc_collection ON accounts.student_refund_allocations (student_collection_id);

COMMENT ON COLUMN accounts.student_installments.credit_note_amount IS
  '5.C.2 cumulative debt-reducing posted credit notes; outstanding = amount - paid - relief - credit_note';

COMMIT;
