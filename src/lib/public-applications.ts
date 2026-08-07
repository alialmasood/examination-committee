import { query } from '@/src/lib/db';
import type { ApplicationSnapshot } from '@/src/lib/student-application-print';

let ensured = false;

export async function ensurePublicApplicationsTable() {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS student_affairs.public_applications (
      code VARCHAR(32) PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_public_applications_created
    ON student_affairs.public_applications (created_at DESC)
  `);
  ensured = true;
}

function randomCode(): string {
  const d = new Date();
  const y = String(d.getFullYear()).slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SH${y}${m}${day}${rand}`;
}

export async function createPublicApplication(payload: ApplicationSnapshot): Promise<string> {
  await ensurePublicApplicationsTable();
  for (let i = 0; i < 5; i++) {
    const code = randomCode();
    try {
      await query(
        `INSERT INTO student_affairs.public_applications (code, payload, expires_at)
         VALUES ($1, $2::jsonb, NOW() + INTERVAL '365 days')`,
        [code, JSON.stringify(payload)]
      );
      return code;
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === '23505') continue;
      throw err;
    }
  }
  throw new Error('تعذر توليد رمز استمارة فريد');
}

export async function getPublicApplication(code: string): Promise<{
  code: string;
  payload: ApplicationSnapshot;
  created_at: string;
} | null> {
  await ensurePublicApplicationsTable();
  const result = await query(
    `SELECT code, payload, created_at
     FROM student_affairs.public_applications
     WHERE code = $1
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [code.trim().toUpperCase()]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    code: row.code,
    payload: row.payload as ApplicationSnapshot,
    created_at: row.created_at,
  };
}
