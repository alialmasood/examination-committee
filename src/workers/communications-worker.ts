import { pool } from '@/src/lib/db';
import type { Pool, PoolClient } from 'pg';
import type { CommunicationChannelProfile } from '@/src/lib/types';

const POLL_INTERVAL_MS = Number(process.env.COMMS_WORKER_INTERVAL_MS) || 30000;
const BATCH_LIMIT = Number(process.env.COMMS_WORKER_BATCH_LIMIT) || 10;

async function fetchActiveChannelProfiles() {
  const result = await pool.query<CommunicationChannelProfile>(
    `
      SELECT
        id,
        channel_type,
        profile_name,
        sender_identity,
        config,
        is_active,
        created_at,
        updated_at
      FROM student_affairs.communication_channel_profiles
      WHERE is_active = TRUE
    `
  );

  const map = new Map<string, CommunicationChannelProfile>();
  for (const row of result.rows) {
    map.set(row.channel_type, row);
  }
  return map;
}

async function fetchPendingCampaigns(client: Pool | PoolClient = pool) {
  const { rows } = await client.query(
    `
      SELECT id
      FROM student_affairs.communication_campaigns
      WHERE status = 'processing'
      ORDER BY created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `,
    [BATCH_LIMIT]
  );
  return rows.map((row) => row.id as string);
}

async function fetchCampaignDetails(campaignId: string) {
  const campaignResult = await pool.query(
    `
      SELECT
        id,
        title,
        message,
        priority,
        audience_type,
        filters,
        custom_recipients,
        status,
        total_recipients,
        created_by,
        created_at,
        updated_at
      FROM student_affairs.communication_campaigns
      WHERE id = $1
    `,
    [campaignId]
  );

  if (campaignResult.rowCount === 0) {
    return null;
  }

  const channelsResult = await pool.query(
    `
      SELECT
        id,
        channel_type,
        sender_profile,
        config,
        status,
        last_error,
        last_attempt_at,
        created_at,
        updated_at
      FROM student_affairs.communication_campaign_channels
      WHERE campaign_id = $1
    `,
    [campaignId]
  );

  return {
    campaign: campaignResult.rows[0],
    channels: channelsResult.rows,
  };
}

function simulateDelivery(channelType: string, profile: CommunicationChannelProfile | undefined) {
  if (!profile) {
    return { success: false, error: 'لا يوجد ملف تعريف نشط لهذه القناة' };
  }

  switch (channelType) {
    case 'systemNotification':
    case 'systemAlert':
      return { success: true, deliveredCount: 1 };
    case 'email':
      if (!profile.sender_identity.includes('@')) {
        return { success: false, error: 'عنوان البريد غير صالح' };
      }
      return { success: true, deliveredCount: 1 };
    case 'whatsapp':
      if (!profile.sender_identity.startsWith('+')) {
        return { success: false, error: 'رقم واتساب المرسل غير صالح' };
      }
      return { success: true, deliveredCount: 1 };
    case 'sms':
      return { success: false, error: 'قناة SMS غير مدعومة حالياً' };
    default:
      return { success: false, error: 'قناة غير معروفة' };
  }
}

async function recordDelivery(
  campaignId: string,
  channelId: string,
  payload: Record<string, unknown>,
  status: 'success' | 'failed',
  errorMessage?: string | null,
  providerResponse?: Record<string, unknown> | null
) {
  await pool.query(
    `
      INSERT INTO student_affairs.communication_channel_deliveries (
        campaign_id,
        channel_id,
        recipient,
        payload,
        status,
        error_message,
        provider_response,
        created_at
      )
      VALUES ($1, $2, NULL, $3::jsonb, $4, $5, $6::jsonb, NOW())
    `,
    [
      campaignId,
      channelId,
      JSON.stringify(payload ?? {}),
      status,
      errorMessage ?? null,
      providerResponse ? JSON.stringify(providerResponse) : null,
    ]
  );
}

async function processCampaign(campaignId: string, profilesMap: Map<string, CommunicationChannelProfile>) {
  const data = await fetchCampaignDetails(campaignId);
  if (!data) {
    return;
  }

  const { campaign, channels } = data;
  console.log(`📣 بدء معالجة الحملة ${campaign.id} - ${campaign.title}`);

  let totalDelivered = 0;
  let hasFailure = false;

  for (const channel of channels) {
    if (channel.status !== 'pending' && channel.status !== 'processing') {
      continue;
    }

    const profile = profilesMap.get(channel.channel_type);
    const result = simulateDelivery(channel.channel_type, profile);
    const deliveryPayload = {
      channelType: channel.channel_type,
      message: campaign.message,
      filters: campaign.filters,
      profileId: profile?.id ?? null,
    };

    if (result.success) {
      totalDelivered += result.deliveredCount ?? 0;
      await pool.query(
        `
          UPDATE student_affairs.communication_campaign_channels
          SET status = 'sent',
              last_error = NULL,
              last_attempt_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `,
        [channel.id]
      );
      console.log(`✅ قناة ${channel.channel_type} تم إرسالها بنجاح`);
      await recordDelivery(campaign.id, channel.id, deliveryPayload, 'success');
    } else {
      hasFailure = true;
      await pool.query(
        `
          UPDATE student_affairs.communication_campaign_channels
          SET status = 'failed',
              last_error = $2,
              last_attempt_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `,
        [channel.id, result.error || 'فشل غير معروف']
      );
      console.warn(`⚠️ قناة ${channel.channel_type} فشلت: ${result.error}`);
      await recordDelivery(campaign.id, channel.id, deliveryPayload, 'failed', result.error || 'فشل غير معروف');
    }
  }

  const campaignStatus = hasFailure ? 'failed' : 'sent';
  await pool.query(
    `
      UPDATE student_affairs.communication_campaigns
      SET status = $2,
          sent_at = NOW(),
          total_recipients = COALESCE(total_recipients, 0) + $3,
          updated_at = NOW()
      WHERE id = $1
    `,
    [campaignId, campaignStatus, totalDelivered]
  );

  console.log(`🎯 انتهت معالجة الحملة ${campaign.id} بالحالة ${campaignStatus}`);
}

export async function runCommunicationsWorker() {
  console.log('🛠️ بدء عامل الحملات...');
  const profilesMap = await fetchActiveChannelProfiles();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const campaignIds = await fetchPendingCampaigns(client);
    await client.query('COMMIT');

    for (const campaignId of campaignIds) {
      await processCampaign(campaignId, profilesMap);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ خطأ في عامل الحملات:', error);
  } finally {
    client.release();
  }
  console.log('⏳ انتهاء دورة العامل، في انتظار الدورة التالية...');
}

if (require.main === module) {
  const interval = setInterval(runCommunicationsWorker, POLL_INTERVAL_MS);
  runCommunicationsWorker().catch((error) => {
    console.error('❌ خطأ غير متوقع في عامل الحملات:', error);
  });

  process.on('SIGINT', () => {
    console.log('🛑 إيقاف عامل الحملات...');
    clearInterval(interval);
    pool.end().then(() => process.exit(0));
  });
}

