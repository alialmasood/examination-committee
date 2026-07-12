-- Migration: 064 — تسوية فروقات الجرد (المرحلة 3.C)
-- كيان مستقل: accounts.cash_count_adjustments
-- لا يعدّل 062/063 أو جداول cash_counts / cash_box_sessions بحقول محاسبية
-- بلا بيانات تشغيلية

BEGIN;

CREATE TABLE IF NOT EXISTS accounts.cash_count_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_count_id UUID NOT NULL
    REFERENCES accounts.cash_counts(id) ON DELETE RESTRICT,
  cash_box_session_id UUID NOT NULL
    REFERENCES accounts.cash_box_sessions(id) ON DELETE RESTRICT,
  cash_box_id UUID NOT NULL
    REFERENCES accounts.cash_boxes(id) ON DELETE RESTRICT,
  direction VARCHAR(10) NOT NULL,
  variance_amount NUMERIC(18,3) NOT NULL,
  original_signed_variance NUMERIC(18,3) NOT NULL,
  cash_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  variance_account_id UUID NOT NULL
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  gain_account_id UUID
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  loss_account_id UUID
    REFERENCES accounts.chart_of_accounts(id) ON DELETE RESTRICT,
  journal_entry_id UUID
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'POSTED',
  created_by UUID NOT NULL
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  posted_by UUID
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  CONSTRAINT cash_count_adjustments_direction_check CHECK (
    direction IN ('GAIN', 'LOSS')
  ),
  CONSTRAINT cash_count_adjustments_status_check CHECK (
    status IN ('CREATED', 'POSTED')
  ),
  CONSTRAINT cash_count_adjustments_variance_positive_check CHECK (
    variance_amount > 0
  ),
  CONSTRAINT cash_count_adjustments_version_positive_check CHECK (version >= 1),
  CONSTRAINT cash_count_adjustments_direction_accounts_check CHECK (
    (
      direction = 'GAIN'
      AND gain_account_id IS NOT NULL
      AND loss_account_id IS NULL
      AND variance_account_id = gain_account_id
    )
    OR (
      direction = 'LOSS'
      AND loss_account_id IS NOT NULL
      AND gain_account_id IS NULL
      AND variance_account_id = loss_account_id
    )
  ),
  CONSTRAINT cash_count_adjustments_posted_integrity_check CHECK (
    status <> 'POSTED'
    OR (
      journal_entry_id IS NOT NULL
      AND posted_by IS NOT NULL
      AND posted_at IS NOT NULL
    )
  ),
  CONSTRAINT cash_count_adjustments_signed_matches_direction_check CHECK (
    (direction = 'GAIN' AND original_signed_variance > 0)
    OR (direction = 'LOSS' AND original_signed_variance < 0)
  )
);

-- تسوية واحدة فقط لكل جرد
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_count_adjustments_one_per_count
  ON accounts.cash_count_adjustments (cash_count_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_count_adjustments_journal
  ON accounts.cash_count_adjustments (journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_count_adjustments_session
  ON accounts.cash_count_adjustments (cash_box_session_id);

CREATE INDEX IF NOT EXISTS idx_cash_count_adjustments_box
  ON accounts.cash_count_adjustments (cash_box_id);

CREATE INDEX IF NOT EXISTS idx_cash_count_adjustments_status
  ON accounts.cash_count_adjustments (status);

CREATE INDEX IF NOT EXISTS idx_cash_count_adjustments_created_at
  ON accounts.cash_count_adjustments (created_at DESC);

COMMENT ON TABLE accounts.cash_count_adjustments IS
  'تسوية فرق الجرد — كيان محاسبي مستقل عن الجرد التشغيلي؛ القيد source_type=CASH_COUNT_VARIANCE وsource_id=هذا الصف';
COMMENT ON COLUMN accounts.cash_count_adjustments.variance_amount IS
  'القيمة المطلقة للفرق';
COMMENT ON COLUMN accounts.cash_count_adjustments.original_signed_variance IS
  'الفرق بإشارته من الجرد (معدود − دفتري)';
COMMENT ON COLUMN accounts.cash_count_adjustments.variance_account_id IS
  'حساب الفرق المستخدم فعلياً (زيادة أو عجز) — لقطة وقت التسوية';

COMMIT;
