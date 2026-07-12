-- Migration: 065 — سندات القبض والصرف النقدي (المرحلة 3.D)
-- جدول موحّد accounts.cash_vouchers
-- لا يعدّل 062/063/064
-- بلا بيانات تشغيلية

BEGIN;

CREATE TABLE IF NOT EXISTS accounts.cash_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number VARCHAR(50) NOT NULL,
  voucher_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  cash_box_id UUID NOT NULL
    REFERENCES accounts.cash_boxes(id) ON DELETE RESTRICT,
  cash_box_session_id UUID NOT NULL
    REFERENCES accounts.cash_box_sessions(id) ON DELETE RESTRICT,
  counter_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_center_id UUID
    REFERENCES accounts.cost_centers(id) ON DELETE RESTRICT,
  voucher_date DATE NOT NULL,
  amount NUMERIC(18,3) NOT NULL,
  currency_code VARCHAR(10) NOT NULL DEFAULT 'IQD',
  party_name VARCHAR(200),
  party_reference VARCHAR(100),
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
  CONSTRAINT cash_vouchers_type_check CHECK (
    voucher_type IN ('CASH_RECEIPT', 'CASH_PAYMENT')
  ),
  CONSTRAINT cash_vouchers_status_check CHECK (
    status IN ('DRAFT', 'POSTED', 'VOID')
  ),
  CONSTRAINT cash_vouchers_amount_positive_check CHECK (amount > 0),
  CONSTRAINT cash_vouchers_currency_not_blank_check CHECK (
    length(trim(currency_code)) > 0
  ),
  CONSTRAINT cash_vouchers_description_not_blank_check CHECK (
    length(trim(description)) > 0
  ),
  CONSTRAINT cash_vouchers_version_positive_check CHECK (version >= 1),
  CONSTRAINT cash_vouchers_posted_integrity_check CHECK (
    status <> 'POSTED'
    OR (
      journal_entry_id IS NOT NULL
      AND posted_by IS NOT NULL
      AND posted_at IS NOT NULL
    )
  ),
  CONSTRAINT cash_vouchers_void_integrity_check CHECK (
    status <> 'VOID'
    OR (
      voided_by IS NOT NULL
      AND voided_at IS NOT NULL
      AND void_reason IS NOT NULL
      AND length(trim(void_reason)) > 0
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_vouchers_year_number
  ON accounts.cash_vouchers (fiscal_year_id, voucher_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_vouchers_journal
  ON accounts.cash_vouchers (journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_vouchers_box
  ON accounts.cash_vouchers (cash_box_id);

CREATE INDEX IF NOT EXISTS idx_cash_vouchers_session
  ON accounts.cash_vouchers (cash_box_session_id);

CREATE INDEX IF NOT EXISTS idx_cash_vouchers_type_status
  ON accounts.cash_vouchers (voucher_type, status);

CREATE INDEX IF NOT EXISTS idx_cash_vouchers_date
  ON accounts.cash_vouchers (voucher_date DESC);

CREATE INDEX IF NOT EXISTS idx_cash_vouchers_status
  ON accounts.cash_vouchers (status);

CREATE INDEX IF NOT EXISTS idx_cash_vouchers_created_at
  ON accounts.cash_vouchers (created_at DESC);

COMMENT ON TABLE accounts.cash_vouchers IS
  'سندات القبض والصرف النقدي — المصدر المحاسبي CASH_RECEIPT / CASH_PAYMENT';
COMMENT ON COLUMN accounts.cash_vouchers.voucher_type IS
  'CASH_RECEIPT = قبض · CASH_PAYMENT = صرف';

COMMIT;
