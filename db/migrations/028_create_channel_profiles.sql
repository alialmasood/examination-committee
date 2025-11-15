-- Migration: إنشاء جدول إعدادات قنوات الإرسال
-- Date: 2025-02-XX

CREATE TABLE IF NOT EXISTS student_affairs.communication_channel_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_type TEXT NOT NULL CHECK (channel_type IN ('systemNotification', 'systemAlert', 'email', 'whatsapp', 'sms')),
  profile_name TEXT NOT NULL,
  sender_identity TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_profiles_type_identity
  ON student_affairs.communication_channel_profiles(channel_type, sender_identity);

COMMENT ON TABLE student_affairs.communication_channel_profiles IS 'الملفات التعريفية للقنوات المختلفة (البريد، واتساب، إشعارات النظام...)';
COMMENT ON COLUMN student_affairs.communication_channel_profiles.sender_identity IS 'هوية المرسل (بريد إلكتروني، رقم واتساب، ... )';
COMMENT ON COLUMN student_affairs.communication_channel_profiles.config IS 'إعدادات إضافية مثل مفاتيح API أو قوالب الرسائل';


