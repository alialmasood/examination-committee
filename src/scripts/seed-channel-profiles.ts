import { query, closePool } from '@/src/lib/db';

const channelProfiles = [
  {
    channel_type: 'systemNotification',
    profile_name: 'الاشعارات الداخلية الافتراضية',
    sender_identity: 'system',
    config: {},
  },
  {
    channel_type: 'systemAlert',
    profile_name: 'تنبيهات النظام الحرجة',
    sender_identity: 'system-alert',
    config: {},
  },
  {
    channel_type: 'email',
    profile_name: 'البريد الرسمي للكلية',
    sender_identity: 'notifications@college.edu',
    config: {
      provider: 'smtp',
      host: process.env.SMTP_HOST || 'smtp.example.com',
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true,
      user: process.env.SMTP_USER || 'notifications@college.edu',
    },
  },
  {
    channel_type: 'whatsapp',
    profile_name: 'واتساب الخدمة الرسمية',
    sender_identity: process.env.WHATSAPP_SENDER || '+9647000000000',
    config: {
      provider: process.env.WHATSAPP_PROVIDER || 'meta',
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN || 'SET_ME',
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || 'SET_ME',
      templateNamespace: process.env.WHATSAPP_TEMPLATE_NAMESPACE || 'SET_ME',
    },
  },
];

async function seedChannelProfiles() {
  console.log('🚀 بدء إضافة ملفات تعريف القنوات...');

  for (const profile of channelProfiles) {
    const result = await query(
      `
        INSERT INTO student_affairs.communication_channel_profiles (
          channel_type,
          profile_name,
          sender_identity,
          config,
          is_active,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4::jsonb, TRUE, NOW(), NOW())
        ON CONFLICT (channel_type, sender_identity) DO UPDATE
        SET profile_name = EXCLUDED.profile_name,
            config = EXCLUDED.config,
            is_active = TRUE,
            updated_at = NOW()
        RETURNING id
      `,
      [
        profile.channel_type,
        profile.profile_name,
        profile.sender_identity,
        JSON.stringify(profile.config ?? {}),
      ]
    );

    console.log(`✅ ملف ${profile.profile_name} (${profile.channel_type}) -> ${result.rows[0].id}`);
  }

  console.log('🎉 تم إدخال ملفات تعريف القنوات بنجاح.');
}

seedChannelProfiles()
  .catch((error) => {
    console.error('❌ فشل إدخال ملفات تعريف القنوات:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });

