import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/src/lib/db';
import type { CommunicationCampaign, CommunicationAudienceType } from '@/src/lib/types';

const MAX_PREVIEW_RECIPIENTS = Number(process.env.COMMS_RECIPIENTS_LIMIT) || 500;

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

async function getRecipientsForCampaign(
  campaign: CommunicationCampaign,
  capabilities: StudentColumnCapabilities
) {
  const audienceType = campaign.audience_type as CommunicationAudienceType;
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

  if (audienceType === 'department' && capabilities.hasMajor) {
    if (departmentIds.size === 0) {
      return [];
    }
    params.push(Array.from(departmentIds));
    whereFragments.push(
      `LOWER(REGEXP_REPLACE(normalize_arabic(COALESCE(s.major, '')), '[^a-zA-Z0-9\u0600-\u06FF]+', '-', 'g')) = ANY($${params.length}::text[])`
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
  params.push(MAX_PREVIEW_RECIPIENTS);

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const audienceType = typeof body.audienceType === 'string' ? body.audienceType : 'all';

    if (!audienceType) {
      return NextResponse.json({ success: false, error: 'نوع الجمهور غير صالح' }, { status: 400 });
    }

    const filters =
      body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters) ? body.filters : {};
    const customRecipients = Array.isArray(body.customRecipients)
      ? body.customRecipients.filter((value: unknown) => typeof value === 'string' && value.trim().length > 0)
      : [];

    const capabilities = await detectStudentColumnCapabilities();

    const fakeCampaign: CommunicationCampaign = {
      id: 'preview',
      title: 'preview',
      message: '',
      priority: 'medium',
      audience_type: audienceType as CommunicationAudienceType,
      filters,
      custom_recipients: customRecipients,
      status: 'draft',
      scheduled_at: null,
      sent_at: null,
      total_recipients: null,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const recipients = await getRecipientsForCampaign(fakeCampaign, capabilities);

    return NextResponse.json({ success: true, data: { recipients } });
  } catch (error) {
    console.error('خطأ أثناء معاينة المستلمين:', error);
    return NextResponse.json({ success: false, error: 'تعذر جلب قائمة المستلمين' }, { status: 500 });
  }
}
