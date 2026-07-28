-- مكافئات الرواتب اليدوية المرتبطة بأشخاص الكوادر
CREATE TABLE IF NOT EXISTS accounts.payroll_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_code VARCHAR(40) NOT NULL,
  payroll_person_id UUID NOT NULL
    REFERENCES accounts.payroll_people(id) ON DELETE RESTRICT,
  details VARCHAR(2000) NOT NULL,
  paid_on DATE NOT NULL,
  amount NUMERIC(18, 3) NOT NULL CHECK (amount >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_rewards_code UNIQUE (reward_code)
);

CREATE INDEX IF NOT EXISTS idx_payroll_rewards_person
  ON accounts.payroll_rewards (payroll_person_id);

CREATE INDEX IF NOT EXISTS idx_payroll_rewards_paid_on
  ON accounts.payroll_rewards (paid_on DESC);
