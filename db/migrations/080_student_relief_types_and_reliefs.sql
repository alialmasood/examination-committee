-- 080: أنواع التخفيضات وطلبات Student Relief — 5.C.1
BEGIN;

INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES
  ('STUDENT_RELIEF', 'تخفيض/منحة/إعفاء طالب', 'SRL', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  prefix_default = EXCLUDED.prefix_default,
  is_active = TRUE;

INSERT INTO accounts.document_sequences
  (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
SELECT 'STUDENT_RELIEF', fy.id, 'SRL', 0, 6, TRUE, TRUE
FROM accounts.fiscal_years fy
WHERE NOT EXISTS (
  SELECT 1 FROM accounts.document_sequences ds
  WHERE ds.document_type = 'STUDENT_RELIEF' AND ds.fiscal_year_id = fy.id
);

-- أدوار الاعتماد الرسمية
INSERT INTO student_affairs.roles (code, name_ar, name_en)
VALUES
  ('accounts_approver', 'معتمد الحسابات', 'Accounts Approver')
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name_en = EXCLUDED.name_en;

CREATE TABLE IF NOT EXISTS accounts.student_relief_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NULL,
  relief_kind VARCHAR(20) NOT NULL
    CHECK (relief_kind IN ('DISCOUNT', 'SCHOLARSHIP', 'WAIVER')),
  calculation_type VARCHAR(20) NOT NULL
    CHECK (calculation_type IN ('FIXED_AMOUNT', 'PERCENTAGE')),
  default_value NUMERIC(18, 3) NULL CHECK (default_value IS NULL OR default_value >= 0),
  max_value NUMERIC(18, 3) NULL CHECK (max_value IS NULL OR max_value >= 0),
  gl_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  is_refundable BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT NULL,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_student_relief_types_code UNIQUE (code),
  CONSTRAINT chk_student_relief_types_not_refundable_5c1 CHECK (is_refundable = FALSE)
);

CREATE INDEX IF NOT EXISTS idx_srt_active ON accounts.student_relief_types (is_active);
CREATE INDEX IF NOT EXISTS idx_srt_kind ON accounts.student_relief_types (relief_kind);
CREATE INDEX IF NOT EXISTS idx_srt_gl ON accounts.student_relief_types (gl_account_id);

CREATE TABLE IF NOT EXISTS accounts.student_reliefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relief_number VARCHAR(40) NOT NULL,
  student_account_id UUID NOT NULL
    REFERENCES accounts.student_accounts(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL
    REFERENCES student_affairs.students(id) ON DELETE RESTRICT,
  relief_type_id UUID NOT NULL
    REFERENCES accounts.student_relief_types(id) ON DELETE RESTRICT,
  billing_plan_id UUID NULL
    REFERENCES accounts.student_billing_plans(id) ON DELETE RESTRICT,
  student_installment_id UUID NULL
    REFERENCES accounts.student_installments(id) ON DELETE RESTRICT,
  student_charge_id UUID NOT NULL
    REFERENCES accounts.student_charges(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  relief_date DATE NOT NULL,
  calculation_type VARCHAR(20) NOT NULL
    CHECK (calculation_type IN ('FIXED_AMOUNT', 'PERCENTAGE')),
  percentage_value NUMERIC(8, 4) NULL
    CHECK (percentage_value IS NULL OR (percentage_value > 0 AND percentage_value <= 100)),
  requested_amount NUMERIC(18, 3) NOT NULL CHECK (requested_amount > 0),
  approved_amount NUMERIC(18, 3) NULL CHECK (approved_amount IS NULL OR approved_amount > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
  reason TEXT NOT NULL,
  external_reference VARCHAR(100) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED', 'VOID'
    )),
  journal_entry_id UUID NULL
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  reversal_journal_entry_id UUID NULL
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  approved_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ NULL,
  rejected_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ NULL,
  rejection_reason TEXT NULL,
  posted_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ NULL,
  voided_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ NULL,
  void_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_student_reliefs_number UNIQUE (relief_number),
  CONSTRAINT uq_student_reliefs_journal UNIQUE (journal_entry_id),
  CONSTRAINT chk_student_reliefs_pct_req CHECK (
    (calculation_type = 'FIXED_AMOUNT' AND percentage_value IS NULL)
    OR (calculation_type = 'PERCENTAGE' AND percentage_value IS NOT NULL)
  ),
  CONSTRAINT chk_student_reliefs_approved_le_requested CHECK (
    approved_amount IS NULL OR approved_amount <= requested_amount
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_reliefs_ext_ref
  ON accounts.student_reliefs (external_reference)
  WHERE external_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sr_account_status
  ON accounts.student_reliefs (student_account_id, status);
CREATE INDEX IF NOT EXISTS idx_sr_charge_status
  ON accounts.student_reliefs (student_charge_id, status);
CREATE INDEX IF NOT EXISTS idx_sr_date ON accounts.student_reliefs (relief_date DESC);
CREATE INDEX IF NOT EXISTS idx_sr_type ON accounts.student_reliefs (relief_type_id);
CREATE INDEX IF NOT EXISTS idx_sr_status_created
  ON accounts.student_reliefs (status, created_at DESC);

COMMENT ON TABLE accounts.student_relief_types IS
  '5.C.1 Relief types — GL must be EXPENSE posting account (no CONTRA_REVENUE in engine)';
COMMENT ON TABLE accounts.student_reliefs IS
  '5.C.1 Student relief requests linked 1:1 to a student_charge';

COMMIT;
