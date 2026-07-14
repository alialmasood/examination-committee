-- 078: تحصيلات الطلبة والتخصيصات + توسيع Student Ledger — 5.B
BEGIN;

INSERT INTO accounts.document_sequence_types (code, name_ar, prefix_default, is_active)
VALUES
  ('STUDENT_COLLECTION', 'تحصيل من طالب', 'SCL', TRUE)
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  prefix_default = EXCLUDED.prefix_default,
  is_active = TRUE;

INSERT INTO accounts.document_sequences
  (document_type, fiscal_year_id, prefix, current_number, padding_length, reset_yearly, is_active)
SELECT 'STUDENT_COLLECTION', fy.id, 'SCL', 0, 6, TRUE, TRUE
FROM accounts.fiscal_years fy
WHERE NOT EXISTS (
  SELECT 1 FROM accounts.document_sequences ds
  WHERE ds.document_type = 'STUDENT_COLLECTION' AND ds.fiscal_year_id = fy.id
);

-- توسيع أنواع دفتر الطالب للتحصيل
ALTER TABLE accounts.student_ledger_entries
  DROP CONSTRAINT IF EXISTS student_ledger_entries_entry_type_check;

ALTER TABLE accounts.student_ledger_entries
  ADD CONSTRAINT student_ledger_entries_entry_type_check CHECK (
    entry_type IN (
      'CHARGE',
      'CHARGE_REVERSAL',
      'COLLECTION',
      'COLLECTION_REVERSAL',
      'OPENING_REFERENCE',
      'ADJUSTMENT'
    )
  );

CREATE TABLE IF NOT EXISTS accounts.student_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_number VARCHAR(40) NOT NULL,
  student_account_id UUID NOT NULL
    REFERENCES accounts.student_accounts(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL
    REFERENCES student_affairs.students(id) ON DELETE RESTRICT,
  collection_date DATE NOT NULL,
  amount NUMERIC(18, 3) NOT NULL CHECK (amount > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'IQD',
  payment_method VARCHAR(10) NOT NULL
    CHECK (payment_method IN ('CASH', 'BANK')),
  cash_box_id UUID NULL
    REFERENCES accounts.cash_boxes(id) ON DELETE RESTRICT,
  cash_box_session_id UUID NULL
    REFERENCES accounts.cash_box_sessions(id) ON DELETE RESTRICT,
  bank_account_id UUID NULL
    REFERENCES accounts.bank_accounts(id) ON DELETE RESTRICT,
  cash_voucher_id UUID NULL
    REFERENCES accounts.cash_vouchers(id) ON DELETE RESTRICT,
  bank_voucher_id UUID NULL
    REFERENCES accounts.bank_vouchers(id) ON DELETE RESTRICT,
  external_reference VARCHAR(100) NULL,
  payer_name VARCHAR(200) NULL,
  description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'POSTED', 'VOID')),
  fiscal_year_id UUID NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  posted_at TIMESTAMPTZ NULL,
  posted_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ NULL,
  voided_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  void_reason TEXT NULL,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_student_collections_number UNIQUE (collection_number),
  CONSTRAINT uq_student_collections_cash_voucher UNIQUE (cash_voucher_id),
  CONSTRAINT uq_student_collections_bank_voucher UNIQUE (bank_voucher_id),
  CONSTRAINT chk_student_collections_method_refs CHECK (
    (payment_method = 'CASH' AND cash_box_id IS NOT NULL AND cash_box_session_id IS NOT NULL AND bank_account_id IS NULL)
    OR (payment_method = 'BANK' AND bank_account_id IS NOT NULL AND cash_box_id IS NULL AND cash_box_session_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_collections_ext_ref
  ON accounts.student_collections (external_reference)
  WHERE external_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scoll_account_date
  ON accounts.student_collections (student_account_id, collection_date DESC);
CREATE INDEX IF NOT EXISTS idx_scoll_student_status
  ON accounts.student_collections (student_id, status);
CREATE INDEX IF NOT EXISTS idx_scoll_status_date
  ON accounts.student_collections (status, collection_date DESC);

CREATE TABLE IF NOT EXISTS accounts.student_collection_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL
    REFERENCES accounts.student_collections(id) ON DELETE RESTRICT,
  student_installment_id UUID NULL
    REFERENCES accounts.student_installments(id) ON DELETE RESTRICT,
  student_charge_id UUID NOT NULL
    REFERENCES accounts.student_charges(id) ON DELETE RESTRICT,
  allocated_amount NUMERIC(18, 3) NOT NULL CHECK (allocated_amount > 0),
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sca_collection_charge UNIQUE (collection_id, student_charge_id)
);

CREATE INDEX IF NOT EXISTS idx_sca_collection
  ON accounts.student_collection_allocations (collection_id);
CREATE INDEX IF NOT EXISTS idx_sca_charge
  ON accounts.student_collection_allocations (student_charge_id);
CREATE INDEX IF NOT EXISTS idx_sca_installment
  ON accounts.student_collection_allocations (student_installment_id)
  WHERE student_installment_id IS NOT NULL;

COMMENT ON TABLE accounts.student_collections IS
  '5.B Student Collections — GL via cash/bank receipt voucher only (no duplicate JE)';
COMMENT ON TABLE accounts.student_collection_allocations IS
  '5.B Allocations: collection amount fully allocated before POST';

COMMIT;
