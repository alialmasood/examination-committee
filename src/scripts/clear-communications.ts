import { pool } from '../lib/db';

async function clearCommunicationsTables() {
  console.log('🧹 بدء تنظيف جداول المراسلات...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `TRUNCATE TABLE
        student_affairs.communication_channel_deliveries,
        student_affairs.communication_campaign_channels,
        student_affairs.communication_campaigns
      RESTART IDENTITY CASCADE`
    );

    await client.query('COMMIT');
    console.log('✅ تم تفريغ جداول المراسلات بنجاح.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ حدث خطأ أثناء تفريغ الجداول:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

clearCommunicationsTables().catch(() => {
  process.exit(1);
});

