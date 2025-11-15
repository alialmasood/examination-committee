import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';
import type {
  CommunicationAudienceType,
  CommunicationChannelType,
  CommunicationCampaign,
} from '@/src/lib/types';

const MAX_RECIPIENTS = Number(process.env.COMMS_RECIPIENTS_LIMIT) || 500;

const sanitizeIdentifier = (value: string) =>
  value
    .toString()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\u0600-\u06FF-]+/g, '')
    .toLowerCase();

type StudentColumnCapabilities = {
  hasPhone: boolean;
  hasEmergencyPhone: boolean;
  hasMajor: boolean;
  hasAdmissionType: boolean;
  hasSemester: boolean;
  hasPaymentStatus: boolean;
  hasStatus: boolean;
  hasRegistrationStatus: boolean;
  hasFullNameAr: boolean;
  hasFullName: boolean;
  hasFirstName: boolean;
  hasLastName: boolean;
};

type DeliveryColumnCapabilities = {
  recipientColumn: string | null;
};

interface CreateCampaignChannelInput {
  channelType: CommunicationChannelType;
  senderProfile?: string | null;
  config?: Record<string, unknown>;
}

interface CreateCampaignRequestBody {
  title: string;
  message: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  audienceType: CommunicationAudienceType;
  filters?: Record<string, unknown>;
  customRecipients?: string[];
  channels: CreateCampaignChannelInput[];
  totalRecipientsEstimate?: number | null;
}

const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const ALLOWED_AUDIENCE_TYPES = new Set(['all', 'department', 'stage', 'semester', 'newStudents', 'custom']);
const ALLOWED_CHANNEL_TYPES = new Set([
  'systemNotification',
  'systemAlert',
  'email',
  'whatsapp',
  'sms',
]);

function normalizeCustomRecipients(recipientList: unknown): string[] {
  if (!Array.isArray(recipientList)) {
    return [];
  }

  return recipientList
    .map((item) => (typeof item === 'string' ? item.trim() : null))
    .filter((item): item is string => Boolean(item));
}

