-- Migration: نواة نظام الحسابات (الخطوة 0)
-- Schema: accounts
-- جداول: السنوات المالية، الفترات، مراكز الكلفة، تسلسل المستندات، سجل التدقيق المالي

BEGIN;

CREATE SCHEMA IF NOT EXISTS accounts;

-- =========================
-- السنوات المالية
-- =========================
CREATE TABLE IF NOT EXISTS accounts.fiscal_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id),
  updated_by UUID REFERENCES student_affairs.users(id),
  closed_by UUID REFERENCES student_affairs.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT fiscal_years_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
  CONSTRAINT fiscal_years_dates_check CHECK (start_date < end_date),
  CONSTRAINT fiscal_years_default_not_closed_check CHECK (NOT (is_default AND status = 'CLOSED')),
  CONSTRAINT fiscal_years_default_active_check CHECK (NOT (is_default AND status <> 'ACTIVE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_years_code_lower
  ON accounts.fiscal_years (LOWER(code));

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_years_one_default
  ON accounts.fiscal_years (is_default)
  WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_fiscal_years_status
  ON accounts.fiscal_years (status);

CREATE INDEX IF NOT EXISTS idx_fiscal_years_dates
  ON accounts.fiscal_years (start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_fiscal_years_is_default
  ON accounts.fiscal_years (is_default);

COMMENT ON TABLE accounts.fiscal_years IS 'السنوات المالية لنظام الحسابات';

-- =========================
-- الفترات المحاسبية
-- =========================
CREATE TABLE IF NOT EXISTS accounts.fiscal_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year_id UUID NOT NULL REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  period_number INTEGER NOT NULL,
  code VARCHAR(50) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  created_by UUID NOT NULL REFERENCES student_affairs.users(id),
  updated_by UUID REFERENCES student_affairs.users(id),
  closed_by UUID REFERENCES student_affairs.users(id),
  locked_by UUID REFERENCES student_affairs.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  CONSTRAINT fiscal_periods_status_check CHECK (status IN ('OPEN', 'CLOSED', 'LOCKED')),
  CONSTRAINT fiscal_periods_dates_check CHECK (start_date < end_date),
  CONSTRAINT fiscal_periods_number_positive CHECK (period_number > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_periods_year_number
  ON accounts.fiscal_periods (fiscal_year_id, period_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_periods_year_code_lower
  ON accounts.fiscal_periods (fiscal_year_id, LOWER(code));

CREATE INDEX IF NOT EXISTS idx_fiscal_periods_year
  ON accounts.fiscal_periods (fiscal_year_id);

CREATE INDEX IF NOT EXISTS idx_fiscal_periods_status
  ON accounts.fiscal_periods (status);

CREATE INDEX IF NOT EXISTS idx_fiscal_periods_dates
  ON accounts.fiscal_periods (start_date, end_date);

COMMENT ON TABLE accounts.fiscal_periods IS 'الفترات المحاسبية المرتبطة بالسنوات المالية';

-- =========================
-- مراكز الكلفة
-- =========================
CREATE TABLE IF NOT EXISTS accounts.cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200),
  parent_id UUID REFERENCES accounts.cost_centers(id) ON DELETE RESTRICT,
  level INTEGER NOT NULL DEFAULT 1,
  is_group BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  department_id UUID REFERENCES student_affairs.departments(id) ON DELETE SET NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id),
  updated_by UUID REFERENCES student_affairs.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cost_centers_not_self_parent CHECK (parent_id IS DISTINCT FROM id),
  CONSTRAINT cost_centers_level_positive CHECK (level >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_centers_code_lower
  ON accounts.cost_centers (LOWER(code));

CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_centers_department_one
  ON accounts.cost_centers (department_id)
  WHERE department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cost_centers_parent
  ON accounts.cost_centers (parent_id);

CREATE INDEX IF NOT EXISTS idx_cost_centers_is_active
  ON accounts.cost_centers (is_active);

CREATE INDEX IF NOT EXISTS idx_cost_centers_department
  ON accounts.cost_centers (department_id);

COMMENT ON TABLE accounts.cost_centers IS 'مراكز الكلفة (شجرة)';

-- =========================
-- تسلسل أرقام المستندات (سنوي)
-- =========================
CREATE TABLE IF NOT EXISTS accounts.document_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type VARCHAR(50) NOT NULL,
  fiscal_year_id UUID NOT NULL REFERENCES accounts.fiscal_years(id) ON DELETE CASCADE,
  prefix VARCHAR(20) NOT NULL,
  current_number INTEGER NOT NULL DEFAULT 0,
  padding_length INTEGER NOT NULL DEFAULT 6,
  reset_yearly BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_sequences_type_check CHECK (
    document_type IN (
      'JOURNAL_ENTRY',
      'RECEIPT_VOUCHER',
      'PAYMENT_VOUCHER',
      'FINANCIAL_TRANSFER',
      'OPENING_BALANCE'
    )
  ),
  CONSTRAINT document_sequences_number_nonneg CHECK (current_number >= 0),
  CONSTRAINT document_sequences_padding_range CHECK (padding_length BETWEEN 1 AND 12)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_sequences_type_year
  ON accounts.document_sequences (document_type, fiscal_year_id);

CREATE INDEX IF NOT EXISTS idx_document_sequences_year
  ON accounts.document_sequences (fiscal_year_id);

COMMENT ON TABLE accounts.document_sequences IS 'تسلسل الترقيم التلقائي للمستندات المحاسبية حسب السنة المالية';

-- =========================
-- سجل التدقيق المالي
-- =========================
CREATE TABLE IF NOT EXISTS accounts.financial_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES student_affairs.users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  old_values JSONB,
  new_values JSONB,
  description TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_audit_user
  ON accounts.financial_audit_log (user_id);

CREATE INDEX IF NOT EXISTS idx_financial_audit_entity
  ON accounts.financial_audit_log (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_financial_audit_action
  ON accounts.financial_audit_log (action);

CREATE INDEX IF NOT EXISTS idx_financial_audit_created
  ON accounts.financial_audit_log (created_at DESC);

COMMENT ON TABLE accounts.financial_audit_log IS 'سجل التدقيق المالي — للقراءة فقط من واجهة النظام';

COMMIT;
