-- 084: Suppliers & Supplier Accounts / Invoice Types — 6.A
BEGIN;

INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES
  ('SUPPLIER', 'مورد', 'SUP', TRUE),
  ('SUPPLIER_ACCOUNT', 'حساب مالي للمورد', 'SPA', TRUE),
  ('SUPPLIER_INVOICE', 'فاتورة مورد', 'SIN', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  prefix_default = EXCLUDED.prefix_default,
  is_active = TRUE,
  updated_at = NOW();

INSERT INTO accounts.document_sequences
  (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
SELECT v.document_type, fy.id, v.prefix, 0, 6, TRUE, TRUE
FROM accounts.fiscal_years fy
CROSS JOIN (VALUES
  ('SUPPLIER', 'SUP'),
  ('SUPPLIER_ACCOUNT', 'SPA'),
  ('SUPPLIER_INVOICE', 'SIN')
) AS v(document_type, prefix)
WHERE NOT EXISTS (
  SELECT 1 FROM accounts.document_sequences ds
  WHERE ds.document_type = v.document_type AND ds.fiscal_year_id = fy.id
);

CREATE TABLE IF NOT EXISTS accounts.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_number VARCHAR(40) NOT NULL,
  code VARCHAR(40) NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NULL,
  supplier_type VARCHAR(40) NOT NULL DEFAULT 'LOCAL'
    CHECK (supplier_type IN (
      'LOCAL', 'INTERNATIONAL', 'GOVERNMENT', 'INDIVIDUAL', 'SERVICE_PROVIDER', 'OTHER'
    )),
  legal_name VARCHAR(200) NULL,
  tax_number VARCHAR(60) NULL,
  registration_number VARCHAR(60) NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(120) NULL,
  website VARCHAR(200) NULL,
  country_code VARCHAR(8) NULL,
  city VARCHAR(100) NULL,
  address TEXT NULL,
  contact_person VARCHAR(120) NULL,
  payment_terms_days INTEGER NOT NULL DEFAULT 0
    CHECK (payment_terms_days >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  notes TEXT NULL,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  suspended_at TIMESTAMPTZ NULL,
  suspended_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ NULL,
  closed_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  CONSTRAINT uq_suppliers_number UNIQUE (supplier_number),
  CONSTRAINT uq_suppliers_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_status ON accounts.suppliers (status);
CREATE INDEX IF NOT EXISTS idx_suppliers_type ON accounts.suppliers (supplier_type);
CREATE INDEX IF NOT EXISTS idx_suppliers_name_ar ON accounts.suppliers (name_ar);

CREATE TABLE IF NOT EXISTS accounts.supplier_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL
    REFERENCES accounts.suppliers(id) ON DELETE RESTRICT,
  account_number VARCHAR(40) NOT NULL,
  payable_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  opening_reference TEXT NULL,
  notes TEXT NULL,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  suspended_at TIMESTAMPTZ NULL,
  suspended_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ NULL,
  closed_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  CONSTRAINT uq_supplier_accounts_number UNIQUE (account_number),
  CONSTRAINT uq_supplier_accounts_supplier_currency UNIQUE (supplier_id, currency_code)
);

CREATE INDEX IF NOT EXISTS idx_supplier_accounts_supplier ON accounts.supplier_accounts (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_accounts_status ON accounts.supplier_accounts (status);
CREATE INDEX IF NOT EXISTS idx_supplier_accounts_gl ON accounts.supplier_accounts (payable_gl_account_id);

COMMENT ON COLUMN accounts.supplier_accounts.opening_reference IS
  'Reference note only — never included in supplier ledger balance (6.A)';

CREATE TABLE IF NOT EXISTS accounts.supplier_invoice_types (
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
  CONSTRAINT uq_supplier_invoice_types_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_types_active
  ON accounts.supplier_invoice_types (is_active);

COMMIT;
