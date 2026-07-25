-- 101: سنة القسط لكل وصل تسديد (عزل حسابات السنوات)
BEGIN;

ALTER TABLE accounts.student_settlement_receipts
  ADD COLUMN IF NOT EXISTS fee_year SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE accounts.student_settlement_receipts
  DROP CONSTRAINT IF EXISTS chk_student_settlement_receipts_fee_year;

ALTER TABLE accounts.student_settlement_receipts
  ADD CONSTRAINT chk_student_settlement_receipts_fee_year
  CHECK (fee_year BETWEEN 1 AND 4);

CREATE INDEX IF NOT EXISTS idx_student_settlement_receipts_fee_year
  ON accounts.student_settlement_receipts (student_id, fee_year, settlement_date DESC);

COMMIT;
