-- 094: Payroll Foundation — Schema & Core Registry — 9.A.1
-- المرجع الملزم: docs/payroll-9a-architecture-plan.md (Architecture Frozen)
-- ينشئ الأساس البنيوي لوحدة الرواتب دون معالجة/كشوف/احتساب/قيود (مؤجلة إلى 9.A.2+).
-- سلامة: لا حذف/إعادة تسمية جداول قائمة، لا FK إلى hr، لا CASCADE خطير خارج السجلّات التابعة.
BEGIN;

-- ─────────────────────────────────────────────────────────────
-- أنواع تسلسل المستندات الخاصة بالرواتب (9.A.1 فقط)
-- PAYROLL_RUN / PAYROLL_ADJUSTMENT مؤجّلة إلى مرحلة تشغيل الرواتب.
-- ─────────────────────────────────────────────────────────────
INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES
  ('PAYROLL_PERSON', 'شخص رواتب', 'PYP', TRUE),
  ('PAYROLL_CONTRACT', 'عقد رواتب', 'PYC', TRUE),
  ('PAYROLL_ASSIGNMENT', 'تكليف رواتب', 'PYA', TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts.document_sequences (
  document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active
)
SELECT t.code, y.id, t.prefix_default, 0, 6, TRUE, TRUE
FROM accounts.document_sequence_types t
CROSS JOIN accounts.fiscal_years y
WHERE t.code IN ('PAYROLL_PERSON', 'PAYROLL_CONTRACT', 'PAYROLL_ASSIGNMENT')
  AND NOT EXISTS (
    SELECT 1 FROM accounts.document_sequences ds
    WHERE ds.document_type = t.code AND ds.fiscal_year_id = y.id
  );

-- ─────────────────────────────────────────────────────────────
-- 1) تقويمات الرواتب (بنية تأسيسية — بلا توليد فترات آلي، D12)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.payroll_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NULL,
  calendar_type VARCHAR(20) NOT NULL
    CHECK (calendar_type IN ('MONTHLY', 'LECTURER', 'DAILY', 'SUMMER', 'ACADEMIC')),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'IQD',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_calendars_code UNIQUE (code),
  CONSTRAINT ck_payroll_calendars_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ck_payroll_calendars_version CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_payroll_calendars_active
  ON accounts.payroll_calendars (is_active);
CREATE INDEX IF NOT EXISTS idx_payroll_calendars_type
  ON accounts.payroll_calendars (calendar_type);

-- ─────────────────────────────────────────────────────────────
-- 2) سجل أشخاص الرواتب (مستقل عن HR — hr_person_id بلا FK)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.payroll_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_code VARCHAR(40) NOT NULL,
  full_name_ar VARCHAR(200) NOT NULL,
  full_name_en VARCHAR(200) NULL,
  person_type VARCHAR(20) NOT NULL
    CHECK (person_type IN ('TEACHING_STAFF', 'EXTERNAL_LECTURER', 'EMPLOYEE', 'DAILY_WORKER', 'SERVICE_WORKER')),
  -- ربط اختياري بوحدة HR دون Foreign Key (استقلال معماري متعمّد)
  hr_person_id UUID NULL,
  user_id UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  department_id UUID NULL REFERENCES student_affairs.departments(id) ON DELETE SET NULL,
  default_cost_center_id UUID NULL REFERENCES accounts.cost_centers(id) ON DELETE SET NULL,
  default_currency_code VARCHAR(3) NOT NULL DEFAULT 'IQD',
  -- payment_method محجوز — الدفع الفعلي في مرحلة لاحقة (9.C)
  payment_method VARCHAR(20) NULL
    CHECK (payment_method IS NULL OR payment_method IN ('CASH', 'BANK', 'CHEQUE', 'RESERVED')),
  bank_account_name VARCHAR(200) NULL,
  -- يُخزَّن مقنّعاً فقط — لا تُخزَّن بيانات مصرفية كاملة
  bank_account_identifier_masked VARCHAR(60) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'TERMINATED', 'INACTIVE')),
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_people_code UNIQUE (person_code),
  CONSTRAINT ck_payroll_people_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ck_payroll_people_version CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_payroll_people_type
  ON accounts.payroll_people (person_type);
