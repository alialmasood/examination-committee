-- سجل أحداث ترحيل المراحل + حالة reverted لطلبات الموافقة

ALTER TABLE student_affairs.stage_promotion_requests
  DROP CONSTRAINT IF EXISTS stage_promotion_requests_status_check;

ALTER TABLE student_affairs.stage_promotion_requests
  ADD CONSTRAINT stage_promotion_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'reverted'));

CREATE TABLE IF NOT EXISTS student_affairs.stage_promotion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES student_affairs.students(id) ON DELETE CASCADE,
  from_stage VARCHAR(20) NOT NULL,
  to_stage VARCHAR(20) NOT NULL,
  fee_year SMALLINT CHECK (fee_year IS NULL OR (fee_year BETWEEN 1 AND 4)),
  kind VARCHAR(30) NOT NULL
    CHECK (kind IN ('direct', 'approved_request', 'revert')),
  request_id UUID REFERENCES student_affairs.stage_promotion_requests(id) ON DELETE SET NULL,
  target_stage VARCHAR(20),
  cleared_fee_years_revoked SMALLINT[] NOT NULL DEFAULT '{}',
  actor_user_id UUID,
  actor_username TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stage_promotion_events_student
  ON student_affairs.stage_promotion_events (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stage_promotion_events_kind
  ON student_affairs.stage_promotion_events (kind, created_at DESC);

COMMENT ON TABLE student_affairs.stage_promotion_events IS
  'سجل ترحيلات المراحل (مباشر / موافقة / إرجاع) لتتبع التسلسل وإمكانية الإرجاع';
