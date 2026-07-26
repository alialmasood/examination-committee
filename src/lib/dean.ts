import bcrypt from 'bcrypt';
import { query } from './db';

/**
 * حساب السيد عميد الكلية.
 * الحساب معرّف في الكود ويُنشأ تلقائياً في قاعدة البيانات عند أول تسجيل دخول،
 * لذلك لا يحتاج أي خطوة يدوية عند النشر على سيرفر الإنتاج.
 */
export const DEAN_USERNAME = 'dean';
const DEAN_PASSWORD = 'Dean##202026';
export const DEAN_FULL_NAME = 'السيد عميد الكلية';

export function isDeanUsername(username: string | null | undefined): boolean {
  if (!username) return false;
  return username.trim().toLowerCase() === DEAN_USERNAME;
}

/**
 * إنشاء حساب العميد في قاعدة البيانات إذا لم يكن موجوداً.
 * تُستدعى قبل المصادقة، والتحقق الفعلي من كلمة المرور يتم عبر bcrypt كباقي الحسابات.
 */
export async function ensureDeanUser(): Promise<void> {
  try {
    const existing = await query(
      `SELECT id FROM student_affairs.users WHERE username = $1`,
      [DEAN_USERNAME]
    );
    if (existing.rows.length > 0) return;

    const passwordHash = await bcrypt.hash(DEAN_PASSWORD, 12);
    await query(
      `INSERT INTO student_affairs.users (id, username, password_hash, full_name, email, is_active, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, TRUE, NOW())
       ON CONFLICT (username) DO NOTHING`,
      [DEAN_USERNAME, passwordHash, DEAN_FULL_NAME, 'dean@college.edu']
    );
  } catch (error) {
    console.error('خطأ في تهيئة حساب العميد:', error);
  }
}
