-- Migration: 068 — سندات القبض والصرف المصرفي (المرحلة 4.B)
-- accounts.bank_vouchers + تسلسلات BRV/BPV
-- لا يعدّل 062–067 منطقياً سوى توسيع document_sequences

BEGIN;

-- توسيع أنواع التسلسل
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
      'BANK_PAYMENT_VOUCHER'
    )
  );

-- تسلسلات للسنوات الموجودة
INSERT INTO accounts.document_sequences
  (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
SELECT 'BANK_RECEIPT_VOUCHER', y.id, 'BRV', 0, 6, TRUE, TRUE
FROM accounts.fiscal_years y
WHERE NOT EXISTS (
  SELECT 1 FROM accounts.document_sequences s
  WHERE s.document_type = 'BANK_RECEIPT_VOUCHER' AND s.fiscal_year_id = y.id
);

INSERT INTO accounts.document_sequences
  (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
SELECT 'BANK_PAYMENT_VOUCHER', y.id, 'BPV', 0, 6, TRUE, TRUE
FROM accounts.fiscal_years y
WHERE NOT EXISTS (
  SELECT 1 FROM accounts.document_sequences s
  WHERE s.document_type = 'BANK_PAYMENT_VOUCHER' AND s.fiscal_year_id = y.id
);

CREATE TABLE IF NOT EXISTS accounts.bank_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number VARCHAR(50) NOT NULL,
  voucher_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  bank_account_id UUID NOT NULL
    REFERENCES accounts.bank_accounts(id) ON DELETE RESTRICT,
  counter_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_center_id UUID
    REFERENCES accounts.cost_centers(id) ON DELETE RESTRICT,
  voucher_date DATE NOT NULL,
  value_date DATE,
  amount NUMERIC(18,3) NOT NULL,
  currency_code VARCHAR(3) NOT NULL DEFAULT 'IQD',
  party_name VARCHAR(200),
  party_reference VARCHAR(100),
  external_reference VARCHAR(100),
  bank_reference VARCHAR(100),
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
  CONSTRAINT bank_vouchers_type_check CHECK (
    voucher_type IN ('BANK_RECEIPT', 'BANK_PAYMENT')
  ),
  CONSTRAINT bank_vouchers_status_check CHECK (
    status IN ('DRAFT', 'POSTED', 'VOID')
  ),
  CONSTRAINT bank_vouchers_amount_positive_check CHECK (amount > 0),
  CONSTRAINT bank_vouchers_currency_len_check CHECK (length(currency_code) = 3),
  CONSTRAINT bank_vouchers_description_not_blank_check CHECK (
    length(trim(description)) > 0
  ),
  CONSTRAINT bank_vouchers_version_positive_check CHECK (version >= 1),
  CONSTRAINT bank_vouchers_posted_integrity_check CHECK (
    status <> 'POSTED'
    OR (
      journal_entry_id IS NOT NULL
      AND posted_by IS NOT NULL
      AND posted_at IS NOT NULL
    )
  ),
  CONSTRAINT bank_vouchers_void_integrity_check CHECK (
    status <> 'VOID'
    OR (
      voided_by IS NOT NULL
      AND voided_at IS NOT NULL
      AND void_reason IS NOT NULL
      AND length(trim(void_reason)) > 0
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_vouchers_year_number
  ON accounts.bank_vouchers (fiscal_year_id, voucher_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_vouchers_journal
  ON accounts.bank_vouchers (journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_vouchers_bank_account
  ON accounts.bank_vouchers (bank_account_id);

CREATE INDEX IF NOT EXISTS idx_bank_vouchers_type_status
  ON accounts.bank_vouchers (voucher_type, status);

CREATE INDEX IF NOT EXISTS idx_bank_vouchers_date
  ON accounts.bank_vouchers (voucher_date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_vouchers_currency
  ON accounts.bank_vouchers (currency_code);

COMMENT ON TABLE accounts.bank_vouchers IS
  'سندات القبض والصرف المصرفي — المرحلة 4.B';

COMMIT;
