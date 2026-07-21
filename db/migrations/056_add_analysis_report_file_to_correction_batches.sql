ALTER TABLE examination_committee.correction_batches
ADD COLUMN IF NOT EXISTS analysis_report_file_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS analysis_report_file_mime VARCHAR(120),
ADD COLUMN IF NOT EXISTS analysis_report_file_bytes BYTEA;
