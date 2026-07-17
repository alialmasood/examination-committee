-- 091: Purchase Invoice Matching — supplier invoice lines + PO link — 7.A
BEGIN;

ALTER TABLE accounts.supplier_invoices
  ADD COLUMN IF NOT EXISTS invoice_source VARCHAR(30) NOT NULL DEFAULT 'MANUAL'
    CHECK (invoice_source IN ('MANUAL', 'PURCHASE_ORDER')),
  ADD COLUMN IF NOT EXISTS purchase_order_id UUID NULL
    REFERENCES accounts.purchase_orders(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_po
  ON accounts.supplier_invoices (purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;

-- expense_gl على الرأس يبقى لـ MANUAL؛ للفواتير من PO يُشتق من السطور
ALTER TABLE accounts.supplier_invoices
  ALTER COLUMN expense_gl_account_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS accounts.supplier_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id UUID NOT NULL
    REFERENCES accounts.supplier_invoices(id) ON DELETE RESTRICT,
  purchase_order_line_id UUID NULL
    REFERENCES accounts.purchase_order_lines(id) ON DELETE RESTRICT,
  purchase_receipt_line_id UUID NULL
    REFERENCES accounts.purchase_receipt_lines(id) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  description TEXT NOT NULL,
  quantity NUMERIC(18, 3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total NUMERIC(18, 3) NOT NULL CHECK (line_total >= 0),
  expense_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_center_id UUID NULL
    REFERENCES accounts.cost_centers(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_supplier_invoice_lines_num UNIQUE (supplier_invoice_id, line_number),
  CONSTRAINT ck_sil_line_total
    CHECK (line_total = ROUND(quantity * unit_price, 3) - discount_amount + tax_amount)
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_invoice
  ON accounts.supplier_invoice_lines (supplier_invoice_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_po_line
  ON accounts.supplier_invoice_lines (purchase_order_line_id)
  WHERE purchase_order_line_id IS NOT NULL;

-- إعداد بسيط لتسامح السعر (افتراضي 0%)
CREATE TABLE IF NOT EXISTS accounts.purchasing_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_tolerance_percent NUMERIC(8, 4) NOT NULL DEFAULT 0
    CHECK (price_tolerance_percent >= 0 AND price_tolerance_percent <= 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL
);

INSERT INTO accounts.purchasing_config (price_tolerance_percent)
SELECT 0
WHERE NOT EXISTS (SELECT 1 FROM accounts.purchasing_config);

COMMIT;
