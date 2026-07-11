-- Migration: 063 — جلسات الصناديق اليومية + جرد إغلاق مبسّط (المرحلة 3.B)
-- جداول: cash_box_sessions + cash_counts
-- بلا cash_count_lines (مؤجّل لـ 3.C مع فئات العملة)
-- بلا بيانات تشغيلية

BEGIN;

-- =========================
-- الجلسات اليومية
-- =========================
CREATE TABLE IF NOT EXISTS accounts.cash_box_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_box_id UUID NOT NULL
    REFERENCES accounts.cash_boxes(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  session_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  primary_custodian_user_id UUID NOT NULL
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  opened_by UUID NOT NULL
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opening_book_balance NUMERIC(18,3) NOT NULL,
  opening_last_posted_entry_id UUID
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  opening_last_posted_at TIMESTAMPTZ,
  closed_by UUID
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  closed_at TIMESTAMPTZ,
  final_book_balance NUMERIC(18,3),
  final_counted_amount NUMERIC(18,3),
  final_variance_amount NUMERIC(18,3),
  current_count_id UUID,
  closing_started_at TIMESTAMPTZ,
  closing_started_by UUID
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  cancel_closing_reason TEXT,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cash_box_sessions_status_check CHECK (
    status IN ('OPEN', 'CLOSING', 'CLOSED')
  ),
  CONSTRAINT cash_box_sessions_version_positive_check CHECK (version >= 1),
  CONSTRAINT cash_box_sessions_closed_fields_check CHECK (
    status <> 'CLOSED'
    OR (
      closed_at IS NOT NULL
      AND closed_by IS NOT NULL
      AND final_book_balance IS NOT NULL
      AND final_counted_amount IS NOT NULL
      AND final_variance_amount IS NOT NULL
    )
  )
);

-- جلسة حية واحدة فقط (OPEN أو CLOSING) لكل صندوق
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_box_sessions_one_live
  ON accounts.cash_box_sessions (cash_box_id)
  WHERE status IN ('OPEN', 'CLOSING');

-- جلسة واحدة لكل صندوق في نفس التاريخ
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_box_sessions_box_date
  ON accounts.cash_box_sessions (cash_box_id, session_date);

CREATE INDEX IF NOT EXISTS idx_cash_box_sessions_box_date
  ON accounts.cash_box_sessions (cash_box_id, session_date DESC);

CREATE INDEX IF NOT EXISTS idx_cash_box_sessions_status
  ON accounts.cash_box_sessions (status);

CREATE INDEX IF NOT EXISTS idx_cash_box_sessions_fiscal
  ON accounts.cash_box_sessions (fiscal_year_id, fiscal_period_id);

CREATE INDEX IF NOT EXISTS idx_cash_box_sessions_updated_at
  ON accounts.cash_box_sessions (updated_at DESC);

COMMENT ON TABLE accounts.cash_box_sessions IS
  'جلسات الصندوق اليومية — OPEN/CLOSING/CLOSED؛ الرصيد الافتتاحي لقطة دفترية عند الفتح';
COMMENT ON COLUMN accounts.cash_box_sessions.opening_book_balance IS
  'لقطة رصيد دفتري من قيود POSTED عند الفتح — لا تُقبل من العميل';
COMMENT ON COLUMN accounts.cash_box_sessions.opening_last_posted_entry_id IS
  'آخر قيد POSTED مؤثر على حساب الصندوق وقت الفتح (للتدقيق)';

-- =========================
-- سجلات الجرد (محاولات متتابعة)
-- =========================
CREATE TABLE IF NOT EXISTS accounts.cash_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL
    REFERENCES accounts.cash_box_sessions(id) ON DELETE RESTRICT,
  cash_box_id UUID NOT NULL
    REFERENCES accounts.cash_boxes(id) ON DELETE RESTRICT,
  sequence_no INTEGER NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  counted_amount NUMERIC(18,3) NOT NULL,
  book_balance_at_count NUMERIC(18,3) NOT NULL,
  variance_amount NUMERIC(18,3) NOT NULL,
  counted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  counted_by UUID NOT NULL
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  last_posted_entry_id_at_count UUID
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  last_posted_entry_at_count TIMESTAMPTZ,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cash_counts_sequence_positive_check CHECK (sequence_no >= 1),
  CONSTRAINT cash_counts_version_positive_check CHECK (version >= 1),
  CONSTRAINT cash_counts_counted_amount_nonneg_check CHECK (counted_amount >= 0)
);

-- جرد حالي واحد لكل جلسة
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_counts_one_current_per_session
  ON accounts.cash_counts (session_id)
  WHERE is_current = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_counts_session_sequence
  ON accounts.cash_counts (session_id, sequence_no);

CREATE INDEX IF NOT EXISTS idx_cash_counts_session
  ON accounts.cash_counts (session_id, sequence_no DESC);

CREATE INDEX IF NOT EXISTS idx_cash_counts_box
  ON accounts.cash_counts (cash_box_id);

COMMENT ON TABLE accounts.cash_counts IS
  'محاولات جرد الجلسة — سجل جديد لكل محاولة؛ is_current يحدد الفعّال';
COMMENT ON COLUMN accounts.cash_counts.book_balance_at_count IS
  'لقطة الرصيد الدفتري عند تسجيل الجرد';
COMMENT ON COLUMN accounts.cash_counts.last_posted_entry_id_at_count IS
  'آخر قيد POSTED على حساب الصندوق وقت اللقطة — للتحقق عند الإغلاق';

-- ربط الجلسة بالجرد الحالي (بعد إنشاء الجدول)
ALTER TABLE accounts.cash_box_sessions
  DROP CONSTRAINT IF EXISTS cash_box_sessions_current_count_fk;

ALTER TABLE accounts.cash_box_sessions
  ADD CONSTRAINT cash_box_sessions_current_count_fk
  FOREIGN KEY (current_count_id)
  REFERENCES accounts.cash_counts(id) ON DELETE RESTRICT;

COMMIT;
