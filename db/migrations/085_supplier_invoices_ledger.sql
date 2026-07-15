-- 085: Supplier Invoices + Supplier Subledger — 6.A
BEGIN;

CREATE TABLE IF NOT EXISTS accounts.supplier_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number VARCHAR(40) NOT NULL,
  supplier_invoice_number VARCHAR(80) NOT NULL,
  supplier_account_id UUID NOT NULL
    REFERENCES accounts.supplier_accounts(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL
    REFERENCES accounts.suppliers(id) ON DELETE RESTRICT,
  invoice_type_id UUID NULL
    REFERENCES accounts.supplier_invoice_types(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  invoice_date DATE NOT NULL,
  due_date DATE NULL,
  subtotal_amount NUMERIC(18, 3) NOT NULL CHECK (subtotal_amount >= 0),
  discount_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount NUMERIC(18, 3) NOT NULL CHECK (total_amount > 0),
  outstanding_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (outstanding_amount >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
  expense_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_center_id UUID NULL
    REFERENCES accounts.cost_centers(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  external_reference VARCHAR(100) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'VOID'
    )),
  journal_entry_id UUID NULL
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  reversal_journal_entry_id UUID NULL
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
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
  CONSTRAINT uq_supplier_invoices_number UNIQUE (invoice_number),
  CONSTRAINT uq_supplier_invoices_journal UNIQUE (journal_entry_id),
  CONSTRAINT uq_supplier_invoices_rev_journal UNIQUE (reversal_journal_entry_id),
  CONSTRAINT uq_supplier_invoices_supplier_ext_num UNIQUE (supplier_id, supplier_invoice_number),
  CONSTRAINT ck_supplier_invoices_discount
    CHECK (discount_amount <= subtotal_amount + tax_amount),
  CONSTRAINT ck_supplier_invoices_total_formula
    CHECK (total_amount = subtotal_amount - discount_amount + tax_amount)
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_account
  ON accounts.supplier_invoices (supplier_account_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_supplier
  ON accounts.supplier_invoices (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_status
  ON accounts.supplier_invoices (status);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_date
  ON accounts.supplier_invoices (invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_due
  ON accounts.supplier_invoices (due_date);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_ext_ref
  ON accounts.supplier_invoices (external_reference)
  WHERE external_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS accounts.supplier_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_account_id UUID NOT NULL
    REFERENCES accounts.supplier_accounts(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL
    REFERENCES accounts.suppliers(id) ON DELETE RESTRICT,
  entry_date DATE NOT NULL,
  entry_type VARCHAR(40) NOT NULL
    CHECK (entry_type IN (
      'INVOICE', 'INVOICE_REVERSAL', 'OPENING_REFERENCE', 'ADJUSTMENT'
    )),
  source_type VARCHAR(40) NOT NULL,
  source_id UUID NOT NULL,
  description TEXT NOT NULL,
  debit_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
  journal_entry_id UUID NULL
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_supplier_ledger_one_side
    CHECK (
      (debit_amount > 0 AND credit_amount = 0)
      OR (credit_amount > 0 AND debit_amount = 0)
      OR (debit_amount = 0 AND credit_amount = 0 AND entry_type = 'OPENING_REFERENCE')
    )
);

CREATE INDEX IF NOT EXISTS idx_supplier_ledger_account
  ON accounts.supplier_ledger_entries (supplier_account_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_source
  ON accounts.supplier_ledger_entries (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_type
  ON accounts.supplier_ledger_entries (entry_type);

COMMENT ON TABLE accounts.supplier_ledger_entries IS
  'Supplier subledger — operational; GL POSTED remains SoT (6.A)';

COMMIT;
