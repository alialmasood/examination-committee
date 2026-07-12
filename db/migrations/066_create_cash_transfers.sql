-- Migration: 066 — التحويلات النقدية بين الصناديق (المرحلة 3.E)
-- Cash in Transit + accounts.cash_transfers
-- لا يعدّل 062–065

BEGIN;

-- مفتاح إعداد حساب النقد بالطريق (قيمة UUID اختيارية عبر التطبيق/الـ seed)
INSERT INTO platform.system_settings
  (setting_key, setting_value, value_type, description)
SELECT
  'cash_in_transit_account_id',
  '',
  'uuid',
  'حساب النقد بالطريق (Cash in Transit) لتحويلات الصناديق'
WHERE NOT EXISTS (
  SELECT 1 FROM platform.system_settings
  WHERE LOWER(setting_key) = LOWER('cash_in_transit_account_id')
);

CREATE TABLE IF NOT EXISTS accounts.cash_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  source_cash_box_id UUID NOT NULL
    REFERENCES accounts.cash_boxes(id) ON DELETE RESTRICT,
  source_session_id UUID NOT NULL
    REFERENCES accounts.cash_box_sessions(id) ON DELETE RESTRICT,
  destination_cash_box_id UUID NOT NULL
    REFERENCES accounts.cash_boxes(id) ON DELETE RESTRICT,
  destination_session_id UUID
    REFERENCES accounts.cash_box_sessions(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  dispatch_period_id UUID
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  receipt_period_id UUID
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  transfer_date DATE NOT NULL,
  amount NUMERIC(18,3) NOT NULL,
  currency_code VARCHAR(10) NOT NULL DEFAULT 'IQD',
  description TEXT NOT NULL,
  external_reference VARCHAR(100),
  dispatch_journal_entry_id UUID
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  receipt_journal_entry_id UUID
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  reversal_journal_entry_id UUID
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  dispatched_at TIMESTAMPTZ,
  dispatched_by UUID
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  received_at TIMESTAMPTZ,
  received_by UUID
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  cancellation_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cash_transfers_status_check CHECK (
    status IN ('DRAFT', 'DISPATCHED', 'RECEIVED', 'CANCELLED')
  ),
  CONSTRAINT cash_transfers_amount_positive_check CHECK (amount > 0),
  CONSTRAINT cash_transfers_boxes_distinct_check CHECK (
    source_cash_box_id <> destination_cash_box_id
  ),
  CONSTRAINT cash_transfers_currency_not_blank_check CHECK (
    length(trim(currency_code)) > 0
  ),
  CONSTRAINT cash_transfers_description_not_blank_check CHECK (
    length(trim(description)) > 0
  ),
  CONSTRAINT cash_transfers_version_positive_check CHECK (version >= 1),
  CONSTRAINT cash_transfers_dispatched_integrity_check CHECK (
    status NOT IN ('DISPATCHED', 'RECEIVED')
    OR (
      dispatch_journal_entry_id IS NOT NULL
      AND dispatch_period_id IS NOT NULL
      AND dispatched_by IS NOT NULL
      AND dispatched_at IS NOT NULL
    )
  ),
  CONSTRAINT cash_transfers_received_integrity_check CHECK (
    status <> 'RECEIVED'
    OR (
      receipt_journal_entry_id IS NOT NULL
      AND receipt_period_id IS NOT NULL
      AND destination_session_id IS NOT NULL
      AND received_by IS NOT NULL
      AND received_at IS NOT NULL
    )
  ),
  CONSTRAINT cash_transfers_cancelled_integrity_check CHECK (
    status <> 'CANCELLED'
    OR (
      cancelled_by IS NOT NULL
      AND cancelled_at IS NOT NULL
      AND cancellation_reason IS NOT NULL
      AND length(trim(cancellation_reason)) > 0
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_transfers_year_number
  ON accounts.cash_transfers (fiscal_year_id, transfer_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_transfers_dispatch_je
  ON accounts.cash_transfers (dispatch_journal_entry_id)
  WHERE dispatch_journal_entry_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_transfers_receipt_je
  ON accounts.cash_transfers (receipt_journal_entry_id)
  WHERE receipt_journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_transfers_status
  ON accounts.cash_transfers (status);

CREATE INDEX IF NOT EXISTS idx_cash_transfers_source_box
  ON accounts.cash_transfers (source_cash_box_id);

CREATE INDEX IF NOT EXISTS idx_cash_transfers_dest_box
  ON accounts.cash_transfers (destination_cash_box_id);

CREATE INDEX IF NOT EXISTS idx_cash_transfers_source_session
  ON accounts.cash_transfers (source_session_id);

CREATE INDEX IF NOT EXISTS idx_cash_transfers_dest_session
  ON accounts.cash_transfers (destination_session_id);

CREATE INDEX IF NOT EXISTS idx_cash_transfers_date
  ON accounts.cash_transfers (transfer_date DESC);

CREATE INDEX IF NOT EXISTS idx_cash_transfers_created_at
  ON accounts.cash_transfers (created_at DESC);

COMMENT ON TABLE accounts.cash_transfers IS
  'تحويلات نقدية بين الصناديق — DISPATCH: CIT/Source · RECEIVE: Dest/CIT';
COMMENT ON COLUMN accounts.cash_transfers.status IS
  'DRAFT | DISPATCHED | RECEIVED | CANCELLED';

COMMIT;
