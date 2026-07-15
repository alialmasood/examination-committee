-- 087: Supplier Payments & Allocations — 6.B
BEGIN;

INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES ('SUPPLIER_PAYMENT', 'دفعة مورد', 'SPY', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  prefix_default = EXCLUDED.prefix_default,
  is_active = TRUE,
  updated_at = NOW();

INSERT INTO accounts.document_sequences
  (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
SELECT 'SUPPLIER_PAYMENT', fy.id, 'SPY', 0, 6, TRUE, TRUE
FROM accounts.fiscal_years fy
WHERE NOT EXISTS (
  SELECT 1 FROM accounts.document_sequences ds
  WHERE ds.document_type = 'SUPPLIER_PAYMENT' AND ds.fiscal_year_id = fy.id
);

ALTER TABLE accounts.supplier_ledger_entries
  DROP CONSTRAINT IF EXISTS supplier_ledger_entries_entry_type_check;

ALTER TABLE accounts.supplier_ledger_entries
  ADD CONSTRAINT supplier_ledger_entries_entry_type_check CHECK (
    entry_type IN (
      'INVOICE', 'INVOICE_REVERSAL',
      'PAYMENT', 'PAYMENT_REVERSAL',
      'OPENING_REFERENCE', 'ADJUSTMENT'
    )
  );

CREATE TABLE IF NOT EXISTS accounts.supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number VARCHAR(40) NOT NULL,
  supplier_account_id UUID NOT NULL
    REFERENCES accounts.supplier_accounts(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL
    REFERENCES accounts.suppliers(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  payment_date DATE NOT NULL,
  amount NUMERIC(18, 3) NOT NULL CHECK (amount > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
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
  external_reference VARCHAR(100) NULL,
  payee_name VARCHAR(200) NULL,
  description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'POSTED', 'VOID')),
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
  CONSTRAINT uq_supplier_payments_number UNIQUE (payment_number),
  CONSTRAINT uq_supplier_payments_cash_voucher UNIQUE (cash_voucher_id),
  CONSTRAINT uq_supplier_payments_bank_voucher UNIQUE (bank_voucher_id),
  CONSTRAINT ck_supplier_payments_method_refs CHECK (
    (payment_method = 'CASH' AND cash_box_id IS NOT NULL AND cash_box_session_id IS NOT NULL AND bank_account_id IS NULL)
    OR
    (payment_method = 'BANK' AND bank_account_id IS NOT NULL AND cash_box_id IS NULL AND cash_box_session_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_account
  ON accounts.supplier_payments (supplier_account_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier
  ON accounts.supplier_payments (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_status
  ON accounts.supplier_payments (status);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_date
  ON accounts.supplier_payments (payment_date DESC);

CREATE TABLE IF NOT EXISTS accounts.supplier_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_payment_id UUID NOT NULL
    REFERENCES accounts.supplier_payments(id) ON DELETE RESTRICT,
  supplier_invoice_id UUID NOT NULL
    REFERENCES accounts.supplier_invoices(id) ON DELETE RESTRICT,
  allocated_amount NUMERIC(18, 3) NOT NULL CHECK (allocated_amount > 0),
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_supplier_payment_alloc_payment_invoice
    UNIQUE (supplier_payment_id, supplier_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_alloc_invoice
  ON accounts.supplier_payment_allocations (supplier_invoice_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_alloc_payment
  ON accounts.supplier_payment_allocations (supplier_payment_id);

COMMIT;
