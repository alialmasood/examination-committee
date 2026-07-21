ALTER TABLE examination_committee.correction_sheet_exports
  ADD COLUMN IF NOT EXISTS subject_code VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_correction_sheet_exports_subject_code
  ON examination_committee.correction_sheet_exports(subject_code);
