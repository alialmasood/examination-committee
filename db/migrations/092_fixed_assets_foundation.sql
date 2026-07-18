-- 092: Fixed Assets Foundation — 8.A
-- تصنيفات الأصول، مواقعها، سجل الأصول الثابتة، ومصادر الرسملة (لمنع الرسملة المزدوجة).
-- ملاحظة محاسبية: مجمع الإهلاك يُخزَّن كحساب من نوع ASSET برصيد طبيعي دائن (CREDIT) —
-- عرض contra-asset ضمن دليل الحسابات (لا يوجد نوع CONTRA_ASSET في النظام).
BEGIN;

-- ─────────────────────────────────────────────────────────────
-- تصنيفات الأصول الثابتة
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.asset_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NULL,
  description TEXT NULL,
  -- حسابات GL: الأصل، مجمع الإهلاك (contra-asset)، مصروف الإهلاك، والربح/الخسارة عند البيع
  asset_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  accumulated_depreciation_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  depreciation_expense_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  gain_gl_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  loss_gl_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  depreciation_method VARCHAR(20) NOT NULL DEFAULT 'STRAIGHT_LINE'
    CHECK (depreciation_method IN ('STRAIGHT_LINE', 'NONE')),
  useful_life_months INTEGER NULL CHECK (useful_life_months IS NULL OR useful_life_months > 0),
  salvage_value_percent NUMERIC(8, 4) NOT NULL DEFAULT 0
    CHECK (salvage_value_percent >= 0 AND salvage_value_percent <= 100),
  capitalization_threshold NUMERIC(18, 3) NOT NULL DEFAULT 0
    CHECK (capitalization_threshold >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);

-- رمز فريد بعد التطبيع لحالة الأحرف الكبيرة
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_categories_code
  ON accounts.asset_categories (UPPER(code));
CREATE INDEX IF NOT EXISTS idx_asset_categories_active
  ON accounts.asset_categories (is_active);

-- ─────────────────────────────────────────────────────────────
-- مواقع الأصول
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.asset_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NULL,
  location_type VARCHAR(20) NOT NULL DEFAULT 'ROOM'
    CHECK (location_type IN ('BUILDING', 'FLOOR', 'ROOM', 'WAREHOUSE', 'OFFICE', 'LAB', 'OTHER')),
  parent_location_id UUID NULL
    REFERENCES accounts.asset_locations(id) ON DELETE RESTRICT,
  department_id UUID NULL
    REFERENCES student_affairs.departments(id) ON DELETE SET NULL,
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_locations_code
  ON accounts.asset_locations (UPPER(code));
CREATE INDEX IF NOT EXISTS idx_asset_locations_parent
  ON accounts.asset_locations (parent_location_id)
  WHERE parent_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asset_locations_active
  ON accounts.asset_locations (is_active);

