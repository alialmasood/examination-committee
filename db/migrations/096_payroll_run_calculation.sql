-- 096: Payroll Calculation Snapshot Schema — 9.A.2.2
-- المرجع الملزم: docs/payroll-9a2-architecture-plan.md
-- ينشئ جداول لقطة الاحتساب فقط (people / lines / issues) — بلا محرك احتساب.
-- لا تعديل على 094 أو 095.
-- CASCADE من Run مقبول: لا Delete API على التشغيل؛ الاستبدال داخل Transaction عند Recalculate (9.A.2.3).
BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1) payroll_run_people — لقطة الشخص داخل التشغيل
-- calculation_status المجمدة: PENDING | CALCULATED | ERROR | EXCLUDED
-- (ليست SKIPPED — القيمة المجمدة في الوثيقة هي EXCLUDED)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.payroll_run_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL
    REFERENCES accounts.payroll_runs(id) ON DELETE CASCADE,
  payroll_person_id UUID NOT NULL
    REFERENCES accounts.payroll_people(id) ON DELETE RESTRICT,
  -- NULL مسموح: غياب العقد ⇒ ERROR عند الاحتساب (D16/Architecture) — ليس NOT NULL
  payroll_contract_id UUID NULL
    REFERENCES accounts.payroll_contracts(id) ON DELETE RESTRICT,
  -- مُنزَّل من الـ Run لحارس الشخص عبر الفترة (D16)
  payroll_period_id UUID NOT NULL
    REFERENCES accounts.payroll_periods(id) ON DELETE RESTRICT,
  person_code_snapshot VARCHAR(40) NOT NULL,
  full_name_snapshot VARCHAR(200) NOT NULL,
  person_type_snapshot VARCHAR(20) NOT NULL,
  college_id_snapshot UUID NULL,
  department_id_snapshot UUID NULL,
  cost_center_id_snapshot UUID NULL,
  currency_code VARCHAR(3) NOT NULL,
  basic_amount NUMERIC(18, 3) NOT NULL DEFAULT 0,
  gross_amount NUMERIC(18, 3) NOT NULL DEFAULT 0,
  deductions_amount NUMERIC(18, 3) NOT NULL DEFAULT 0,
  employer_contributions_amount NUMERIC(18, 3) NOT NULL DEFAULT 0,
  net_amount NUMERIC(18, 3) NOT NULL DEFAULT 0,
  calculation_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (calculation_status IN ('PENDING', 'CALCULATED', 'ERROR', 'EXCLUDED')),
  warning_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  snapshot_json JSONB NOT NULL,
  -- SHA-256 hex (64) — إلزامي عند الإدراج (حتى لـ PENDING في Fixtures)
  snapshot_hash VARCHAR(64) NOT NULL,
  superseded BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_run_person UNIQUE (payroll_run_id, payroll_person_id),
  -- يدعم FK مركّب من lines/issues لضمان تطابق run_id
  CONSTRAINT uq_run_people_id_run UNIQUE (id, payroll_run_id),
  CONSTRAINT ck_run_person_version CHECK (version >= 1),
  CONSTRAINT ck_run_person_warn_count CHECK (warning_count >= 0),
  CONSTRAINT ck_run_person_err_count CHECK (error_count >= 0),
  CONSTRAINT ck_run_person_amounts_nonneg CHECK (
    basic_amount >= 0
    AND gross_amount >= 0
    AND deductions_amount >= 0
    AND employer_contributions_amount >= 0
  ),
  CONSTRAINT ck_run_person_currency CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_run_person_hash CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_run_person_snapshots_nonempty CHECK (
    length(trim(person_code_snapshot)) > 0
    AND length(trim(full_name_snapshot)) > 0
    AND length(trim(person_type_snapshot)) > 0
  )
);

