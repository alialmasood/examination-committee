-- ═══════════════════════════════════════════════════════════════
-- 097 — Payroll Approval Workflow (9.B.1)
--
-- يوسّع حالات payroll_runs + حقول قفل المراجعة/الاعتماد +
-- جدول إجراءات اعتماد غير قابل للتعديل من التطبيق (append-only).
--
-- لا تعديل على 094 / 095 / 096.
-- لا حالة REJECTED · لا حالة POSTED.
-- ═══════════════════════════════════════════════════════════════

-- 1) توسيع CHECK للحالات
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
    'CANCELLED'
  ));

-- 2) توسيع فهرس التشغيل الحيّ ليشمل UNDER_REVIEW و APPROVED
DROP INDEX IF EXISTS accounts.uq_payroll_runs_one_live_regular;

CREATE UNIQUE INDEX uq_payroll_runs_one_live_regular
  ON accounts.payroll_runs (
    payroll_period_id, scope_type,
    COALESCE(scope_ref_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE run_type = 'REGULAR'
    AND status IN ('DRAFT', 'CALCULATING', 'CALCULATED', 'UNDER_REVIEW', 'APPROVED');

-- 3) حقول قفل المراجعة / الاعتماد
ALTER TABLE accounts.payroll_runs
  ADD COLUMN IF NOT EXISTS approval_cycle INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_snapshot_hash VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS submitted_for_review_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS submitted_for_review_by UUID NULL
    REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_snapshot_hash VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS approved_by UUID NULL
    REFERENCES student_affairs.users(id) ON DELETE SET NULL;

ALTER TABLE accounts.payroll_runs
  DROP CONSTRAINT IF EXISTS ck_payroll_runs_approval_cycle;
ALTER TABLE accounts.payroll_runs
  ADD CONSTRAINT ck_payroll_runs_approval_cycle CHECK (approval_cycle >= 0);

-- UNDER_REVIEW: حقول الإرسال إلزامية · الاعتماد NULL
ALTER TABLE accounts.payroll_runs
  DROP CONSTRAINT IF EXISTS ck_payroll_runs_under_review_fields;
ALTER TABLE accounts.payroll_runs
  ADD CONSTRAINT ck_payroll_runs_under_review_fields CHECK (
    status <> 'UNDER_REVIEW'
    OR (
      review_snapshot_hash IS NOT NULL
      AND submitted_for_review_at IS NOT NULL
      AND submitted_for_review_by IS NOT NULL
      AND approved_snapshot_hash IS NULL
      AND approved_at IS NULL
      AND approved_by IS NULL
      AND approval_cycle >= 1
    )
  );

-- APPROVED: سلسلة المراجعة + الاعتماد إلزامية · تطابق hashes الأساسي
ALTER TABLE accounts.payroll_runs
  DROP CONSTRAINT IF EXISTS ck_payroll_runs_approved_fields;
ALTER TABLE accounts.payroll_runs
  ADD CONSTRAINT ck_payroll_runs_approved_fields CHECK (
    status <> 'APPROVED'
    OR (
      review_snapshot_hash IS NOT NULL
      AND submitted_for_review_at IS NOT NULL
      AND submitted_for_review_by IS NOT NULL
      AND approved_snapshot_hash IS NOT NULL
      AND approved_at IS NOT NULL
      AND approved_by IS NOT NULL
      AND approved_snapshot_hash = review_snapshot_hash
      AND approval_cycle >= 1
    )
  );

-- بعد Reject أو خارج المراجعة النشطة: لا تبقَ حقول مراجعة نشطة على CALCULATED/DRAFT/…
-- (يُفرض في Core؛ CHECK جزئي اختياري لـ CALCULATED بلا قفل نشط)
ALTER TABLE accounts.payroll_runs
  DROP CONSTRAINT IF EXISTS ck_payroll_runs_calculated_no_active_review;
ALTER TABLE accounts.payroll_runs
  ADD CONSTRAINT ck_payroll_runs_calculated_no_active_review CHECK (
    status <> 'CALCULATED'
    OR (
      review_snapshot_hash IS NULL
      AND submitted_for_review_at IS NULL
      AND submitted_for_review_by IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_payroll_runs_approval_cycle
  ON accounts.payroll_runs (approval_cycle);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_submitted_by
  ON accounts.payroll_runs (submitted_for_review_by)
  WHERE submitted_for_review_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_runs_approved_by
  ON accounts.payroll_runs (approved_by)
  WHERE approved_by IS NOT NULL;

-- 4) جدول إجراءات الاعتماد (append-only على مستوى التطبيق)
CREATE TABLE IF NOT EXISTS accounts.payroll_run_approval_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL
    REFERENCES accounts.payroll_runs(id) ON DELETE RESTRICT,
  payroll_period_id UUID NOT NULL
    REFERENCES accounts.payroll_periods(id) ON DELETE RESTRICT,
  approval_cycle INTEGER NOT NULL,
  action VARCHAR(40) NOT NULL
    CHECK (action IN ('SUBMITTED_FOR_REVIEW', 'APPROVED', 'REJECTED')),
  from_status VARCHAR(20) NOT NULL,
  to_status VARCHAR(20) NOT NULL,
  actor_id UUID NULL
    REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  actor_display_name_snapshot VARCHAR(200) NULL,
  comment TEXT NULL,
  reason TEXT NULL,
  snapshot_hash VARCHAR(64) NOT NULL,
  version_before INTEGER NOT NULL,
  version_after INTEGER NOT NULL,
  request_key_hash VARCHAR(64) NOT NULL,
  request_payload_hash VARCHAR(64) NOT NULL,
  request_key_masked VARCHAR(80) NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_payroll_approval_actions_cycle CHECK (approval_cycle >= 1),
  CONSTRAINT ck_payroll_approval_actions_versions CHECK (
    version_before >= 1 AND version_after >= version_before
  ),
  CONSTRAINT ck_payroll_approval_actions_key_hash CHECK (
    request_key_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_payroll_approval_actions_payload_hash CHECK (
    request_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT ck_payroll_approval_actions_reject_reason CHECK (
    action <> 'REJECTED'
    OR (reason IS NOT NULL AND char_length(btrim(reason)) >= 10)
  )
);

-- Submit واحد لكل دورة
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_approval_submit_per_cycle
  ON accounts.payroll_run_approval_actions (payroll_run_id, approval_cycle)
  WHERE action = 'SUBMITTED_FOR_REVIEW';

-- طرفي واحد لكل دورة (APPROVED أو REJECTED — لا الاثنان)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_approval_terminal_per_cycle
  ON accounts.payroll_run_approval_actions (payroll_run_id, approval_cycle)
  WHERE action IN ('APPROVED', 'REJECTED');

-- Idempotency: بصمة المفتاح فريدة عالميًا (namespace داخل الـ hash)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_approval_request_key_hash
  ON accounts.payroll_run_approval_actions (request_key_hash);

CREATE INDEX IF NOT EXISTS idx_payroll_approval_actions_run_created
  ON accounts.payroll_run_approval_actions (payroll_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_approval_actions_period
  ON accounts.payroll_run_approval_actions (payroll_period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_approval_actions_actor
  ON accounts.payroll_run_approval_actions (actor_id)
  WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_approval_actions_action
  ON accounts.payroll_run_approval_actions (action);
CREATE INDEX IF NOT EXISTS idx_payroll_approval_actions_cycle
  ON accounts.payroll_run_approval_actions (payroll_run_id, approval_cycle);
