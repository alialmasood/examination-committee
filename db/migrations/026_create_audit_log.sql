-- Migration: إنشاء جدول سجل العمليات (Audit Log)
-- Date: 2025-01-XX

-- إنشاء جدول لتسجيل جميع العمليات المهمة في النظام
CREATE TABLE IF NOT EXISTS platform.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  username TEXT NOT NULL,
  full_name TEXT,
  action_type TEXT NOT NULL, -- 'create', 'update', 'delete', 'complete_registration', 'mark_paid', etc.
  entity_type TEXT NOT NULL, -- 'student', 'payment', 'grade', etc.
  entity_id TEXT, -- ID of the affected entity (student_id, payment_id, etc.)
  entity_name TEXT, -- Human-readable name (e.g., student full name)
  description TEXT NOT NULL, -- Detailed description of the action
  old_values JSONB, -- Previous values (for updates)
  new_values JSONB, -- New values (for creates/updates)
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- إنشاء فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON platform.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_type ON platform.audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type ON platform.audit_log(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_id ON platform.audit_log(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON platform.audit_log(created_at DESC);

-- تعليق على الجدول
COMMENT ON TABLE platform.audit_log IS 'سجل العمليات المهمة في النظام للأمان والمراجعة';
COMMENT ON COLUMN platform.audit_log.action_type IS 'نوع العملية: create, update, delete, complete_registration, mark_paid, etc.';
COMMENT ON COLUMN platform.audit_log.entity_type IS 'نوع الكيان المتأثر: student, payment, grade, etc.';
COMMENT ON COLUMN platform.audit_log.old_values IS 'القيم القديمة (للتحديثات)';
COMMENT ON COLUMN platform.audit_log.new_values IS 'القيم الجديدة (للإنشاءات والتحديثات)';

