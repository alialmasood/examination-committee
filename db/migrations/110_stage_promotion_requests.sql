-- طلبات ترحيل الطلبة بين المراحل (موافقة الحسابات لغير المسددّين)

CREATE TABLE IF NOT EXISTS student_affairs.stage_promotion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES student_affairs.students(id) ON DELETE CASCADE,
  from_stage VARCHAR(20) NOT NULL,
  to_stage VARCHAR(20) NOT NULL,
  fee_year SMALLINT NOT NULL CHECK (fee_year BETWEEN 1 AND 4),
  remaining_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  academic_year VARCHAR(10),
  department TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by UUID,
  requested_by_username TEXT,
  reviewed_by UUID,
  reviewed_by_username TEXT,
  notes TEXT,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_promotion_pending_student
  ON student_affairs.stage_promotion_requests (student_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_stage_promotion_requests_status
  ON student_affairs.stage_promotion_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stage_promotion_requests_student
  ON student_affairs.stage_promotion_requests (student_id);

COMMENT ON TABLE student_affairs.stage_promotion_requests IS
  'طلبات ترحيل مرحلة الطالب التي تحتاج موافقة نظام الحسابات عند وجود متبقٍ مالي';
