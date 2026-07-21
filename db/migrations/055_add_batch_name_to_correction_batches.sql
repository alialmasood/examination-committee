ALTER TABLE examination_committee.correction_batches
ADD COLUMN IF NOT EXISTS batch_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_correction_batches_batch_name
ON examination_committee.correction_batches(batch_name);
