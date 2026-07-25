-- 100: وصولات تسديد أقساط الطلبة (رسمية من مودال التسديد)
BEGIN;

CREATE TABLE IF NOT EXISTS accounts.student_settlement_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number VARCHAR(40) NOT NULL UNIQUE,
  student_id UUID NOT NULL
    REFERENCES student_affairs.students(id) ON DELETE RESTRICT,
  university_id VARCHAR(64),
  student_name TEXT,
  department TEXT,
  study_type VARCHAR(32),
  admission_type VARCHAR(32),
  settlement_date DATE NOT NULL,
  annual_fee NUMERIC(18, 2) NOT NULL DEFAULT 0,
  four_years_total NUMERIC(18, 2) NOT NULL DEFAULT 0,
  discount_mode VARCHAR(16) NOT NULL DEFAULT 'none'
    CHECK (discount_mode IN ('none', 'amount', 'percent')),
  discount_years SMALLINT NOT NULL DEFAULT 1
    CHECK (discount_years BETWEEN 1 AND 4),
  discount_base NUMERIC(18, 2) NOT NULL DEFAULT 0,
  discount_input NUMERIC(18, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  after_discount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  pay_amount NUMERIC(18, 2) NOT NULL CHECK (pay_amount > 0),
  remaining_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  periods SMALLINT NOT NULL DEFAULT 1
    CHECK (periods BETWEEN 1 AND 10),
  per_period_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL
);

CREATE INDEX IF NOT EXISTS idx_student_settlement_receipts_student
  ON accounts.student_settlement_receipts (student_id, settlement_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_settlement_receipts_date
  ON accounts.student_settlement_receipts (settlement_date DESC);

COMMIT;
