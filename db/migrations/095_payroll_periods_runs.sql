-- 095: Payroll Periods, Runs & Scope — 9.A.2.1
-- المرجع الملزم: docs/payroll-9a2-architecture-plan.md (Architecture Ready for Implementation)
-- ينشئ طبقة الفترات والتشغيلات والنطاق فقط — بلا محرك احتساب ولا لقطات ولا أسطر.
-- جداول الاحتساب التفصيلية (payroll_run_people / lines / issues) مؤجّلة إلى Migration 096.
-- سلامة: لا تعديل على 094، لا FK إلى hr، CASCADE مقصور على السجلّ التابع تماماً (scope_members).
BEGIN;

-- ─────────────────────────────────────────────────────────────
-- أنواع تسلسل المستندات لطبقة الفترات/التشغيلات (9.A.2.1)
-- PAYROLL_ADJUSTMENT مؤجّلة (لا تُضاف الآن).
-- الأكواد ضمن عائلة الرواتب PY* التزاماً بالبنية القائمة (PYP/PYC/PYA).
-- ─────────────────────────────────────────────────────────────
INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES
  ('PAYROLL_PERIOD', 'فترة رواتب', 'PYPR', TRUE),
  ('PAYROLL_RUN', 'تشغيل رواتب', 'PYR', TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts.document_sequences (
  document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active
)
SELECT t.code, y.id, t.prefix_default, 0, 6, TRUE, TRUE
FROM accounts.document_sequence_types t
CROSS JOIN accounts.fiscal_years y
WHERE t.code IN ('PAYROLL_PERIOD', 'PAYROLL_RUN')
  AND NOT EXISTS (
    SELECT 1 FROM accounts.document_sequences ds
    WHERE ds.document_type = t.code AND ds.fiscal_year_id = y.id
  );

-- ─────────────────────────────────────────────────────────────
-- 1) calculation_base_type على مكوّنات الرواتب (D18 — النهج B)
-- القيم على مستوى القاعدة: NONE / CONTRACT_BASIC (منفّذة) + ثلاث محجوزة.
-- الخدمة ترفض المحجوزة عند الإنشاء/التعديل في 9.A.2.1.
-- لا base_component_id ولا جدول اعتماديات الآن.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE accounts.payroll_components
  ADD COLUMN IF NOT EXISTS calculation_base_type VARCHAR(25) NOT NULL DEFAULT 'NONE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_payroll_components_base_type'
      AND conrelid = 'accounts.payroll_components'::regclass
  ) THEN
    ALTER TABLE accounts.payroll_components
      ADD CONSTRAINT ck_payroll_components_base_type
      CHECK (calculation_base_type IN (
        'NONE', 'CONTRACT_BASIC', 'GROSS_EARNINGS', 'SELECTED_COMPONENTS', 'COMPONENT_REFERENCE'
      ));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 2) فترات الرواتب (Payroll Periods)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.payroll_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_code VARCHAR(40) NOT NULL,
  payroll_calendar_id UUID NOT NULL
    REFERENCES accounts.payroll_calendars(id) ON DELETE RESTRICT,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  calculation_date DATE NOT NULL,
  payment_due_date DATE NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'PROCESSING', 'CLOSED', 'CANCELLED')),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'IQD',
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  transition_reason TEXT NULL,
  opened_at TIMESTAMPTZ NULL,
  opened_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ NULL,
  closed_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  reopened_at TIMESTAMPTZ NULL,
  reopened_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_periods_code UNIQUE (period_code),
  CONSTRAINT ck_payroll_periods_dates CHECK (end_date >= start_date),
  CONSTRAINT ck_payroll_periods_calcdate CHECK (calculation_date >= start_date),
  CONSTRAINT ck_payroll_periods_due
    CHECK (payment_due_date IS NULL OR payment_due_date >= end_date),
  CONSTRAINT ck_payroll_periods_version CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_payroll_periods_calendar
  ON accounts.payroll_periods (payroll_calendar_id);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_status
  ON accounts.payroll_periods (status);
-- فهرس منع التداخل (يخدم حارس الخدمة داخل قفل التقويم — Q4، بلا btree_gist)
CREATE INDEX IF NOT EXISTS idx_payroll_periods_range
  ON accounts.payroll_periods (payroll_calendar_id, start_date, end_date, status);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_fiscal_year
  ON accounts.payroll_periods (fiscal_year_id);