-- ─────────────────────────────────────────────────────────────
-- سجل الأصول الثابتة
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_number VARCHAR(40) NOT NULL,
  category_id UUID NOT NULL
    REFERENCES accounts.asset_categories(id) ON DELETE RESTRICT,
  name_ar VARCHAR(300) NOT NULL,
  name_en VARCHAR(300) NULL,
  description TEXT NULL,
  barcode_value VARCHAR(120) NULL,
  serial_number VARCHAR(120) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'FULLY_DEPRECIATED', 'DISPOSED', 'CANCELLED')),
  acquisition_type VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
    CHECK (acquisition_type IN ('PURCHASE', 'MANUAL', 'DONATION', 'OPENING')),
  acquisition_date DATE NOT NULL,
  available_for_use_date DATE NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
  acquisition_cost NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (acquisition_cost >= 0),
  additional_costs NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (additional_costs >= 0),
  capitalized_cost NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (capitalized_cost >= 0),
  salvage_value NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  depreciable_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (depreciable_amount >= 0),
  useful_life_months INTEGER NULL CHECK (useful_life_months IS NULL OR useful_life_months > 0),
  depreciation_method VARCHAR(20) NOT NULL DEFAULT 'STRAIGHT_LINE'
    CHECK (depreciation_method IN ('STRAIGHT_LINE', 'NONE')),
  opening_accumulated_depreciation NUMERIC(18, 3) NOT NULL DEFAULT 0
    CHECK (opening_accumulated_depreciation >= 0),
  accumulated_depreciation NUMERIC(18, 3) NOT NULL DEFAULT 0
    CHECK (accumulated_depreciation >= 0),
  net_book_value NUMERIC(18, 3) NOT NULL DEFAULT 0,
  -- حسابات GL (snapshot من التصنيف، قابلة للتجاوز يدوياً)
  asset_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  accumulated_depreciation_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  depreciation_expense_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  -- حساب مقابل التبرعات (إيراد التبرع) — يُستخدم للأصول من نوع DONATION فقط
  donation_contra_gl_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_center_id UUID NULL
    REFERENCES accounts.cost_centers(id) ON DELETE RESTRICT,
  department_id UUID NULL
    REFERENCES student_affairs.departments(id) ON DELETE SET NULL,
  location_id UUID NULL
    REFERENCES accounts.asset_locations(id) ON DELETE RESTRICT,
  custodian_user_id UUID NULL
    REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  supplier_id UUID NULL
    REFERENCES accounts.suppliers(id) ON DELETE RESTRICT,
  purchase_order_id UUID NULL
    REFERENCES accounts.purchase_orders(id) ON DELETE RESTRICT,
  purchase_order_line_id UUID NULL
    REFERENCES accounts.purchase_order_lines(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  -- تجاوز حد الرسملة
  override_capitalization_threshold BOOLEAN NOT NULL DEFAULT FALSE,
  override_threshold_reason TEXT NULL,
  override_threshold_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  override_threshold_at TIMESTAMPTZ NULL,
  -- قيود التتبع
  acquisition_journal_entry_id UUID NULL
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  last_depreciation_date DATE NULL,
  last_depreciation_period_id UUID NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  activated_at TIMESTAMPTZ NULL,
  activated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  suspended_at TIMESTAMPTZ NULL,
  suspended_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  cancellation_reason TEXT NULL,
  disposed_at TIMESTAMPTZ NULL,
  disposed_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  notes TEXT NULL,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_fixed_assets_number UNIQUE (asset_number),
  CONSTRAINT ck_fixed_assets_capitalized
    CHECK (capitalized_cost = acquisition_cost + additional_costs),
  CONSTRAINT ck_fixed_assets_salvage_le_cost
    CHECK (salvage_value <= capitalized_cost),
  CONSTRAINT ck_fixed_assets_accum_le_depreciable
    CHECK (accumulated_depreciation <= depreciable_amount + salvage_value)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_assets_barcode
  ON accounts.fixed_assets (barcode_value)
  WHERE barcode_value IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fixed_assets_status ON accounts.fixed_assets (status);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_category ON accounts.fixed_assets (category_id);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_location ON accounts.fixed_assets (location_id)
  WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fixed_assets_custodian ON accounts.fixed_assets (custodian_user_id)
  WHERE custodian_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fixed_assets_department ON accounts.fixed_assets (department_id)
  WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fixed_assets_po_line ON accounts.fixed_assets (purchase_order_line_id)
  WHERE purchase_order_line_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- مصادر الرسملة — تمنع الرسملة المزدوجة لنفس السطر/الوحدة
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.asset_capitalization_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixed_asset_id UUID NOT NULL
    REFERENCES accounts.fixed_assets(id) ON DELETE CASCADE,
  purchase_order_id UUID NULL
    REFERENCES accounts.purchase_orders(id) ON DELETE RESTRICT,
  purchase_order_line_id UUID NULL
    REFERENCES accounts.purchase_order_lines(id) ON DELETE RESTRICT,
  purchase_receipt_id UUID NULL
    REFERENCES accounts.purchase_receipts(id) ON DELETE RESTRICT,
  purchase_receipt_line_id UUID NULL
    REFERENCES accounts.purchase_receipt_lines(id) ON DELETE RESTRICT,
  supplier_invoice_id UUID NULL
    REFERENCES accounts.supplier_invoices(id) ON DELETE RESTRICT,
  supplier_invoice_line_id UUID NULL
    REFERENCES accounts.supplier_invoice_lines(id) ON DELETE RESTRICT,
  quantity NUMERIC(18, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- أصل واحد لكل سطر فاتورة/مصدر (منع ربط نفس السطر بنفس الأصل مرتين)
  CONSTRAINT uq_acs_invoice_line_asset UNIQUE (supplier_invoice_line_id, fixed_asset_id),
  CONSTRAINT uq_acs_receipt_line_asset UNIQUE (purchase_receipt_line_id, fixed_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_acs_fixed_asset
  ON accounts.asset_capitalization_sources (fixed_asset_id);
CREATE INDEX IF NOT EXISTS idx_acs_po_line
  ON accounts.asset_capitalization_sources (purchase_order_line_id)
  WHERE purchase_order_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_acs_invoice_line
  ON accounts.asset_capitalization_sources (supplier_invoice_line_id)
  WHERE supplier_invoice_line_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- توسيع جداول المشتريات لدعم الأصول الثابتة (FIXED_ASSET_CANDIDATE)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE accounts.purchase_order_lines
  ADD COLUMN IF NOT EXISTS asset_category_id UUID NULL
    REFERENCES accounts.asset_categories(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS capitalized_quantity NUMERIC(18, 3) NOT NULL DEFAULT 0
    CHECK (capitalized_quantity >= 0);

CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_asset_category
  ON accounts.purchase_order_lines (asset_category_id)
  WHERE asset_category_id IS NOT NULL;

ALTER TABLE accounts.purchase_requisition_lines
  ADD COLUMN IF NOT EXISTS asset_category_id UUID NULL
    REFERENCES accounts.asset_categories(id) ON DELETE RESTRICT;

-- سطور فاتورة المورد: علامة الأصل الثابت + التصنيف (لترحيل Dr Asset بدل المصروف)
ALTER TABLE accounts.supplier_invoice_lines
  ADD COLUMN IF NOT EXISTS is_fixed_asset BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS asset_category_id UUID NULL
    REFERENCES accounts.asset_categories(id) ON DELETE RESTRICT;

COMMIT;
