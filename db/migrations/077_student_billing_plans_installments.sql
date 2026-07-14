-- 077: خطط الرسوم والأقساط (Student Billing Plans & Installments) — 5.B
BEGIN;

INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES
  ('STUDENT_BILLING_PLAN', 'خطة رسوم طالب', 'SBP', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  prefix_default = EXCLUDED.prefix_default,
  is_active = TRUE;

INSERT INTO accounts.document_sequences
  (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
SELECT 'STUDENT_BILLING_PLAN', fy.id, 'SBP', 0, 6, TRUE, TRUE
FROM accounts.fiscal_years fy
WHERE NOT EXISTS (
  SELECT 1 FROM accounts.document_sequences ds
  WHERE ds.document_type = 'STUDENT_BILLING_PLAN' AND ds.fiscal_year_id = fy.id
);

CREATE TABLE IF NOT EXISTS accounts.student_billing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_number VARCHAR(40) NOT NULL,
  student_account_id UUID NOT NULL
    REFERENCES accounts.student_accounts(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL
    REFERENCES student_affairs.students(id) ON DELETE RESTRICT,
  fee_type_id UUID NOT NULL
    REFERENCES accounts.student_fee_types(id) ON DELETE RESTRICT,
  academic_year_id UUID NULL,
  academic_year VARCHAR(20) NULL,
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
  total_amount NUMERIC(18, 3) NOT NULL CHECK (total_amount > 0),
  installment_count INTEGER NOT NULL CHECK (installment_count > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  description TEXT NOT NULL,
  external_reference VARCHAR(100) NULL,
  activated_at TIMESTAMPTZ NULL,
  activated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  cancellation_reason TEXT NULL,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_student_billing_plans_number UNIQUE (plan_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_billing_plans_ext_ref
  ON accounts.student_billing_plans (external_reference)
  WHERE external_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sbp_student_account
  ON accounts.student_billing_plans (student_account_id, status);
CREATE INDEX IF NOT EXISTS idx_sbp_student
  ON accounts.student_billing_plans (student_id, status);
CREATE INDEX IF NOT EXISTS idx_sbp_status_created
  ON accounts.student_billing_plans (status, created_at DESC);

CREATE TABLE IF NOT EXISTS accounts.student_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_plan_id UUID NOT NULL
    REFERENCES accounts.student_billing_plans(id) ON DELETE RESTRICT,
  student_account_id UUID NOT NULL
    REFERENCES accounts.student_accounts(id) ON DELETE RESTRICT,
  installment_number INTEGER NOT NULL CHECK (installment_number > 0),
  due_date DATE NOT NULL,
  amount NUMERIC(18, 3) NOT NULL CHECK (amount > 0),
  paid_amount NUMERIC(18, 3) NOT NULL DEFAULT 0
    CHECK (paid_amount >= 0),
  outstanding_amount NUMERIC(18, 3) NOT NULL
    CHECK (outstanding_amount >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')),
  student_charge_id UUID NULL
    REFERENCES accounts.student_charges(id) ON DELETE RESTRICT,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_student_installments_plan_number
    UNIQUE (billing_plan_id, installment_number),
  CONSTRAINT uq_student_installments_charge
    UNIQUE (student_charge_id),
  CONSTRAINT chk_student_installments_paid_le_amount
    CHECK (paid_amount <= amount),
  CONSTRAINT chk_student_installments_outstanding_eq
    CHECK (outstanding_amount = amount - paid_amount)
);

CREATE INDEX IF NOT EXISTS idx_si_account_due
  ON accounts.student_installments (student_account_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_si_plan
  ON accounts.student_installments (billing_plan_id, installment_number);
CREATE INDEX IF NOT EXISTS idx_si_charge
  ON accounts.student_installments (student_charge_id)
  WHERE student_charge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_si_status_due
  ON accounts.student_installments (status, due_date);

COMMENT ON TABLE accounts.student_billing_plans IS
  '5.B Student Billing Plan — قسط واحد = مطالبة واحدة عند التفعيل';
COMMENT ON TABLE accounts.student_installments IS
  '5.B Installments linked 1:1 to student_charges after plan activation';

COMMIT;