-- شخص واحد حيّ لكل فترة عبر كل التشغيلات (D16) — يُحرَّر عند superseded=TRUE (إلغاء Run)
CREATE UNIQUE INDEX IF NOT EXISTS uq_run_person_one_live_per_period
  ON accounts.payroll_run_people (payroll_period_id, payroll_person_id)
  WHERE superseded = FALSE;

CREATE INDEX IF NOT EXISTS idx_run_people_run
  ON accounts.payroll_run_people (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_run_people_person
  ON accounts.payroll_run_people (payroll_person_id);
CREATE INDEX IF NOT EXISTS idx_run_people_period
  ON accounts.payroll_run_people (payroll_period_id);
CREATE INDEX IF NOT EXISTS idx_run_people_status
  ON accounts.payroll_run_people (calculation_status);

-- ─────────────────────────────────────────────────────────────
-- 2) payroll_run_lines — أسطر الاحتساب (لقطة، بلا محرك)
-- line_source: GENERATED | MANUAL_OVERRIDE
-- quantity_source: MANUAL/ASSIGNMENT منفّذان معماريًا؛ الباقي محجوز في CHECK فقط
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.payroll_run_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL
    REFERENCES accounts.payroll_runs(id) ON DELETE CASCADE,
  payroll_run_person_id UUID NOT NULL,
  payroll_component_id UUID NOT NULL
    REFERENCES accounts.payroll_components(id) ON DELETE RESTRICT,
  payroll_assignment_id UUID NULL
    REFERENCES accounts.payroll_assignments(id) ON DELETE RESTRICT,
  payroll_component_assignment_id UUID NULL
    REFERENCES accounts.payroll_component_assignments(id) ON DELETE RESTRICT,
  component_code_snapshot VARCHAR(40) NOT NULL,
  component_name_snapshot VARCHAR(200) NOT NULL,
  component_type VARCHAR(25) NOT NULL,
  calculation_method VARCHAR(25) NOT NULL,
  calculation_base_type VARCHAR(25) NULL
    CHECK (calculation_base_type IS NULL OR calculation_base_type IN (
      'NONE', 'CONTRACT_BASIC', 'GROSS_EARNINGS', 'SELECTED_COMPONENTS', 'COMPONENT_REFERENCE'
    )),
  quantity NUMERIC(18, 3) NULL,
  rate NUMERIC(18, 3) NULL,
  percentage NUMERIC(9, 4) NULL,
  base_amount NUMERIC(18, 3) NULL,
  calculated_amount NUMERIC(18, 3) NOT NULL DEFAULT 0,
  manual_override_amount NUMERIC(18, 3) NULL,
  quantity_source VARCHAR(20) NULL
    CHECK (quantity_source IS NULL OR quantity_source IN (
      'MANUAL', 'ASSIGNMENT', 'IMPORTED', 'ATTENDANCE', 'LECTURE_HOURS'
    )),
  source_effective_from DATE NOT NULL,
  source_effective_to DATE NULL,
  calculation_details_json JSONB NULL,
  line_source VARCHAR(20) NOT NULL DEFAULT 'GENERATED'
    CHECK (line_source IN ('GENERATED', 'MANUAL_OVERRIDE')),
  sequence INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- تطابق run_id مع صف الشخص (منع orphan دلالي)
  CONSTRAINT fk_run_line_person_run
    FOREIGN KEY (payroll_run_person_id, payroll_run_id)
    REFERENCES accounts.payroll_run_people (id, payroll_run_id)
    ON DELETE CASCADE,
  CONSTRAINT ck_run_line_version CHECK (version >= 1),
  CONSTRAINT ck_run_line_sequence CHECK (sequence >= 1),
  CONSTRAINT ck_run_line_quantity CHECK (quantity IS NULL OR quantity >= 0),
  CONSTRAINT ck_run_line_rate CHECK (rate IS NULL OR rate >= 0),
  CONSTRAINT ck_run_line_percentage CHECK (percentage IS NULL OR percentage >= 0),
  CONSTRAINT ck_run_line_base CHECK (base_amount IS NULL OR base_amount >= 0),
  CONSTRAINT ck_run_line_calc_amount CHECK (calculated_amount >= 0),
  CONSTRAINT ck_run_line_override CHECK (manual_override_amount IS NULL OR manual_override_amount >= 0),
  CONSTRAINT ck_run_line_effective CHECK (
    source_effective_to IS NULL OR source_effective_to >= source_effective_from
  ),
  CONSTRAINT ck_run_line_snapshots_nonempty CHECK (
    length(trim(component_code_snapshot)) > 0
    AND length(trim(component_name_snapshot)) > 0
    AND length(trim(component_type)) > 0
    AND length(trim(calculation_method)) > 0
  ),
  -- CUSTOM_FORMULA ممنوع في أسطر Snapshot (D14) — يُرفض على مستوى القاعدة أيضًا
  CONSTRAINT ck_run_line_no_custom_formula CHECK (calculation_method <> 'CUSTOM_FORMULA')
);

