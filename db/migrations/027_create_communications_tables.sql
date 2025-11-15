-- Migration: إنشاء جداول حملات المراسلات والقنوات
-- Date: 2025-02-XX

-- جدول الحملات الرئيسية
CREATE TABLE IF NOT EXISTS student_affairs.communication_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  audience_type TEXT NOT NULL CHECK (audience_type IN ('all', 'department', 'stage', 'semester', 'newStudents', 'custom')),
  filters JSONB NOT NULL DEFAULT '{}'::JSONB,
  custom_recipients TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'processing', 'sent', 'failed', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  total_recipients INTEGER,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- جدول القنوات المرتبطة بكل حملة
CREATE TABLE IF NOT EXISTS student_affairs.communication_campaign_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES student_affairs.communication_campaigns(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('systemNotification', 'systemAlert', 'email', 'whatsapp', 'sms')),
  sender_profile TEXT,
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'processing', 'sent', 'failed', 'cancelled')),
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_communication_campaigns_status ON student_affairs.communication_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_communication_campaigns_scheduled_at ON student_affairs.communication_campaigns(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_communication_campaign_channels_campaign_id ON student_affairs.communication_campaign_channels(campaign_id);
CREATE INDEX IF NOT EXISTS idx_communication_campaign_channels_status ON student_affairs.communication_campaign_channels(status);

COMMENT ON TABLE student_affairs.communication_campaigns IS 'الحملات المجدولة أو الجارية لإرسال الإشعارات إلى الطلبة';
COMMENT ON COLUMN student_affairs.communication_campaigns.filters IS 'خيارات الجمهور مثل الأقسام أو المراحل أو الفصول بصيغة JSON';
COMMENT ON COLUMN student_affairs.communication_campaigns.custom_recipients IS 'قائمة أرقام الطلبة المخصصة عند اختيار audience_type = custom';

COMMENT ON TABLE student_affairs.communication_campaign_channels IS 'تفاصيل القنوات المستخدمة في الحملة (بريد، واتساب، إشعار النظام...)';
COMMENT ON COLUMN student_affairs.communication_campaign_channels.sender_profile IS 'المعرف أو الحساب المستخدم للإرسال في هذه القناة';
COMMENT ON COLUMN student_affairs.communication_campaign_channels.config IS 'إعدادات إضافية للقناة مثل قالب الإرسال أو المرفقات';