-- ─────────────────────────────────────────────────────────────
-- 3) تشغيلات الرواتب (Payroll Runs)
-- 9.A.2.1: VOID غير موجودة؛ حقول الاحتساب موجودة بقيم صفرية (بلا تفعيل).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number VARCHAR(40) NOT NULL,
  payroll_period_id UUID NOT NULL
    REFERENCES accounts.payroll_periods(id) ON DELETE RESTRICT,
  payroll_calendar_id UUID NOT NULL
    REFERENCES accounts.payroll_calendars(id) ON DELETE RESTRICT,
  run_type VARCHAR(20) NOT NULL DEFAULT 'REGULAR'
    CHECK (run_type IN ('REGULAR', 'CORRECTION', 'SUPPLEMENTAL', 'TERMINATION', 'MANUAL')),
  scope_type VARCHAR(20) NOT NULL DEFAULT 'ALL'
    CHECK (scope_type IN ('ALL', 'COLLEGE', 'DEPARTMENT', 'COST_CENTER', 'PERSON_LIST')),
  scope_ref_id UUID NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'CALCULATING', 'CALCULATED', 'CANCELLED')),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'IQD',
  calculation_date DATE NOT NULL,
  -- سلسلة الإصدارات (D11 — محجوزة/غير مُفعّلة في 9.A.2)
  revision_number INTEGER NOT NULL DEFAULT 1,
  root_run_id UUID NULL REFERENCES accounts.payroll_runs(id) ON DELETE RESTRICT,
  supersedes_run_id UUID NULL REFERENCES accounts.payroll_runs(id) ON DELETE RESTRICT,
  superseded_by_run_id UUID NULL REFERENCES accounts.payroll_runs(id) ON DELETE RESTRICT,
  revision_reason TEXT NULL,
  -- إجماليات (صفرية في 9.A.2.1 — تُملأ عند تفعيل المحرك في 096)
  people_count INTEGER NOT NULL DEFAULT 0,
  gross_total NUMERIC(18, 3) NOT NULL DEFAULT 0,
  deduction_total NUMERIC(18, 3) NOT NULL DEFAULT 0,
  employer_contribution_total NUMERIC(18, 3) NOT NULL DEFAULT 0,
  net_total NUMERIC(18, 3) NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  snapshot_hash VARCHAR(64) NULL,
  -- Idempotency (D23 — محجوزة/غير مُفعّلة في 9.A.2.1)
  calculation_request_id UUID NULL,
  last_calculation_request_id UUID NULL,
  calculation_attempt_number INTEGER NOT NULL DEFAULT 0,
  calculated_at TIMESTAMPTZ NULL,
  calculated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  cancellation_reason TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_runs_number UNIQUE (run_number),
  CONSTRAINT ck_payroll_runs_totals_nonneg
    CHECK (gross_total >= 0 AND deduction_total >= 0 AND employer_contribution_total >= 0),
  CONSTRAINT ck_payroll_runs_revision CHECK (revision_number >= 1),
  CONSTRAINT ck_payroll_runs_attempt CHECK (calculation_attempt_number >= 0),
  CONSTRAINT ck_payroll_runs_version CHECK (version >= 1),
  -- شكل النطاق: ALL/PERSON_LIST بلا مرجع؛ الباقي بمرجع إلزامي
  CONSTRAINT ck_payroll_runs_scope_ref CHECK (
    (scope_type IN ('ALL', 'PERSON_LIST') AND scope_ref_id IS NULL)
    OR (scope_type IN ('COLLEGE', 'DEPARTMENT', 'COST_CENTER') AND scope_ref_id IS NOT NULL)
  ),
  -- منع self-reference في سلسلة الإصدارات
  CONSTRAINT ck_payroll_runs_supersedes_self
    CHECK (supersedes_run_id IS NULL OR supersedes_run_id <> id),
  CONSTRAINT ck_payroll_runs_superseded_self
    CHECK (superseded_by_run_id IS NULL OR superseded_by_run_id <> id)
);

-- Run واحد حيّ من نوع REGULAR لكل (فترة + توقيع نطاق) — الأساس قبل payroll_run_people
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_runs_one_live_regular
  ON accounts.payroll_runs (
    payroll_period_id, scope_type,
    COALESCE(scope_ref_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE run_type = 'REGULAR' AND status IN ('DRAFT', 'CALCULATING', 'CALCULATED');

CREATE INDEX IF NOT EXISTS idx_payroll_runs_period
  ON accounts.payroll_runs (payroll_period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_calendar
  ON accounts.payroll_runs (payroll_calendar_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_status
  ON accounts.payroll_runs (status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_type
  ON accounts.payroll_runs (run_type);

-- ─────────────────────────────────────────────────────────────
-- 4) أعضاء نطاق التشغيل (PERSON_LIST فقط) — سجلّ تابع تماماً للـ Run
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.payroll_run_scope_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL
    REFERENCES accounts.payroll_runs(id) ON DELETE CASCADE,
  payroll_person_id UUID NOT NULL
    REFERENCES accounts.payroll_people(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_run_scope_member UNIQUE (payroll_run_id, payroll_person_id)
);

CREATE INDEX IF NOT EXISTS idx_run_scope_member_run
  ON accounts.payroll_run_scope_members (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_run_scope_member_person
  ON accounts.payroll_run_scope_members (payroll_person_id);

-- ─────────────────────────────────────────────────────────────
-- ملاحظة الصلاحيات (Capabilities):
--   صلاحيات الرواتب مُعرّفة في الكود (src/lib/accounts/payroll-access.ts)
--   عبر أدوار accounts_* دون جدول صلاحيات موازٍ في القاعدة (مبدأ 9.A).
--   القدرات الجديدة (payroll_view_runs / payroll_manage_periods /
--   payroll_create_runs / payroll_calculate / payroll_cancel_runs)
--   تُسجَّل وتُفرَض هناك — لا صفوف قاعدة بيانات مطلوبة هنا.
-- ─────────────────────────────────────────────────────────────

COMMIT;
