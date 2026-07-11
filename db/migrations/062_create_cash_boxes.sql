-- Migration: 062 — نواة إدارة الصناديق (المرحلة 3.A / خطوة A1)
-- يشمل: platform.system_settings (مشترك) + أنواع الصناديق + الصناديق + الأمناء
-- بلا بيانات تشغيلية / بلا Seed
-- لا يعدّل migrations 058–061

BEGIN;

-- =========================
-- إعدادات عامة للمنصة (Shared Settings)
-- =========================
CREATE TABLE IF NOT EXISTS platform.system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key VARCHAR(120) NOT NULL,
  setting_value TEXT,
  value_type VARCHAR(30) NOT NULL DEFAULT 'string',
  description TEXT,
  created_by UUID REFERENCES student_affairs.users(id),
  updated_by UUID REFERENCES student_affairs.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT system_settings_key_not_blank_check CHECK (length(trim(setting_key)) > 0),
  CONSTRAINT system_settings_value_type_check CHECK (
    value_type IN ('string', 'number', 'boolean', 'json', 'uuid')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_system_settings_key_lower
  ON platform.system_settings (LOWER(setting_key));

CREATE INDEX IF NOT EXISTS idx_platform_system_settings_updated_at
  ON platform.system_settings (updated_at DESC);

COMMENT ON TABLE platform.system_settings IS
  'إعدادات عامة للمنصة قابلة لإعادة الاستخدام من جميع الأنظمة (مفتاح/قيمة)';

-- =========================
-- أنواع الصناديق (مرجع قابل للتوسع)
-- =========================
CREATE TABLE IF NOT EXISTS accounts.cash_box_types (
  code VARCHAR(30) PRIMARY KEY,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200),
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cash_box_types_code_not_blank_check CHECK (length(trim(code)) > 0),
  CONSTRAINT cash_box_types_name_ar_not_blank_check CHECK (length(trim(name_ar)) > 0),
  CONSTRAINT cash_box_types_sort_order_positive_check CHECK (sort_order > 0)
);

CREATE INDEX IF NOT EXISTS idx_cash_box_types_is_active
  ON accounts.cash_box_types (is_active);

CREATE INDEX IF NOT EXISTS idx_cash_box_types_sort_order
  ON accounts.cash_box_types (sort_order);

COMMENT ON TABLE accounts.cash_box_types IS
  'أنواع الصناديق المرجعية (MAIN/PETTY/FEES/TEMPORARY وغيرها لاحقاً عبر Seed)';

-- =========================
-- الصناديق النقدية
-- =========================
CREATE TABLE IF NOT EXISTS accounts.cash_boxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200),
  box_type_code VARCHAR(30) NOT NULL
    REFERENCES accounts.cash_box_types(code) ON DELETE RESTRICT,
  account_id UUID
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  closed_account_id UUID
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_center_id UUID
    REFERENCES accounts.cost_centers(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  ceiling_amount NUMERIC(18,3),
  currency_code VARCHAR(10) NOT NULL DEFAULT 'IQD',
  location_note TEXT,
  description TEXT,
  opened_at DATE,
  closed_at DATE,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id),
  updated_by UUID REFERENCES student_affairs.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cash_boxes_code_not_blank_check CHECK (length(trim(code)) > 0),
  CONSTRAINT cash_boxes_name_ar_not_blank_check CHECK (length(trim(name_ar)) > 0),
  CONSTRAINT cash_boxes_status_check CHECK (
    status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED')
  ),
  CONSTRAINT cash_boxes_version_positive_check CHECK (version >= 1),
  CONSTRAINT cash_boxes_ceiling_positive_check CHECK (
    ceiling_amount IS NULL OR ceiling_amount > 0
  ),
  CONSTRAINT cash_boxes_currency_not_blank_check CHECK (length(trim(currency_code)) > 0),
  CONSTRAINT cash_boxes_closed_requires_dates_check CHECK (
    status <> 'CLOSED'
    OR (closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_boxes_code_lower
  ON accounts.cash_boxes (LOWER(code));

-- حساب واحد لا يُربط بأكثر من صندوق حي (ACTIVE أو SUSPENDED)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_boxes_account_live
  ON accounts.cash_boxes (account_id)
  WHERE account_id IS NOT NULL
    AND status IN ('ACTIVE', 'SUSPENDED');

CREATE INDEX IF NOT EXISTS idx_cash_boxes_status
  ON accounts.cash_boxes (status);

CREATE INDEX IF NOT EXISTS idx_cash_boxes_box_type
  ON accounts.cash_boxes (box_type_code);

CREATE INDEX IF NOT EXISTS idx_cash_boxes_account
  ON accounts.cash_boxes (account_id);

CREATE INDEX IF NOT EXISTS idx_cash_boxes_cost_center
  ON accounts.cash_boxes (cost_center_id);

CREATE INDEX IF NOT EXISTS idx_cash_boxes_updated_at
  ON accounts.cash_boxes (updated_at DESC);

COMMENT ON TABLE accounts.cash_boxes IS
  'كيانات الصناديق النقدية — الرصيد الدفتري يُحسب من القيود المرحلة ولا يُخزَّن هنا';
COMMENT ON COLUMN accounts.cash_boxes.version IS
  'تزامن متفائل — يُزاد مع كل تحديث جوهري';
COMMENT ON COLUMN accounts.cash_boxes.updated_at IS
  'يُستخدم مع version للتحقق المتفائل والتطوير المستقبلي';
COMMENT ON COLUMN accounts.cash_boxes.closed_account_id IS
  'لقطة الحساب عند الإغلاق النهائي بعد فك الربط التشغيلي';

-- =========================
-- أمناء الصناديق
-- =========================
CREATE TABLE IF NOT EXISTS accounts.cash_box_custodians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_box_id UUID NOT NULL
    REFERENCES accounts.cash_boxes(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  role VARCHAR(20) NOT NULL DEFAULT 'CUSTODIAN',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id),
  updated_by UUID REFERENCES student_affairs.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cash_box_custodians_role_check CHECK (
    role IN ('CUSTODIAN', 'SUPERVISOR')
  ),
  CONSTRAINT cash_box_custodians_valid_range_check CHECK (
    valid_to IS NULL OR valid_to > valid_from
  )
);

-- أمين أساسي واحد ساري لكل صندوق
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_box_one_primary_active
  ON accounts.cash_box_custodians (cash_box_id)
  WHERE is_primary = TRUE
    AND valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_cash_box_custodians_box
  ON accounts.cash_box_custodians (cash_box_id);

CREATE INDEX IF NOT EXISTS idx_cash_box_custodians_user
  ON accounts.cash_box_custodians (user_id);

CREATE INDEX IF NOT EXISTS idx_cash_box_custodians_valid
  ON accounts.cash_box_custodians (cash_box_id, valid_from, valid_to);

COMMENT ON TABLE accounts.cash_box_custodians IS
  'تعيينات أمناء ومراقبي الصناديق مع فترات سريان';

COMMIT;
