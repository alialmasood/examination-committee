-- 088: Direct Operating Expenses — 6.B
BEGIN;

INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES ('DIRECT_EXPENSE', 'مصروف تشغيلي مباشر', 'DEX', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  prefix_default = EXCLUDED.prefix_default,
  is_active = TRUE,
  updated_at = NOW();

INSERT INTO accounts.document_sequences
  (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
SELECT 'DIRECT_EXPENSE', fy.id, 'DEX', 0, 6, TRUE, TRUE
FROM accounts.fiscal_years fy
WHERE NOT EXISTS (
  SELECT 1 FROM accounts.document_sequences ds
  WHERE ds.document_type = 'DIRECT_EXPENSE' AND ds.fiscal_year_id = fy.id
);

CREATE TABLE IF NOT EXISTS accounts.direct_expense_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NULL,
  default_expense_gl_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  default_cost_center_id UUID NULL
    REFERENCES accounts.cost_centers(id) ON DELETE SET NULL,
  requires_cost_center BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT NULL,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_direct_expense_types_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_direct_expense_types_active
  ON accounts.direct_expense_types (is_active);

CREATE TABLE IF NOT EXISTS accounts.direct_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_number VARCHAR(40) NOT NULL,
  expense_date DATE NOT NULL,
  supplier_id UUID NULL
    REFERENCES accounts.suppliers(id) ON DELETE RESTRICT,
  expense_type_id UUID NULL
    REFERENCES accounts.direct_expense_types(id) ON DELETE RESTRICT,
  expense_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_center_id UUID NULL
    REFERENCES accounts.cost_centers(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
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
  beneficiary_name VARCHAR(200) NOT NULL,
  external_reference VARCHAR(100) NULL,
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
  CONSTRAINT uq_direct_expenses_number UNIQUE (expense_number),
  CONSTRAINT uq_direct_expenses_cash_voucher UNIQUE (cash_voucher_id),
  CONSTRAINT uq_direct_expenses_bank_voucher UNIQUE (bank_voucher_id),
  CONSTRAINT ck_direct_expenses_method_refs CHECK (
    (payment_method = 'CASH' AND cash_box_id IS NOT NULL AND cash_box_session_id IS NOT NULL AND bank_account_id IS NULL)
    OR
    (payment_method = 'BANK' AND bank_account_id IS NOT NULL AND cash_box_id IS NULL AND cash_box_session_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_direct_expenses_status
  ON accounts.direct_expenses (status);
CREATE INDEX IF NOT EXISTS idx_direct_expenses_date
  ON accounts.direct_expenses (expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_direct_expenses_type
  ON accounts.direct_expenses (expense_type_id);
CREATE INDEX IF NOT EXISTS idx_direct_expenses_supplier
  ON accounts.direct_expenses (supplier_id)
  WHERE supplier_id IS NOT NULL;

COMMIT;
