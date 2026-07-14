-- 081: relief_amount على الأقساط + توسيع Student Ledger — 5.C.1
BEGIN;

ALTER TABLE accounts.student_installments
  ADD COLUMN IF NOT EXISTS relief_amount NUMERIC(18, 3) NOT NULL DEFAULT 0
    CHECK (relief_amount >= 0);

-- outstanding = amount - paid - relief
ALTER TABLE accounts.student_installments
  DROP CONSTRAINT IF EXISTS chk_student_installments_outstanding_eq;

ALTER TABLE accounts.student_installments
  ADD CONSTRAINT chk_student_installments_outstanding_eq CHECK (
    outstanding_amount = amount - paid_amount - relief_amount
  );

ALTER TABLE accounts.student_installments
  DROP CONSTRAINT IF EXISTS chk_student_installments_paid_le_amount;

ALTER TABLE accounts.student_installments
  ADD CONSTRAINT chk_student_installments_settlement_le_amount CHECK (
    paid_amount + relief_amount <= amount
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
      'OPENING_REFERENCE',
      'ADJUSTMENT'
    )
  );

COMMENT ON COLUMN accounts.student_installments.relief_amount IS
  '5.C.1 cumulative posted relief (not cash); outstanding = amount - paid - relief';

COMMIT;