CREATE INDEX IF NOT EXISTS idx_payroll_people_status
  ON accounts.payroll_people (status);
CREATE INDEX IF NOT EXISTS idx_payroll_people_department
  ON accounts.payroll_people (department_id);
CREATE INDEX IF NOT EXISTS idx_payroll_people_user
  ON accounts.payroll_people (user_id);
CREATE INDEX IF NOT EXISTS idx_payroll_people_hr
  ON accounts.payroll_people (hr_person_id) WHERE hr_person_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 3) عقود الرواتب (عقد أساسي واحد فعّال لكل شخص — D2)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.payroll_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_person_id UUID NOT NULL
    REFERENCES accounts.payroll_people(id) ON DELETE RESTRICT,
  contract_number VARCHAR(40) NOT NULL,
  compensation_basis VARCHAR(20) NOT NULL
    CHECK (compensation_basis IN ('MONTHLY_FIXED', 'HOURLY', 'PER_LECTURE', 'DAILY', 'FIXED_SERVICE')),
  base_amount NUMERIC(18, 3) NOT NULL DEFAULT 0 CHECK (base_amount >= 0),
  rate_amount NUMERIC(18, 3) NULL CHECK (rate_amount IS NULL OR rate_amount >= 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'IQD',
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'EXPIRED', 'CANCELLED')),
  default_expense_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  payable_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  default_cost_center_id UUID NULL
    REFERENCES accounts.cost_centers(id) ON DELETE SET NULL,
  notes TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_contracts_number UNIQUE (contract_number),
  CONSTRAINT ck_payroll_contracts_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ck_payroll_contracts_version CHECK (version >= 1)
);

-- فرض عقد ACTIVE أساسي واحد فقط لكل شخص (على مستوى القاعدة)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_contracts_one_active
  ON accounts.payroll_contracts (payroll_person_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_payroll_contracts_person
  ON accounts.payroll_contracts (payroll_person_id);
CREATE INDEX IF NOT EXISTS idx_payroll_contracts_status
  ON accounts.payroll_contracts (status);

-- ─────────────────────────────────────────────────────────────
-- 4) تكليفات الرواتب (مصادر استحقاق ومسؤوليات إضافية — ليست عقداً ثانياً)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.payroll_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_person_id UUID NOT NULL
    REFERENCES accounts.payroll_people(id) ON DELETE RESTRICT,
  payroll_contract_id UUID NULL
    REFERENCES accounts.payroll_contracts(id) ON DELETE RESTRICT,
  assignment_code VARCHAR(40) NOT NULL,
  assignment_type VARCHAR(30) NOT NULL
    CHECK (assignment_type IN (
      'TEMPORARY_DUTY', 'ADDITIONAL_RESPONSIBILITY', 'ALLOWANCE_SOURCE',
      'LECTURER_ASSIGNMENT', 'COMMITTEE_ASSIGNMENT', 'GENERAL_ASSIGNMENT'
    )),
  title_ar VARCHAR(200) NOT NULL,
  title_en VARCHAR(200) NULL,
  department_id UUID NULL REFERENCES student_affairs.departments(id) ON DELETE SET NULL,
  cost_center_id UUID NULL REFERENCES accounts.cost_centers(id) ON DELETE SET NULL,
  reference_type VARCHAR(40) NULL,
  reference_id UUID NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ENDED')),
  metadata_json JSONB NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_assignments_code UNIQUE (assignment_code),
  CONSTRAINT ck_payroll_assignments_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ck_payroll_assignments_version CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_payroll_assignments_person
  ON accounts.payroll_assignments (payroll_person_id);
CREATE INDEX IF NOT EXISTS idx_payroll_assignments_contract
  ON accounts.payroll_assignments (payroll_contract_id);
CREATE INDEX IF NOT EXISTS idx_payroll_assignments_status
  ON accounts.payroll_assignments (status);
CREATE INDEX IF NOT EXISTS idx_payroll_assignments_type
  ON accounts.payroll_assignments (assignment_type);

