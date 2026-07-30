import bcrypt from 'bcrypt';
import { query } from './db';

/**
 * حساب لوحة الإشراف العامة.
 * يُنشأ تلقائياً في قاعدة البيانات عند أول تسجيل دخول،
 * لذلك يعمل على الإنتاج بعد النشر دون خطوة يدوية.
 */
export const GENERAL_SUPERVISION_USERNAME = 'rahmaan';
const GENERAL_SUPERVISION_PASSWORD = 'Rahmaan2026';
export const GENERAL_SUPERVISION_FULL_NAME = 'لوحة إشراف عامة';
export const GENERAL_SUPERVISION_SYSTEM_CODE = 'GENERAL_SUPERVISION';
export const GENERAL_SUPERVISION_BASE_PATH = '/general-supervision';

export function isGeneralSupervisionUsername(
  username: string | null | undefined
): boolean {
  if (!username) return false;
  return username.trim().toLowerCase() === GENERAL_SUPERVISION_USERNAME;
}

/**
 * إنشاء حساب الإشراف في قاعدة البيانات إذا لم يكن موجوداً.
 * التحقق من كلمة المرور يتم عبر bcrypt كباقي الحسابات.
 */
export async function ensureGeneralSupervisionUser(): Promise<void> {
  try {
    const existing = await query(
      `SELECT id FROM student_affairs.users WHERE username = $1`,
      [GENERAL_SUPERVISION_USERNAME]
    );
    if (existing.rows.length > 0) return;

    const passwordHash = await bcrypt.hash(GENERAL_SUPERVISION_PASSWORD, 12);
    await query(
      `INSERT INTO student_affairs.users (id, username, password_hash, full_name, email, is_active, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, TRUE, NOW())
       ON CONFLICT (username) DO NOTHING`,
      [
        GENERAL_SUPERVISION_USERNAME,
        passwordHash,
        GENERAL_SUPERVISION_FULL_NAME,
        'rahmaan@college.edu',
      ]
    );
  } catch (error) {
    console.error('خطأ في تهيئة حساب الإشراف العامة:', error);
  }
}
