-- Migration: 067 — تأسيس الحسابات المصرفية (المرحلة 4.A)
-- banks / bank_branches / bank_accounts / bank_account_users
-- لا يعدّل 062–066

BEGIN;

-- =========================
-- المصارف
-- =========================
CREATE TABLE IF NOT EXISTS accounts.banks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200),
  short_name VARCHAR(100),
  swift_code VARCHAR(20),
  country_code VARCHAR(2),
  phone VARCHAR(40),
  email VARCHAR(200),
  website VARCHAR(300),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT banks_code_not_blank_check CHECK (length(trim(code)) > 0),
  CONSTRAINT banks_name_ar_not_blank_check CHECK (length(trim(name_ar)) > 0),
  CONSTRAINT banks_version_positive_check CHECK (version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_banks_code_lower
  ON accounts.banks (LOWER(code));

CREATE INDEX IF NOT EXISTS idx_banks_is_active ON accounts.banks (is_active);
CREATE INDEX IF NOT EXISTS idx_banks_name_ar ON accounts.banks (name_ar);

COMMENT ON TABLE accounts.banks IS 'المصارف — مرجع إداري للحسابات المصرفية (المرحلة 4.A)';

-- =========================
-- فروع المصارف
-- =========================
CREATE TABLE IF NOT EXISTS accounts.bank_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NOT NULL REFERENCES accounts.banks(id) ON DELETE RESTRICT,
  code VARCHAR(50) NOT NULL,
  name_ar VARCHAR(200) NOT NULL,
  name_en VARCHAR(200),
  city VARCHAR(120),
  address TEXT,
  phone VARCHAR(40),
  branch_swift_code VARCHAR(20),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_branches_code_not_blank_check CHECK (length(trim(code)) > 0),
  CONSTRAINT bank_branches_name_ar_not_blank_check CHECK (length(trim(name_ar)) > 0),
  CONSTRAINT bank_branches_version_positive_check CHECK (version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_branches_bank_code_lower
  ON accounts.bank_branches (bank_id, LOWER(code));

CREATE INDEX IF NOT EXISTS idx_bank_branches_bank ON accounts.bank_branches (bank_id);
CREATE INDEX IF NOT EXISTS idx_bank_branches_is_active ON accounts.bank_branches (is_active);

COMMENT ON TABLE accounts.bank_branches IS 'فروع المصارف';

-- =========================
-- الحسابات المصرفية
-- =========================
CREATE TABLE IF NOT EXISTS accounts.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL,
  bank_id UUID NOT NULL REFERENCES accounts.banks(id) ON DELETE RESTRICT,
  bank_branch_id UUID REFERENCES accounts.bank_branches(id) ON DELETE RESTRICT,
  account_name_ar VARCHAR(200) NOT NULL,
  account_name_en VARCHAR(200),
  account_number VARCHAR(80) NOT NULL,
  account_number_normalized VARCHAR(80) NOT NULL,
  iban VARCHAR(50),
  iban_normalized VARCHAR(50),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'IQD',
  gl_account_id UUID NOT NULL REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  account_type VARCHAR(20) NOT NULL DEFAULT 'CURRENT',
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  opening_balance_reference NUMERIC(18,3),
  opening_balance_date DATE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  allows_receipts BOOLEAN NOT NULL DEFAULT TRUE,
  allows_payments BOOLEAN NOT NULL DEFAULT TRUE,
  allows_transfers BOOLEAN NOT NULL DEFAULT TRUE,
  allows_cheques BOOLEAN NOT NULL DEFAULT FALSE,
  cheque_book_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  suspended_at TIMESTAMPTZ,
  suspended_by UUID REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_accounts_code_not_blank_check CHECK (length(trim(code)) > 0),
  CONSTRAINT bank_accounts_name_ar_not_blank_check CHECK (length(trim(account_name_ar)) > 0),
  CONSTRAINT bank_accounts_number_not_blank_check CHECK (length(trim(account_number)) > 0),
  CONSTRAINT bank_accounts_currency_len_check CHECK (char_length(currency_code) = 3),
  CONSTRAINT bank_accounts_type_check CHECK (
    account_type IN ('CURRENT', 'SAVINGS', 'DEPOSIT', 'ESCROW', 'OTHER')
  ),
  CONSTRAINT bank_accounts_status_check CHECK (
    status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')
  ),
  CONSTRAINT bank_accounts_version_positive_check CHECK (version >= 1),
  CONSTRAINT bank_accounts_cheque_book_implies_cheques_check CHECK (
    cheque_book_enabled = FALSE OR allows_cheques = TRUE
  ),
  CONSTRAINT bank_accounts_closed_integrity_check CHECK (
    status <> 'CLOSED'
    OR (closed_at IS NOT NULL AND closed_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_code_lower
  ON accounts.bank_accounts (LOWER(code));

-- GL واحد لواحد
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_gl_account
  ON accounts.bank_accounts (gl_account_id);

-- رقم الحساب فريد داخل المصرف (بعد التطبيع)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_bank_number_norm
  ON accounts.bank_accounts (bank_id, account_number_normalized);

-- IBAN فريد عالمياً إن وُجد
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_iban_norm
  ON accounts.bank_accounts (iban_normalized)
  WHERE iban_normalized IS NOT NULL;

-- حساب أساسي واحد لكل عملة بين الحسابات غير المغلقة
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_primary_per_currency
  ON accounts.bank_accounts (currency_code)
  WHERE is_primary = TRUE AND status <> 'CLOSED';

CREATE INDEX IF NOT EXISTS idx_bank_accounts_bank ON accounts.bank_accounts (bank_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_branch ON accounts.bank_accounts (bank_branch_id);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_status ON accounts.bank_accounts (status);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_currency ON accounts.bank_accounts (currency_code);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_type ON accounts.bank_accounts (account_type);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_created_at ON accounts.bank_accounts (created_at DESC);

COMMENT ON TABLE accounts.bank_accounts IS
  'حسابات الكلية المصرفية — مرتبط بـ GL واحد (4.A)';
COMMENT ON COLUMN accounts.bank_accounts.opening_balance_reference IS
  'رصيد مرجعي للعرض فقط — ليس قيداً محاسبياً';

-- =========================
-- مستخدمو الحساب البنكي
-- =========================
CREATE TABLE IF NOT EXISTS accounts.bank_account_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID NOT NULL REFERENCES accounts.bank_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  can_view BOOLEAN NOT NULL DEFAULT TRUE,
  can_prepare BOOLEAN NOT NULL DEFAULT FALSE,
  can_post BOOLEAN NOT NULL DEFAULT FALSE,
  can_approve BOOLEAN NOT NULL DEFAULT FALSE,
  can_reconcile BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_account_users_any_permission_check CHECK (
    can_view OR can_prepare OR can_post OR can_approve OR can_reconcile
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_account_users_pair
  ON accounts.bank_account_users (bank_account_id, user_id);

CREATE INDEX IF NOT EXISTS idx_bank_account_users_user
  ON accounts.bank_account_users (user_id);

COMMENT ON TABLE accounts.bank_account_users IS
  'مستخدمون مخولون على الحساب البنكي — تمهيد للمراحل اللاحقة';

COMMIT;
