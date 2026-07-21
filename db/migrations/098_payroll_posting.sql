-- ═══════════════════════════════════════════════════════════════
-- 098 — Payroll Posting to General Ledger (9.C.1)
--
-- يضيف حالة POSTED + حقول الترحيل + جدول payroll_run_postings.
-- لا تعديل على 094 / 095 / 096 / 097.
-- لا REVERSED · لا Payments · لا Payslips.
-- ═══════════════════════════════════════════════════════════════

-- 1) توسيع CHECK للحالات (+ POSTED)
ALTER TABLE accounts.payroll_runs
  DROP CONSTRAINT IF EXISTS payroll_runs_status_check;

ALTER TABLE accounts.payroll_runs
  ADD CONSTRAINT payroll_runs_status_check
  CHECK (status IN (
    'DRAFT',
    'CALCULATING',
    'CALCULATED',
    'UNDER_REVIEW',
    'APPROVED',
    'POSTED',
    'CANCELLED'
  ));

-- 2) فهرس الحيّ يشمل POSTED (يمنع Regular بديل بعد الترحيل)
DROP INDEX IF EXISTS accounts.uq_payroll_runs_one_live_regular;

CREATE UNIQUE INDEX uq_payroll_runs_one_live_regular
  ON accounts.payroll_runs (
    payroll_period_id, scope_type,
    COALESCE(scope_ref_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE run_type = 'REGULAR'
    AND status IN (
      'DRAFT', 'CALCULATING', 'CALCULATED',
      'UNDER_REVIEW', 'APPROVED', 'POSTED'
    );

-- 3) حقول الترحيل على التشغيل
ALTER TABLE accounts.payroll_runs
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS posted_by UUID NULL
    REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posting_journal_entry_id UUID NULL
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS posted_snapshot_hash VARCHAR(64) NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_runs_posted_by
  ON accounts.payroll_runs (posted_by)
  WHERE posted_by IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_runs_posting_journal
  ON accounts.payroll_runs (posting_journal_entry_id)
  WHERE posting_journal_entry_id IS NOT NULL;

-- POSTED: حقول الترحيل + تطابق بصمة الاعتماد إلزامية · حقول الاعتماد تبقى
ALTER TABLE accounts.payroll_runs
  DROP CONSTRAINT IF EXISTS ck_payroll_runs_posted_fields;
ALTER TABLE accounts.payroll_runs
  ADD CONSTRAINT ck_payroll_runs_posted_fields CHECK (
    status <> 'POSTED'
    OR (
      posted_at IS NOT NULL
      AND posted_by IS NOT NULL
      AND posting_journal_entry_id IS NOT NULL
      AND posted_snapshot_hash IS NOT NULL
      AND approved_snapshot_hash IS NOT NULL
      AND posted_snapshot_hash = approved_snapshot_hash
      AND approved_at IS NOT NULL
      AND approved_by IS NOT NULL
      AND approval_cycle >= 1
    )
  );

-- خارج POSTED: لا حقول ترحيل (9.C.1)
ALTER TABLE accounts.payroll_runs
  DROP CONSTRAINT IF EXISTS ck_payroll_runs_non_posted_no_posting_fields;
ALTER TABLE accounts.payroll_runs
  ADD CONSTRAINT ck_payroll_runs_non_posted_no_posting_fields CHECK (
    status = 'POSTED'
    OR (
      posted_at IS NULL
      AND posted_by IS NULL
      AND posting_journal_entry_id IS NULL
      AND posted_snapshot_hash IS NULL
    )
  );

-- 4) جدول سجل الترحيل الناجح (immutable تطبيقيًا)
CREATE TABLE IF NOT EXISTS accounts.payroll_run_postings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL
    REFERENCES accounts.payroll_runs(id) ON DELETE RESTRICT,
  payroll_period_id UUID NOT NULL
    REFERENCES accounts.payroll_periods(id) ON DELETE RESTRICT,
  approval_cycle INTEGER NOT NULL,
  journal_entry_id UUID NOT NULL
    REFERENCES accounts.journal_entries(id) ON DELETE RESTRICT,
  posting_date DATE NOT NULL,
  snapshot_hash VARCHAR(64) NOT NULL,
  approved_snapshot_hash VARCHAR(64) NOT NULL,
  request_key_hash VARCHAR(64) NOT NULL,
  request_payload_hash VARCHAR(64) NOT NULL,
  request_key_masked VARCHAR(80) NULL,
  posted_by UUID NOT NULL
    REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  posted_by_display_name_snapshot VARCHAR(200) NULL,
  posted_at TIMESTAMPTZ NOT NULL,
  version_before INTEGER NOT NULL,
  version_after INTEGER NOT NULL,
  gross_total NUMERIC(18, 3) NOT NULL DEFAULT 0,
  deduction_total NUMERIC(18, 3) NOT NULL DEFAULT 0,
  employer_contribution_total NUMERIC(18, 3) NOT NULL DEFAULT 0,
  net_total NUMERIC(18, 3) NOT NULL DEFAULT 0,
  fiscal_year_id UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,
  fiscal_period_id UUID NOT NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT,
  comment TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_payroll_postings_cycle CHECK (approval_cycle >= 1),
  CONSTRAINT ck_payroll_postings_versions CHECK (
    version_before >= 1
    AND version_after = version_before + 1
  ),
  CONSTRAINT ck_payroll_postings_hashes_match CHECK (
    snapshot_hash = approved_snapshot_hash
  ),
  CONSTRAINT ck_payroll_postings_key_hash CHECK (
    request_key_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_payroll_postings_payload_hash CHECK (
    request_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_payroll_postings_snapshot_hash CHECK (
    snapshot_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_payroll_postings_approved_hash CHECK (
    approved_snapshot_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_payroll_postings_amounts_nonneg CHECK (
    gross_total >= 0
    AND deduction_total >= 0
    AND employer_contribution_total >= 0
    AND net_total >= 0
  )
);

-- ترحيل ناجح واحد لكل تشغيل
CREATE UNIQUE INDEX uq_payroll_run_postings_one_per_run
  ON accounts.payroll_run_postings (payroll_run_id);

CREATE UNIQUE INDEX uq_payroll_run_postings_journal
  ON accounts.payroll_run_postings (journal_entry_id);

CREATE UNIQUE INDEX uq_payroll_run_postings_request_key
  ON accounts.payroll_run_postings (request_key_hash);

CREATE INDEX idx_payroll_run_postings_period
  ON accounts.payroll_run_postings (payroll_period_id);

CREATE INDEX idx_payroll_run_postings_posted_at
  ON accounts.payroll_run_postings (posted_at DESC);

COMMENT ON TABLE accounts.payroll_run_postings IS
  '9.C.1: سجل ترحيل رواتب ناجح واحد لكل تشغيل — append-only على مستوى الخدمة + Verify؛ المحاولات الفاشلة في financial_audit_log فقط.';
