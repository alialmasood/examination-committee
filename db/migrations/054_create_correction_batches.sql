CREATE TABLE IF NOT EXISTS examination_committee.correction_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sheet_export_id UUID REFERENCES examination_committee.correction_sheet_exports(id) ON DELETE SET NULL,
    source_file_name VARCHAR(255) NOT NULL,
    source_file_mime VARCHAR(120),
    source_file_size_bytes INT,
    source_file_sha256 VARCHAR(128),
    source_file_bytes BYTEA,
    status VARCHAR(30) NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded', 'previewed', 'analyzed', 'corrected', 'detailed_corrected', 'custom_corrected', 'report_ready', 'completed', 'failed')),
    current_step VARCHAR(40) NOT NULL DEFAULT 'upload'
        CHECK (current_step IN ('upload', 'preview', 'analyze', 'correct', 'detailed', 'custom', 'report')),
    pass_percent NUMERIC(5,2),
    analyze_payload JSONB,
    correction_payload JSONB,
    detailed_payload JSONB,
    custom_payload JSONB,
    report_file_name VARCHAR(255),
    report_file_mime VARCHAR(120),
    report_file_bytes BYTEA,
    report_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_correction_batches_created_at
ON examination_committee.correction_batches(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_correction_batches_sheet_export_id
ON examination_committee.correction_batches(sheet_export_id);

CREATE TABLE IF NOT EXISTS examination_committee.correction_batch_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES examination_committee.correction_batches(id) ON DELETE CASCADE,
    event_type VARCHAR(40) NOT NULL
        CHECK (event_type IN ('upload', 'preview', 'analyze', 'correct', 'detailed', 'custom', 'report', 'status')),
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_correction_batch_events_batch_id_created_at
ON examination_committee.correction_batch_events(batch_id, created_at DESC);
