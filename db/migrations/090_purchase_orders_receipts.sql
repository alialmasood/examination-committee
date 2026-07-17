-- 090: Purchase Orders and Receipts — 7.A
BEGIN;

CREATE TABLE IF NOT EXISTS accounts.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_number VARCHAR(40) NOT NULL,
  supplier_id UUID NOT NULL
    REFERENCES accounts.suppliers(id) ON DELETE RESTRICT,
  supplier_account_id UUID NOT NULL
    REFERENCES accounts.supplier_accounts(id) ON DELETE RESTRICT,
  requisition_id UUID NULL
    REFERENCES accounts.purchase_requisitions(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  order_date DATE NOT NULL,
  expected_delivery_date DATE NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
  payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  delivery_location TEXT NULL,
  description TEXT NOT NULL DEFAULT '',
  subtotal_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  discount_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED',
      'PARTIALLY_INVOICED', 'INVOICED', 'CLOSED', 'CANCELLED', 'REJECTED'
    )),
  submitted_at TIMESTAMPTZ NULL,
  submitted_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ NULL,
  approved_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ NULL,
  rejected_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  rejection_reason TEXT NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  cancellation_reason TEXT NULL,
  closed_at TIMESTAMPTZ NULL,
  closed_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_purchase_orders_number UNIQUE (purchase_order_number),
  CONSTRAINT ck_po_total_formula
    CHECK (total_amount = subtotal_amount - discount_amount + tax_amount)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier
  ON accounts.purchase_orders (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status
  ON accounts.purchase_orders (status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_date
  ON accounts.purchase_orders (order_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_requisition
  ON accounts.purchase_orders (requisition_id)
  WHERE requisition_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS accounts.purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL
    REFERENCES accounts.purchase_orders(id) ON DELETE RESTRICT,
  requisition_line_id UUID NULL
    REFERENCES accounts.purchase_requisition_lines(id) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  purchase_kind VARCHAR(40) NOT NULL
    CHECK (purchase_kind IN ('SERVICE', 'NON_STOCK_ITEM', 'FIXED_ASSET_CANDIDATE', 'OTHER')),
  item_code VARCHAR(80) NULL,
  description TEXT NOT NULL,
  unit_of_measure VARCHAR(40) NOT NULL DEFAULT 'UNIT',
  ordered_quantity NUMERIC(18, 3) NOT NULL CHECK (ordered_quantity > 0),
  unit_price NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total NUMERIC(18, 3) NOT NULL CHECK (line_total >= 0),
  expense_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_center_id UUID NULL
    REFERENCES accounts.cost_centers(id) ON DELETE RESTRICT,
  received_quantity NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  accepted_quantity NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
  rejected_quantity NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  invoiced_quantity NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (invoiced_quantity >= 0),
  cancelled_quantity NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN (
      'OPEN', 'PARTIALLY_RECEIVED', 'RECEIVED',
      'PARTIALLY_INVOICED', 'INVOICED', 'CANCELLED', 'CLOSED'
    )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_purchase_order_lines_num UNIQUE (purchase_order_id, line_number),
  CONSTRAINT ck_po_line_total
    CHECK (line_total = ROUND(ordered_quantity * unit_price, 3) - discount_amount + tax_amount),
  CONSTRAINT ck_po_line_received_le_open
    CHECK (received_quantity <= ordered_quantity - cancelled_quantity),
  CONSTRAINT ck_po_line_accepted_rejected
    CHECK (accepted_quantity + rejected_quantity = received_quantity),
  CONSTRAINT ck_po_line_invoiced_le_accepted
    CHECK (invoiced_quantity <= accepted_quantity)
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_po
  ON accounts.purchase_order_lines (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_req_line
  ON accounts.purchase_order_lines (requisition_line_id)
  WHERE requisition_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_status
  ON accounts.purchase_order_lines (status);

CREATE TABLE IF NOT EXISTS accounts.purchase_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number VARCHAR(40) NOT NULL,
  purchase_order_id UUID NOT NULL
    REFERENCES accounts.purchase_orders(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL
    REFERENCES accounts.suppliers(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  receipt_date DATE NOT NULL,
  delivery_reference VARCHAR(100) NULL,
  received_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  inspected_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  location TEXT NULL,
  notes TEXT NULL,
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
  CONSTRAINT uq_purchase_receipts_number UNIQUE (receipt_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_receipts_po
  ON accounts.purchase_receipts (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_status
  ON accounts.purchase_receipts (status);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_date
  ON accounts.purchase_receipts (receipt_date DESC);

CREATE TABLE IF NOT EXISTS accounts.purchase_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL
    REFERENCES accounts.purchase_receipts(id) ON DELETE RESTRICT,
  purchase_order_line_id UUID NOT NULL
    REFERENCES accounts.purchase_order_lines(id) ON DELETE RESTRICT,
  received_quantity NUMERIC(18, 3) NOT NULL CHECK (received_quantity > 0),
  accepted_quantity NUMERIC(18, 3) NOT NULL CHECK (accepted_quantity >= 0),
  rejected_quantity NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  rejection_reason TEXT NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_purchase_receipt_lines_po_line UNIQUE (receipt_id, purchase_order_line_id),
  CONSTRAINT ck_prc_line_accepted_rejected
    CHECK (accepted_quantity + rejected_quantity = received_quantity)
);

CREATE INDEX IF NOT EXISTS idx_purchase_receipt_lines_receipt
  ON accounts.purchase_receipt_lines (receipt_id);
CREATE INDEX IF NOT EXISTS idx_purchase_receipt_lines_po_line
  ON accounts.purchase_receipt_lines (purchase_order_line_id);

COMMIT;