-- ─────────────────────────────────────────────────────────────
-- 5) مكوّنات الرواتب (Component Configuration — مصدر السلوك المالي)
-- CUSTOM_FORMULA محجوز فقط — يُرفَض تنفيذه في 9.A (D14).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.payroll_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_code VARCHAR(40) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NULL,
  component_type VARCHAR(25) NOT NULL
    CHECK (component_type IN ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION')),
  calculation_method VARCHAR(25) NOT NULL
    CHECK (calculation_method IN (
      'FIXED_AMOUNT', 'PERCENTAGE_OF_BASIC', 'QUANTITY_X_RATE', 'DAYS_X_DAILY_RATE',
      'HOURS_X_HOURLY_RATE', 'LECTURES_X_RATE', 'MANUAL_AMOUNT', 'CUSTOM_FORMULA'
    )),
  default_amount NUMERIC(18, 3) NULL CHECK (default_amount IS NULL OR default_amount >= 0),
  default_rate NUMERIC(18, 3) NULL CHECK (default_rate IS NULL OR default_rate >= 0),
  default_percentage NUMERIC(9, 4) NULL
    CHECK (default_percentage IS NULL OR (default_percentage >= 0 AND default_percentage <= 100)),
  expense_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  liability_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  default_cost_center_id UUID NULL
    REFERENCES accounts.cost_centers(id) ON DELETE SET NULL,
  is_taxable BOOLEAN NOT NULL DEFAULT FALSE,
  is_pensionable BOOLEAN NOT NULL DEFAULT FALSE,
  show_on_payslip BOOLEAN NOT NULL DEFAULT TRUE,
  allow_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  is_system_seeded BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  minimum_amount NUMERIC(18, 3) NULL CHECK (minimum_amount IS NULL OR minimum_amount >= 0),
  maximum_amount NUMERIC(18, 3) NULL CHECK (maximum_amount IS NULL OR maximum_amount >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_components_code UNIQUE (component_code),
  CONSTRAINT ck_payroll_components_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ck_payroll_components_minmax
    CHECK (minimum_amount IS NULL OR maximum_amount IS NULL OR maximum_amount >= minimum_amount),
  CONSTRAINT ck_payroll_components_version CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_payroll_components_type
  ON accounts.payroll_components (component_type);
CREATE INDEX IF NOT EXISTS idx_payroll_components_method
  ON accounts.payroll_components (calculation_method);
CREATE INDEX IF NOT EXISTS idx_payroll_components_active
  ON accounts.payroll_components (is_active);

-- ─────────────────────────────────────────────────────────────
-- 6) إسنادات المكوّنات (ربط المكوّن بالشخص/العقد/التكليف)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.payroll_component_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_person_id UUID NOT NULL
    REFERENCES accounts.payroll_people(id) ON DELETE RESTRICT,
  payroll_contract_id UUID NULL
    REFERENCES accounts.payroll_contracts(id) ON DELETE RESTRICT,
  payroll_assignment_id UUID NULL
    REFERENCES accounts.payroll_assignments(id) ON DELETE RESTRICT,
  payroll_component_id UUID NOT NULL
    REFERENCES accounts.payroll_components(id) ON DELETE RESTRICT,
  override_calculation_method VARCHAR(25) NULL
    CHECK (override_calculation_method IS NULL OR override_calculation_method IN (
      'FIXED_AMOUNT', 'PERCENTAGE_OF_BASIC', 'QUANTITY_X_RATE', 'DAYS_X_DAILY_RATE',
      'HOURS_X_HOURLY_RATE', 'LECTURES_X_RATE', 'MANUAL_AMOUNT', 'CUSTOM_FORMULA'
    )),
  amount NUMERIC(18, 3) NULL CHECK (amount IS NULL OR amount >= 0),
  rate NUMERIC(18, 3) NULL CHECK (rate IS NULL OR rate >= 0),
  percentage NUMERIC(9, 4) NULL
    CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
  quantity NUMERIC(18, 3) NULL CHECK (quantity IS NULL OR quantity >= 0),
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_pca_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- مصدر واحد فقط: عقد أو تكليف (وليس كليهما)
  CONSTRAINT ck_pca_single_source
    CHECK (NOT (payroll_contract_id IS NOT NULL AND payroll_assignment_id IS NOT NULL)),
  CONSTRAINT ck_pca_version CHECK (version >= 1)
);

