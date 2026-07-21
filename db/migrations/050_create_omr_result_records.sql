CREATE TABLE IF NOT EXISTS examination_committee.omr_result_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES examination_committee.correction_sheet_exports(id) ON DELETE CASCADE,
  student_code VARCHAR(100),
  page_index INT NOT NULL,
  source_pdf_name TEXT NOT NULL,
  detected_answers JSONB NOT NULL,
  comparison JSONB NOT NULL,
  review_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  normalized_image_url TEXT,
  suspicious_crops JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_omr_result_records_exam_id
  ON examination_committee.omr_result_records(exam_id);

CREATE INDEX IF NOT EXISTS idx_omr_result_records_exam_review_status
  ON examination_committee.omr_result_records(exam_id, review_status);

