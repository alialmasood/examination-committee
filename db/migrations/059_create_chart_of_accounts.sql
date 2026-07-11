-- Migration: دليل الحسابات وشجرة الحسابات (الخطوة 1)
-- Schema: accounts
-- لا يعدّل migration 058

BEGIN;

-- =========================
-- أنواع الحسابات
-- =========================
CREATE TABLE IF NOT EXISTS accounts.account_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200),
  normal_balance VARCHAR(10) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT account_types_normal_balance_check CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
  CONSTRAINT account_types_sort_order_positive CHECK (sort_order > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_types_code_lower
  ON accounts.account_types (LOWER(code));

CREATE INDEX IF NOT EXISTS idx_account_types_is_active
  ON accounts.account_types (is_active);

CREATE INDEX IF NOT EXISTS idx_account_types_sort_order
  ON accounts.account_types (sort_order);

COMMENT ON TABLE accounts.account_types IS 'أنواع الحسابات الأساسية لدليل الحسابات';

INSERT INTO accounts.account_types (code, name_ar, name_en, normal_balance, sort_order, is_active)
VALUES
  ('ASSET', 'الأصول', 'Assets', 'DEBIT', 1, TRUE),
  ('LIABILITY', 'الالتزامات', 'Liabilities', 'CREDIT', 2, TRUE),
  ('EQUITY', 'حقوق الملكية وصافي الأصول', 'Equity / Net Assets', 'CREDIT', 3, TRUE),
  ('REVENUE', 'الإيرادات', 'Revenue', 'CREDIT', 4, TRUE),
  ('EXPENSE', 'المصروفات', 'Expenses', 'DEBIT', 5, TRUE)
ON CONFLICT ((LOWER(code))) DO NOTHING;

-- =========================
-- دليل الحسابات (الشجرة)
-- =========================
CREATE TABLE IF NOT EXISTS accounts.chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200),
  account_type_id UUID NOT NULL REFERENCES accounts.account_types(id) ON DELETE RESTRICT,
  parent_id UUID REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  level INTEGER NOT NULL DEFAULT 1,
  is_group BOOLEAN NOT NULL DEFAULT FALSE,
  allow_posting BOOLEAN NOT NULL DEFAULT TRUE,
  normal_balance VARCHAR(10) NOT NULL,
  requires_cost_center BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id),
  updated_by UUID REFERENCES student_affairs.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chart_accounts_not_self_parent CHECK (parent_id IS DISTINCT FROM id),
  CONSTRAINT chart_accounts_level_positive CHECK (level >= 1),
  CONSTRAINT chart_accounts_normal_balance_check CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
  CONSTRAINT chart_accounts_group_posting_check CHECK (
    (is_group = TRUE AND allow_posting = FALSE)
    OR (is_group = FALSE AND allow_posting = TRUE)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chart_of_accounts_code_lower
  ON accounts.chart_of_accounts (LOWER(code));

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_parent
  ON accounts.chart_of_accounts (parent_id);

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_type
  ON accounts.chart_of_accounts (account_type_id);

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_is_active
  ON accounts.chart_of_accounts (is_active);

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_allow_posting
  ON accounts.chart_of_accounts (allow_posting);

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_level
  ON accounts.chart_of_accounts (level);

COMMENT ON TABLE accounts.chart_of_accounts IS 'دليل الحسابات وشجرة الحسابات';

COMMIT;