export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('access_token')?.value;
    if (!accessToken) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 });
    }

    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      return NextResponse.json({ success: false, error: 'رمز المصادقة غير صالح' }, { status: 401 });
    }

    const user = await validateUser(payload.user_id);
    if (!user) {
      return NextResponse.json({ success: false, error: 'المستخدم غير موجود' }, { status: 401 });
    }

    const body = (await request.json()) as CreateCampaignRequestBody;

    if (!body?.title || typeof body.title !== 'string' || !body.message || typeof body.message !== 'string') {
      return NextResponse.json({ success: false, error: 'العنوان والمحتوى مطلوبان' }, { status: 400 });
    }

    if (!ALLOWED_PRIORITIES.has(body.priority)) {
      return NextResponse.json({ success: false, error: 'أولوية غير صالحة' }, { status: 400 });
    }

    if (!ALLOWED_AUDIENCE_TYPES.has(body.audienceType)) {
      return NextResponse.json({ success: false, error: 'نوع الجمهور غير صالح' }, { status: 400 });
    }

    if (!Array.isArray(body.channels) || body.channels.length === 0) {
      return NextResponse.json({ success: false, error: 'يجب تحديد قناة إرسال واحدة على الأقل' }, { status: 400 });
    }

    const sanitizedChannels: CreateCampaignChannelInput[] = [];
    for (const channel of body.channels) {
      if (!channel || !ALLOWED_CHANNEL_TYPES.has(channel.channelType)) {
        return NextResponse.json({ success: false, error: 'قناة إرسال غير صالحة' }, { status: 400 });
      }

      sanitizedChannels.push({
        channelType: channel.channelType,
        senderProfile:
          typeof channel.senderProfile === 'string' && channel.senderProfile.trim().length > 0
            ? channel.senderProfile.trim()
            : null,
        config: channel.config && typeof channel.config === 'object' ? channel.config : {},
      });
    }

    const filters =
      body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters) ? body.filters : {};
    const customRecipients = normalizeCustomRecipients(body.customRecipients);

    const initialStatus = 'processing';
    const channelInitialStatus = 'pending';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insertCampaignResult = await client.query(
        `
          INSERT INTO student_affairs.communication_campaigns (
            title,
            message,
            priority,
            audience_type,
            filters,
            custom_recipients,
            status,
            scheduled_at,
            total_recipients,
            created_by,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[], $7, NULL, $8, $9, NOW(), NOW())
          RETURNING id, status, scheduled_at, created_at
        `,
        [
          body.title.trim(),
          body.message.trim(),
          body.priority,
          body.audienceType,
          JSON.stringify(filters),
          customRecipients,
          initialStatus,
          body.totalRecipientsEstimate ?? null,
          user.id,
        ]
      );

      const campaignRow = insertCampaignResult.rows[0];
      const campaignId: string = campaignRow.id;

      for (const channel of sanitizedChannels) {
        await client.query(
          `
            INSERT INTO student_affairs.communication_campaign_channels (
              campaign_id,
              channel_type,
              sender_profile,
              config,
              status,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4::jsonb, $5, NOW(), NOW())
          `,
          [campaignId, channel.channelType, channel.senderProfile, JSON.stringify(channel.config ?? {}), channelInitialStatus]
        );
      }

      await client.query('COMMIT');

      return NextResponse.json(
        {
          success: true,
          data: {
            id: campaignId,
            status: campaignRow.status,
            scheduled_at: campaignRow.scheduled_at,
            created_at: campaignRow.created_at,
          },
        },
        { status: 201 }
      );
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('خطأ أثناء إنشاء حملة المراسلات:', error);
      return NextResponse.json({ success: false, error: 'تعذر إنشاء الحملة' }, { status: 500 });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('خطأ غير متوقع في حملة المراسلات:', error);
      return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('access_token')?.value;
    if (!accessToken) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 });
    }

    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      return NextResponse.json({ success: false, error: 'رمز المصادقة غير صالح' }, { status: 401 });
    }

    const user = await validateUser(payload.user_id);
    if (!user) {
      return NextResponse.json({ success: false, error: 'المستخدم غير موجود' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const campaignsResult = await pool.query(
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
          updated_at,
          sent_at
        FROM student_affairs.communication_campaigns
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    const campaigns = campaignsResult.rows;

    if (campaigns.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const campaignIds = campaigns.map((campaign) => campaign.id);

    const channelsResult = await pool.query(
      `
        SELECT
          id,
          campaign_id,
          channel_type,
          status,
          last_error,
          last_attempt_at,
          created_at,
          updated_at,
          sender_profile
        FROM student_affairs.communication_campaign_channels
        WHERE campaign_id = ANY($1::uuid[])
        ORDER BY created_at ASC
      `,
      [campaignIds]
    );

    const channelIds = channelsResult.rows.map((row) => row.id);
    const deliveryColumnInfo = await detectDeliveryColumnCapabilities();

    const deliveryMetricsResult = channelIds.length
      ? await pool.query(
          `
            SELECT
              channel_id,
              SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
              MAX(created_at) AS last_delivery_at
            FROM student_affairs.communication_channel_deliveries
            WHERE channel_id = ANY($1::uuid[])
            GROUP BY channel_id
          `,
          [channelIds]
        )
      : { rows: [] };

    const deliveryDetailsResult = channelIds.length
      ? await pool.query(
          `
            SELECT
              channel_id,
              ${deliveryColumnInfo.recipientColumn ?? 'NULL'} AS recipient,
              status,
              error_message,
              created_at
            FROM student_affairs.communication_channel_deliveries
            WHERE channel_id = ANY($1::uuid[])
            ORDER BY created_at DESC
          `,
          [channelIds]
        )
      : { rows: [] };

    const deliveryMetricsMap = new Map<
      string,
      { success_count: number; failed_count: number; last_delivery_at: string | null }
    >();
    deliveryMetricsResult.rows.forEach((row) => {
      deliveryMetricsMap.set(row.channel_id, {
        success_count: Number(row.success_count) || 0,
        failed_count: Number(row.failed_count) || 0,
        last_delivery_at: row.last_delivery_at || null,
      });
    });

    const deliveryDetailsMap = new Map<
      string,
      Array<{
        recipient: string | null;
        status: 'success' | 'failed';
        errorMessage: string | null;
        createdAt: string;
      }>
    >();
    deliveryDetailsResult.rows.forEach((row) => {
      const list = deliveryDetailsMap.get(row.channel_id) || [];
      list.push({
        recipient: row.recipient,
        status: row.status,
        errorMessage: row.error_message,
        createdAt: row.created_at,
      });
      deliveryDetailsMap.set(row.channel_id, list);
    });

    const channelsByCampaign = new Map<string, unknown[]>();
    channelsResult.rows.forEach((channel) => {
      const metrics = deliveryMetricsMap.get(channel.id) || {
        success_count: 0,
        failed_count: 0,
        last_delivery_at: null,
      };
      const payload = {
        id: channel.id,
        channelType: channel.channel_type,
        status: channel.status,
        senderProfile: channel.sender_profile,
        lastError: channel.last_error,
        lastAttemptAt: channel.last_attempt_at,
        updatedAt: channel.updated_at,
        successCount: metrics.success_count,
        failedCount: metrics.failed_count,
        lastDeliveryAt: metrics.last_delivery_at,
        deliveries: deliveryDetailsMap.get(channel.id) ?? [],
      };
      const list = channelsByCampaign.get(channel.campaign_id) || [];
      list.push(payload);
      channelsByCampaign.set(channel.campaign_id, list);
    });

    const columnCapabilities = await detectStudentColumnCapabilities();
    const recipientsByCampaign = new Map<string, Array<{ id: string; name: string | null; phone: string }>>();

    for (const campaign of campaigns) {
      try {
        const recipients = await getRecipientsForCampaign(campaign, columnCapabilities);
        recipientsByCampaign.set(campaign.id, recipients);
      } catch (recipientError) {
        console.error('تعذر تحديد مستلمي الحملة:', {
          campaignId: campaign.id,
          error: recipientError,
        });
        recipientsByCampaign.set(campaign.id, []);
      }
    }

    const response = campaigns.map((campaign) => ({
      id: campaign.id,
      title: campaign.title,
      message: campaign.message,
      priority: campaign.priority,
      audienceType: campaign.audience_type,
      customRecipients: campaign.custom_recipients ?? [],
      filters: campaign.filters,
      status: campaign.status,
      totalRecipients: campaign.total_recipients,
      createdAt: campaign.created_at,
      updatedAt: campaign.updated_at,
      sentAt: campaign.sent_at,
      channels: channelsByCampaign.get(campaign.id) ?? [],
      recipients: recipientsByCampaign.get(campaign.id) ?? [],
    }));

    return NextResponse.json({ success: true, data: response });
  } catch (error) {
    console.error('خطأ في جلب حملات المراسلات:', error);
    return NextResponse.json({ success: false, error: 'حدث خطأ أثناء جلب الحملات' }, { status: 500 });
  }
}

async function getRecipientsForCampaign(
  campaign: CommunicationCampaign,
  capabilities: StudentColumnCapabilities
) {
  const audienceType = campaign.audience_type as string;
  const filters = (campaign.filters ?? {}) as Record<string, unknown>;
  const customRecipients = Array.isArray(campaign.custom_recipients)
    ? campaign.custom_recipients.filter((value: unknown) => typeof value === 'string' && value.trim().length > 0)
    : [];

  if (audienceType === 'custom') {
    return customRecipients.map((phone: string, index: number) => ({
      id: `${campaign.id}-custom-${index}`,
      name: null,
      phone,
    }));
  }

  const phoneExpression = capabilities.hasPhone
    ? 's.phone'
    : capabilities.hasEmergencyPhone
    ? 's.emergency_contact_phone'
    : null;

  if (!phoneExpression) {
    return [];
  }

  const namePieces: string[] = [];
  if (capabilities.hasFullNameAr) {
    namePieces.push('s.full_name_ar');
  }
  if (capabilities.hasFullName) {
    namePieces.push('s.full_name');
  }
  if (capabilities.hasFirstName && capabilities.hasLastName) {
    namePieces.push("s.first_name || ' ' || s.last_name");
  }
  const nameExpression = namePieces.length ? `COALESCE(${namePieces.join(', ')})` : `'طالب'`;

  const params: unknown[] = [];
  const whereFragments: string[] = [
    `${phoneExpression} IS NOT NULL`,
    `LENGTH(TRIM(${phoneExpression})) > 0`,
  ];

  const departmentIds = new Set<string>();
  const stageIds = new Set<string>();
  const semesterIds = new Set<string>();

  if (Array.isArray(filters.departmentNames)) {
    (filters.departmentNames as unknown[])
      .filter((value): value is string => typeof value === 'string')
      .forEach((value) => departmentIds.add(sanitizeIdentifier(value)));
  }

  if (Array.isArray(filters.departments)) {
    (filters.departments as unknown[])
      .filter((value): value is string => typeof value === 'string')
      .forEach((value) => departmentIds.add(String(value)));
  }

  const stageFilter =
    (typeof filters.stage === 'string' && filters.stage) ||
    (typeof filters.selectedStage === 'string' && filters.selectedStage) ||
    null;

  const stageLabel =
    (typeof filters.stageName === 'string' && filters.stageName) ||
    (typeof filters.stageLabel === 'string' && filters.stageLabel) ||
    null;

  if (stageFilter) {
    stageIds.add(stageFilter);
  }
  if (stageLabel) {
    stageIds.add(`stage-${sanitizeIdentifier(stageLabel)}`);
  }

  const semesterFilter =
    (typeof filters.semester === 'string' && filters.semester) ||
    (typeof filters.selectedSemester === 'string' && filters.selectedSemester) ||
    null;

  const semesterLabel =
    (typeof filters.semesterName === 'string' && filters.semesterName) ||
    (typeof filters.semesterLabel === 'string' && filters.semesterLabel) ||
    null;

  if (semesterFilter) {
    semesterIds.add(semesterFilter);
  }
  if (semesterLabel && stageIds.size > 0) {
    const stageSample = Array.from(stageIds)[0];
    semesterIds.add(`${stageSample}-semester-${sanitizeIdentifier(semesterLabel)}`);
  }

  if (audienceType === 'department' && capabilities.hasMajor) {
    if (departmentIds.size === 0) {
      return [];
    }
    params.push(Array.from(departmentIds));
    whereFragments.push(
      `LOWER(REGEXP_REPLACE(normalize_arabic(COALESCE(s.major, '')), '[^a-zA-Z0-9\u0600-\u06FF]+', '-', 'g')) = ANY($${params.length}::text[])`
    );
  }

  if (stageIds.size > 0 && capabilities.hasAdmissionType) {
    params.push(Array.from(stageIds));
    whereFragments.push(
      `('stage-' || LOWER(REGEXP_REPLACE(COALESCE(s.admission_type, ''), '[^a-zA-Z0-9\u0600-\u06FF]+', '-', 'g'))) = ANY($${
        params.length
      }::text[])`
    );
  }

  if (semesterIds.size > 0 && capabilities.hasAdmissionType && capabilities.hasSemester) {
    params.push(Array.from(semesterIds));
    whereFragments.push(
      `('stage-' || LOWER(REGEXP_REPLACE(COALESCE(s.admission_type, ''), '[^a-zA-Z0-9\u0600-\u06FF]+', '-', 'g')) || '-semester-' || LOWER(REGEXP_REPLACE(normalize_arabic(COALESCE(s.semester, '')), '[^a-zA-Z0-9\u0600-\u06FF]+', '-', 'g'))) = ANY($${
        params.length
      }::text[])`
    );
  }

  if (audienceType === 'newStudents') {
    const newStudentConditions: string[] = [];
    if (capabilities.hasPaymentStatus) {
      newStudentConditions.push(`COALESCE(s.payment_status, '') = 'registration_pending'`);
    }
    if (capabilities.hasStatus) {
      newStudentConditions.push(`COALESCE(s.status, '') = 'registration_pending'`);
    }
    if (capabilities.hasRegistrationStatus) {
      newStudentConditions.push(`COALESCE(s.registration_status, '') = 'pending'`);
    }
    if (newStudentConditions.length === 0) {
      return [];
    }
    whereFragments.push(`(${newStudentConditions.join(' OR ')})`);
  }

  const whereClause = whereFragments.length ? `WHERE ${whereFragments.join(' AND ')}` : '';
  params.push(MAX_RECIPIENTS);

  const result = await pool.query(
    `
      SELECT
        s.id,
        ${nameExpression} AS name,
        ${phoneExpression} AS phone
      FROM student_affairs.students s
      ${whereClause}
      ORDER BY ${nameExpression} NULLS LAST
      LIMIT $${params.length}
    `,
    params
  );

  const seen = new Set<string>();
  return result.rows
    .filter((row) => typeof row.phone === 'string' && row.phone.trim().length > 0)
    .map((row) => {
      const phone = row.phone.trim();
      const key = sanitizeIdentifier(phone);
      if (seen.has(key)) {
        return null;
      }
      seen.add(key);
      return {
        id: row.id,
        name: row.name ?? null,
        phone,
      };
    })
    .filter(Boolean) as Array<{ id: string; name: string | null; phone: string }>;
}

async function detectStudentColumnCapabilities(): Promise<StudentColumnCapabilities> {
  const targetColumns = [
    'phone',
    'emergency_contact_phone',
    'major',
    'admission_type',
    'semester',
    'payment_status',
    'status',
    'registration_status',
    'full_name_ar',
    'full_name',
    'first_name',
    'last_name',
  ];

  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'student_affairs'
        AND table_name = 'students'
        AND column_name = ANY($1::text[])
    `,
    [targetColumns]
  );

  const available = new Set(result.rows.map((row) => row.column_name as string));
  return {
    hasPhone: available.has('phone'),
    hasEmergencyPhone: available.has('emergency_contact_phone'),
    hasMajor: available.has('major'),
    hasAdmissionType: available.has('admission_type'),
    hasSemester: available.has('semester'),
    hasPaymentStatus: available.has('payment_status'),
    hasStatus: available.has('status'),
    hasRegistrationStatus: available.has('registration_status'),
    hasFullNameAr: available.has('full_name_ar'),
    hasFullName: available.has('full_name'),
    hasFirstName: available.has('first_name'),
    hasLastName: available.has('last_name'),
  };
}

async function detectDeliveryColumnCapabilities(): Promise<DeliveryColumnCapabilities> {
  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'student_affairs'
        AND table_name = 'communication_channel_deliveries'
        AND column_name = ANY($1::text[])
    `,
    [['recipient_identity', 'recipient']]
  );

  const available = new Set(result.rows.map((row) => row.column_name as string));

  let recipientColumn: string | null = null;
  if (available.has('recipient_identity')) {
    recipientColumn = 'recipient_identity';
  } else if (available.has('recipient')) {
    recipientColumn = 'recipient';
  }

  return { recipientColumn };
}