-- منع تكرار غير مفسَّر لنفس (الشخص/المكوّن/المصدر/بداية السريان) — D2
CREATE UNIQUE INDEX IF NOT EXISTS uq_pca_person_component_source_period
  ON accounts.payroll_component_assignments (
    payroll_person_id,
    payroll_component_id,
    COALESCE(payroll_assignment_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(payroll_contract_id, '00000000-0000-0000-0000-000000000000'::uuid),
    effective_from
  );

CREATE INDEX IF NOT EXISTS idx_pca_person
  ON accounts.payroll_component_assignments (payroll_person_id);
CREATE INDEX IF NOT EXISTS idx_pca_component
  ON accounts.payroll_component_assignments (payroll_component_id);
CREATE INDEX IF NOT EXISTS idx_pca_contract
  ON accounts.payroll_component_assignments (payroll_contract_id);
CREATE INDEX IF NOT EXISTS idx_pca_assignment
  ON accounts.payroll_component_assignments (payroll_assignment_id);
CREATE INDEX IF NOT EXISTS idx_pca_active
  ON accounts.payroll_component_assignments (is_active);

-- ─────────────────────────────────────────────────────────────
-- 7) خرائط الحسابات المحاسبية (Mapping مرن — بلا GL Hardcoded)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.payroll_account_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_code VARCHAR(40) NOT NULL,
  mapping_scope VARCHAR(20) NOT NULL
    CHECK (mapping_scope IN ('DEFAULT', 'PERSON_TYPE', 'COMPONENT', 'CALENDAR', 'ROUNDING')),
  payroll_component_id UUID NULL
    REFERENCES accounts.payroll_components(id) ON DELETE RESTRICT,
  person_type VARCHAR(20) NULL
    CHECK (person_type IS NULL OR person_type IN (
      'TEACHING_STAFF', 'EXTERNAL_LECTURER', 'EMPLOYEE', 'DAILY_WORKER', 'SERVICE_WORKER'
    )),
  payroll_calendar_id UUID NULL
    REFERENCES accounts.payroll_calendars(id) ON DELETE RESTRICT,
  expense_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  liability_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  payable_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  rounding_account_id UUID NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_center_id UUID NULL
    REFERENCES accounts.cost_centers(id) ON DELETE SET NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_account_mappings_code UNIQUE (mapping_code),
  CONSTRAINT ck_payroll_account_mappings_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ck_payroll_account_mappings_version CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_payroll_mappings_scope
  ON accounts.payroll_account_mappings (mapping_scope);
CREATE INDEX IF NOT EXISTS idx_payroll_mappings_component
  ON accounts.payroll_account_mappings (payroll_component_id);
CREATE INDEX IF NOT EXISTS idx_payroll_mappings_person_type
  ON accounts.payroll_account_mappings (person_type);
CREATE INDEX IF NOT EXISTS idx_payroll_mappings_calendar
  ON accounts.payroll_account_mappings (payroll_calendar_id);
CREATE INDEX IF NOT EXISTS idx_payroll_mappings_active
  ON accounts.payroll_account_mappings (is_active);

-- ─────────────────────────────────────────────────────────────
-- خط دفاع version >= 1: يضمن تطبيق القيد على الجداول القائمة مسبقاً
-- (idempotent — يُضاف فقط إن لم يكن موجوداً؛ الجداول الجديدة تحمله inline).
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  c TEXT;
  tables TEXT[] := ARRAY[
    'payroll_calendars','payroll_people','payroll_contracts','payroll_assignments',
    'payroll_components','payroll_component_assignments','payroll_account_mappings'
  ];
  consts TEXT[] := ARRAY[
    'ck_payroll_calendars_version','ck_payroll_people_version','ck_payroll_contracts_version',
    'ck_payroll_assignments_version','ck_payroll_components_version','ck_pca_version',
    'ck_payroll_account_mappings_version'
  ];
  i INT;
BEGIN
  FOR i IN 1 .. array_length(tables, 1) LOOP
    t := tables[i];
    c := consts[i];
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = c AND conrelid = ('accounts.' || t)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE accounts.%I ADD CONSTRAINT %I CHECK (version >= 1)', t, c
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
