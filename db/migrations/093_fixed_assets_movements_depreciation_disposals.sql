-- 093: Fixed Assets — الحركات، سجل العهدة، الإهلاك، والاستبعاد — 8.A
BEGIN;

-- ─────────────────────────────────────────────────────────────
-- أنواع تسلسل المستندات الخاصة بالأصول الثابتة
-- ─────────────────────────────────────────────────────────────
INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES
  ('FIXED_ASSET', 'أصل ثابت', 'AST', TRUE),
  ('ASSET_MOVEMENT', 'حركة أصل', 'AMV', TRUE),
  ('DEPRECIATION_RUN', 'دورة إهلاك', 'DPR', TRUE),
  ('ASSET_DISPOSAL', 'استبعاد أصل', 'ADS', TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts.document_sequences (
  document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active
)
SELECT t.code, y.id, t.prefix_default, 0, 6, TRUE, TRUE
FROM accounts.document_sequence_types t
CROSS JOIN accounts.fiscal_years y
WHERE t.code IN ('FIXED_ASSET', 'ASSET_MOVEMENT', 'DEPRECIATION_RUN', 'ASSET_DISPOSAL')
  AND NOT EXISTS (
    SELECT 1 FROM accounts.document_sequences ds
    WHERE ds.document_type = t.code AND ds.fiscal_year_id = y.id
  );

-- ─────────────────────────────────────────────────────────────
-- حركات الأصول (نقل موقع/قسم/عهدة) — لا أثر GL
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.asset_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_number VARCHAR(40) NOT NULL,
  fixed_asset_id UUID NOT NULL
    REFERENCES accounts.fixed_assets(id) ON DELETE RESTRICT,
  movement_type VARCHAR(20) NOT NULL
    CHECK (movement_type IN ('LOCATION', 'CUSTODY', 'DEPARTMENT', 'MIXED')),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'POSTED', 'VOIDED')),
  movement_date DATE NOT NULL,
  -- القيم السابقة (snapshot عند الترحيل لاستعادتها عند الإلغاء)
  from_location_id UUID NULL REFERENCES accounts.asset_locations(id) ON DELETE RESTRICT,
  to_location_id UUID NULL REFERENCES accounts.asset_locations(id) ON DELETE RESTRICT,
  from_department_id UUID NULL REFERENCES student_affairs.departments(id) ON DELETE SET NULL,
  to_department_id UUID NULL REFERENCES student_affairs.departments(id) ON DELETE SET NULL,
  from_custodian_user_id UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  to_custodian_user_id UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  reason TEXT NULL,
  notes TEXT NULL,
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
  CONSTRAINT uq_asset_movements_number UNIQUE (movement_number)
);

CREATE INDEX IF NOT EXISTS idx_asset_movements_asset
  ON accounts.asset_movements (fixed_asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_movements_status
  ON accounts.asset_movements (status);

-- ─────────────────────────────────────────────────────────────
-- سجل العهدة (تاريخ من استلم الأصل)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.asset_custody_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixed_asset_id UUID NOT NULL
    REFERENCES accounts.fixed_assets(id) ON DELETE CASCADE,
  movement_id UUID NULL
    REFERENCES accounts.asset_movements(id) ON DELETE SET NULL,
  custodian_user_id UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  location_id UUID NULL REFERENCES accounts.asset_locations(id) ON DELETE SET NULL,
  department_id UUID NULL REFERENCES student_affairs.departments(id) ON DELETE SET NULL,
  from_date DATE NOT NULL,
  to_date DATE NULL,
  change_type VARCHAR(20) NOT NULL DEFAULT 'CUSTODY'
    CHECK (change_type IN ('INITIAL', 'CUSTODY', 'LOCATION', 'DEPARTMENT', 'MIXED', 'DISPOSAL')),
  notes TEXT NULL,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_custody_history_asset
  ON accounts.asset_custody_history (fixed_asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_custody_history_open
  ON accounts.asset_custody_history (fixed_asset_id)
  WHERE to_date IS NULL;

-- ─────────────────────────────────────────────────────────────
-- دورات الإهلاك
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.depreciation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number VARCHAR(40) NOT NULL,
  fiscal_year_id UUID NOT NULL REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'POSTED', 'VOIDED')),
  category_id UUID NULL REFERENCES accounts.asset_categories(id) ON DELETE RESTRICT,
  asset_count INTEGER NOT NULL DEFAULT 0,
  total_depreciation NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (total_depreciation >= 0),
  journal_entry_id UUID NULL REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  reversal_journal_entry_id UUID NULL REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  notes TEXT NULL,
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
  CONSTRAINT uq_depreciation_runs_number UNIQUE (run_number),
  CONSTRAINT ck_depreciation_runs_period CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_depreciation_runs_period
  ON accounts.depreciation_runs (fiscal_period_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_runs_status
  ON accounts.depreciation_runs (status);

CREATE TABLE IF NOT EXISTS accounts.depreciation_run_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL
    REFERENCES accounts.depreciation_runs(id) ON DELETE CASCADE,
  fixed_asset_id UUID NOT NULL
    REFERENCES accounts.fixed_assets(id) ON DELETE RESTRICT,
  category_id UUID NOT NULL
    REFERENCES accounts.asset_categories(id) ON DELETE RESTRICT,
  depreciation_expense_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  accumulated_depreciation_gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  opening_accumulated NUMERIC(18, 3) NOT NULL DEFAULT 0,
  depreciation_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (depreciation_amount >= 0),
  closing_accumulated NUMERIC(18, 3) NOT NULL DEFAULT 0,
  net_book_value NUMERIC(18, 3) NOT NULL DEFAULT 0,
  months_depreciated INTEGER NOT NULL DEFAULT 1,
  is_final_period BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_depreciation_run_lines_asset UNIQUE (run_id, fixed_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_depreciation_run_lines_run
  ON accounts.depreciation_run_lines (run_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_run_lines_asset
  ON accounts.depreciation_run_lines (fixed_asset_id);

-- ─────────────────────────────────────────────────────────────
-- استبعاد الأصول (بيع/إتلاف/فقد)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.asset_disposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disposal_number VARCHAR(40) NOT NULL,
  fixed_asset_id UUID NOT NULL
    REFERENCES accounts.fixed_assets(id) ON DELETE RESTRICT,
  disposal_type VARCHAR(20) NOT NULL
    CHECK (disposal_type IN ('SALE', 'SCRAP', 'DAMAGE', 'LOSS', 'DONATION_OUT')),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'POSTED', 'VOIDED')),
  disposal_date DATE NOT NULL,
  fiscal_year_id UUID NOT NULL REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  -- القيم عند الاستبعاد (snapshot)
  disposal_cost NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (disposal_cost >= 0),
  accumulated_depreciation NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (accumulated_depreciation >= 0),
  net_book_value NUMERIC(18, 3) NOT NULL DEFAULT 0,
  proceeds_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (proceeds_amount >= 0),
  gain_loss_amount NUMERIC(18, 3) NOT NULL DEFAULT 0,
  -- عند البيع: حساب النقدية/البنك للمتحصلات
  proceeds_gl_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  gain_gl_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  loss_gl_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  buyer_name VARCHAR(200) NULL,
  reason TEXT NULL,
  notes TEXT NULL,
  journal_entry_id UUID NULL REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  reversal_journal_entry_id UUID NULL REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
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
  CONSTRAINT uq_asset_disposals_number UNIQUE (disposal_number)
);

CREATE INDEX IF NOT EXISTS idx_asset_disposals_asset
  ON accounts.asset_disposals (fixed_asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_disposals_status
  ON accounts.asset_disposals (status);

COMMIT;
