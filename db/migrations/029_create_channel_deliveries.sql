-- Migration: إنشاء جدول سجل محاولات الإرسال لكل قناة
-- Date: 2025-02-XX

CREATE TABLE IF NOT EXISTS student_affairs.communication_channel_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES student_affairs.communication_campaigns(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES student_affairs.communication_campaign_channels(id) ON DELETE CASCADE,
  recipient TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error_message TEXT,
  provider_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_deliveries_campaign_id
  ON student_affairs.communication_channel_deliveries(campaign_id);

CREATE INDEX IF NOT EXISTS idx_channel_deliveries_channel_id
  ON student_affairs.communication_channel_deliveries(channel_id);

COMMENT ON TABLE student_affairs.communication_channel_deliveries IS 'سجل تفصيلي لكل محاولة إرسال تمت بواسطة القنوات المختلفة';
COMMENT ON COLUMN student_affairs.communication_channel_deliveries.recipient IS 'هوية المستلم (بريد إلكتروني، رقم هاتف...)';
COMMENT ON COLUMN student_affairs.communication_channel_deliveries.payload IS 'نص الرسالة أو البيانات المرسلة للمزوّد';
COMMENT ON COLUMN student_affairs.communication_channel_deliveries.provider_response IS 'استجابة المزوّد الخارجية (إن وجدت)';