-- هوية المصدر الحقيقية: نفس المكوّن من تخصيصات/تكليفات مختلفة مسموح؛ التكرار لنفس المصدر ممنوع.
-- لا يدخل sequence في المفتاح حتى لا يخفي التكرار.
CREATE UNIQUE INDEX IF NOT EXISTS uq_run_line_source_identity
  ON accounts.payroll_run_lines (
    payroll_run_person_id,
    payroll_component_id,
    COALESCE(payroll_assignment_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(payroll_component_assignment_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS idx_run_lines_run
  ON accounts.payroll_run_lines (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_run_lines_person
  ON accounts.payroll_run_lines (payroll_run_person_id);
CREATE INDEX IF NOT EXISTS idx_run_lines_component
  ON accounts.payroll_run_lines (payroll_component_id);
CREATE INDEX IF NOT EXISTS idx_run_lines_sequence
  ON accounts.payroll_run_lines (payroll_run_person_id, sequence);

-- ─────────────────────────────────────────────────────────────
-- 3) payroll_run_issues — نتائج/تحذيرات مستقلة (D21)
-- ERROR ⇒ is_blocking = TRUE ؛ WARNING ⇒ is_blocking = FALSE
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts.payroll_run_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL
    REFERENCES accounts.payroll_runs(id) ON DELETE CASCADE,
  payroll_run_person_id UUID NULL,
  severity VARCHAR(10) NOT NULL
    CHECK (severity IN ('ERROR', 'WARNING')),
  issue_code VARCHAR(60) NOT NULL,
  message_ar TEXT NOT NULL,
  message_en TEXT NULL,
  entity_type VARCHAR(40) NULL,
  entity_id UUID NULL,
  details_json JSONB NULL,
  is_blocking BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  CONSTRAINT fk_run_issue_person_run
    FOREIGN KEY (payroll_run_person_id, payroll_run_id)
    REFERENCES accounts.payroll_run_people (id, payroll_run_id)
    ON DELETE CASCADE,
  CONSTRAINT ck_run_issue_blocking CHECK (
    (severity = 'ERROR' AND is_blocking = TRUE)
    OR (severity = 'WARNING' AND is_blocking = FALSE)
  ),
  CONSTRAINT ck_run_issue_code CHECK (issue_code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  CONSTRAINT ck_run_issue_message CHECK (length(trim(message_ar)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_run_issues_run
  ON accounts.payroll_run_issues (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_run_issues_person
  ON accounts.payroll_run_issues (payroll_run_person_id);
CREATE INDEX IF NOT EXISTS idx_run_issues_severity
  ON accounts.payroll_run_issues (payroll_run_id, severity);
CREATE INDEX IF NOT EXISTS idx_run_issues_blocking
  ON accounts.payroll_run_issues (payroll_run_id, is_blocking)
  WHERE is_blocking = TRUE;

COMMIT;
