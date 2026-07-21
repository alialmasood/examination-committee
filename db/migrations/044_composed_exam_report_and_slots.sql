-- تفصيل الامتحانات المكونة: قسم + نوع دراسة + مرحلة + تقرير JSON لكل شريحة

ALTER TABLE examination_committee.correction_sheet_exports
  ADD COLUMN IF NOT EXISTS export_batch_id UUID,
  ADD COLUMN IF NOT EXISTS department VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stage VARCHAR(255),
  ADD COLUMN IF NOT EXISTS study_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS report_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_correction_sheet_exports_batch
  ON examination_committee.correction_sheet_exports(export_batch_id);

CREATE INDEX IF NOT EXISTS idx_correction_sheet_exports_dept_study_stage
  ON examination_committee.correction_sheet_exports(department, study_type, stage);
