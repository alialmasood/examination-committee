-- 089: Purchase Requisitions foundation — 7.A
BEGIN;

INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES
  ('PURCHASE_REQUISITION', 'طلب شراء', 'PRQ', TRUE),
  ('PURCHASE_ORDER', 'أمر شراء', 'POR', TRUE),
  ('PURCHASE_RECEIPT', 'محضر استلام', 'PRC', TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts.document_sequences (
  document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active
)
SELECT t.code, y.id, t.prefix_default, 0, 6, TRUE, TRUE
FROM accounts.document_sequence_types t
CROSS JOIN accounts.fiscal_years y
WHERE t.code IN ('PURCHASE_REQUISITION', 'PURCHASE_ORDER', 'PURCHASE_RECEIPT')
  AND NOT EXISTS (
    SELECT 1 FROM accounts.document_sequences ds
    WHERE ds.document_type = t.code AND ds.fiscal_year_id = y.id
  );

CREATE TABLE IF NOT EXISTS accounts.purchase_requisitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_number VARCHAR(40) NOT NULL,
  requisition_date DATE NOT NULL,
  requesting_department_id UUID NULL
    REFERENCES student_affairs.departments(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
  justification TEXT NOT NULL,
  needed_by_date DATE NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED',
      'PARTIALLY_ORDERED', 'ORDERED', 'CANCELLED'
    )),
  total_estimated_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (total_estimated_amount >= 0),
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
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_purchase_requisitions_number UNIQUE (requisition_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_status
  ON accounts.purchase_requisitions (status);
CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_date
  ON accounts.purchase_requisitions (requisition_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_requested_by
  ON accounts.purchase_requisitions (requested_by);

CREATE TABLE IF NOT EXISTS accounts.purchase_requisition_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id UUID NOT NULL
    REFERENCES accounts.purchase_requisitions(id) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  purchase_kind VARCHAR(40) NOT NULL
    CHECK (purchase_kind IN ('SERVICE', 'NON_STOCK_ITEM', 'FIXED_ASSET_CANDIDATE', 'OTHER')),
  item_code VARCHAR(80) NULL,
  description TEXT NOT NULL,
  unit_of_measure VARCHAR(40) NOT NULL DEFAULT 'UNIT',
  requested_quantity NUMERIC(18, 3) NOT NULL CHECK (requested_quantity > 0),
  estimated_unit_price NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (estimated_unit_price >= 0),
  estimated_total NUMERIC(18, 3) NOT NULL CHECK (estimated_total >= 0),
  suggested_supplier_id UUID NULL
    REFERENCES accounts.suppliers(id) ON DELETE RESTRICT,
  expense_gl_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_center_id UUID NULL
    REFERENCES accounts.cost_centers(id) ON DELETE RESTRICT,
  ordered_quantity NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (ordered_quantity >= 0),
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_purchase_requisition_lines_num UNIQUE (requisition_id, line_number),
  CONSTRAINT ck_pr_line_estimated_total
    CHECK (estimated_total = ROUND(requested_quantity * estimated_unit_price, 3)),
  CONSTRAINT ck_pr_line_ordered_le_requested
    CHECK (ordered_quantity <= requested_quantity)
);

CREATE INDEX IF NOT EXISTS idx_purchase_requisition_lines_req
  ON accounts.purchase_requisition_lines (requisition_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requisition_lines_supplier
  ON accounts.purchase_requisition_lines (suggested_supplier_id)
  WHERE suggested_supplier_id IS NOT NULL;

COMMIT;
