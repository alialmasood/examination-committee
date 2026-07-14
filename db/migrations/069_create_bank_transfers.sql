-- Migration: 069 — التحويلات بين الحسابات المصرفية (المرحلة 4.C)
-- accounts.bank_transfers + تسلسل BTR
-- يعتمد: قيد واحد متعدد الأسطر (تحويل + رسوم اختيارية)

BEGIN;

-- توسيع أنواع التسلسل ليشمل تحويل بنكي
ALTER TABLE accounts.document_sequences
  DROP CONSTRAINT IF EXISTS document_sequences_type_check;

ALTER TABLE accounts.document_sequences
  ADD CONSTRAINT document_sequences_type_check CHECK (
    document_type IN (
      'JOURNAL_ENTRY',
      'RECEIPT_VOUCHER',
      'PAYMENT_VOUCHER',
      'FINANCIAL_TRANSFER',
      'OPENING_BALANCE',
      'BANK_RECEIPT_VOUCHER',
      'BANK_PAYMENT_VOUCHER',
      'BANK_TRANSFER_VOUCHER'
    )
  );

INSERT INTO accounts.document_sequences
  (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
SELECT 'BANK_TRANSFER_VOUCHER', y.id, 'BTR', 0, 6, TRUE, TRUE
FROM accounts.fiscal_years y
WHERE NOT EXISTS (
  SELECT 1 FROM accounts.document_sequences s
  WHERE s.document_type = 'BANK_TRANSFER_VOUCHER' AND s.fiscal_year_id = y.id
);

CREATE TABLE IF NOT EXISTS accounts.bank_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  source_bank_account_id UUID NOT NULL
    REFERENCES accounts.bank_accounts(id) ON DELETE RESTRICT,
  destination_bank_account_id UUID NOT NULL
    REFERENCES accounts.bank_accounts(id) ON DELETE RESTRICT,
  transfer_date DATE NOT NULL,
  value_date DATE,
  amount NUMERIC(18,3) NOT NULL,
  currency_code VARCHAR(3) NOT NULL DEFAULT 'IQD',
  fee_amount NUMERIC(18,3) NOT NULL DEFAULT 0,
  fee_expense_account_id UUID
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_center_id UUID
    REFERENCES accounts.cost_centers(id) ON DELETE RESTRICT,
  bank_reference VARCHAR(100),
  external_reference VARCHAR(100),
  description TEXT NOT NULL,
  journal_entry_id UUID
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  reversal_journal_entry_id UUID
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  posted_at TIMESTAMPTZ,
  posted_by UUID
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  voided_at TIMESTAMPTZ,
  voided_by UUID
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  void_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_transfers_status_check CHECK (
    status IN ('DRAFT', 'POSTED', 'VOID')
  ),
  CONSTRAINT bank_transfers_amount_positive_check CHECK (amount > 0),
  CONSTRAINT bank_transfers_fee_nonneg_check CHECK (fee_amount >= 0),
  CONSTRAINT bank_transfers_source_dest_diff_check CHECK (
    source_bank_account_id <> destination_bank_account_id
  ),
  CONSTRAINT bank_transfers_currency_len_check CHECK (length(currency_code) = 3),
  CONSTRAINT bank_transfers_description_not_blank_check CHECK (
    length(trim(description)) > 0
  ),
  CONSTRAINT bank_transfers_fee_account_required_check CHECK (
    fee_amount = 0 OR fee_expense_account_id IS NOT NULL
  ),
  CONSTRAINT bank_transfers_version_positive_check CHECK (version >= 1),
  CONSTRAINT bank_transfers_posted_integrity_check CHECK (
    status <> 'POSTED'
    OR (
      journal_entry_id IS NOT NULL
      AND posted_by IS NOT NULL
      AND posted_at IS NOT NULL
    )
  ),
  CONSTRAINT bank_transfers_void_integrity_check CHECK (
    status <> 'VOID'
    OR (
      voided_by IS NOT NULL
      AND voided_at IS NOT NULL
      AND void_reason IS NOT NULL
      AND length(trim(void_reason)) > 0
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_transfers_year_number
  ON accounts.bank_transfers (fiscal_year_id, transfer_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_transfers_journal
  ON accounts.bank_transfers (journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_transfers_reversal_journal
  ON accounts.bank_transfers (reversal_journal_entry_id)
  WHERE reversal_journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_transfers_source
  ON accounts.bank_transfers (source_bank_account_id);

CREATE INDEX IF NOT EXISTS idx_bank_transfers_destination
  ON accounts.bank_transfers (destination_bank_account_id);

CREATE INDEX IF NOT EXISTS idx_bank_transfers_status
  ON accounts.bank_transfers (status);

CREATE INDEX IF NOT EXISTS idx_bank_transfers_date
  ON accounts.bank_transfers (transfer_date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_transfers_currency
  ON accounts.bank_transfers (currency_code);

CREATE INDEX IF NOT EXISTS idx_bank_transfers_bank_reference
  ON accounts.bank_transfers (bank_reference)
  WHERE bank_reference IS NOT NULL;

COMMENT ON TABLE accounts.bank_transfers IS
  'تحويلات بين حسابات مصرفية تابعة للكلية — المرحلة 4.C (قيد واحد متعدد الأسطر)';

COMMIT;
