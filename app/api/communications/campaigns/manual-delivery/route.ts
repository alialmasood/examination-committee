import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';

export async function POST(request: NextRequest) {
  const client = await pool.connect();
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

    const body = await request.json();
    const { campaignId, channelId, recipient, message } = body ?? {};

    if (!campaignId || !channelId || !recipient) {
      return NextResponse.json(
        { success: false, error: 'يرجى تحديد الحملة والقناة والرقم المرسل إليه' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    const channelResult = await client.query(
      `
        SELECT id
        FROM student_affairs.communication_campaign_channels
        WHERE id = $1 AND campaign_id = $2
        FOR UPDATE
      `,
      [channelId, campaignId]
    );

    if (channelResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'لم يتم العثور على الحملة أو القناة المطلوبة' }, { status: 404 });
    }

    await client.query(
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
        VALUES ($1, $2, $3, $4::jsonb, 'success', NULL, NULL, NOW())
      `,
      [
        campaignId,
        channelId,
        recipient,
        JSON.stringify({
          manual: true,
          sender: user.full_name || user.username,
          message: message || null,
        }),
      ]
    );

    await client.query(
      `
        UPDATE student_affairs.communication_campaign_channels
        SET status = 'sent',
            last_error = NULL,
            last_attempt_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `,
      [channelId]
    );

    await client.query(
      `
        UPDATE student_affairs.communication_campaigns
        SET status = 'sent',
            total_recipients = COALESCE(total_recipients, 0) + 1,
            sent_at = COALESCE(sent_at, NOW()),
            updated_at = NOW()
        WHERE id = $1
      `,
      [campaignId]
    );

    await client.query('COMMIT');
    return NextResponse.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('خطأ أثناء تسجيل الإرسال اليدوي:', error);
    return NextResponse.json({ success: false, error: 'تعذر تسجيل الإرسال اليدوي' }, { status: 500 });
  } finally {
    client.release();
  }
}

