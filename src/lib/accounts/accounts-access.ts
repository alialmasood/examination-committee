/**
 * صلاحيات إدارة نظام الحسابات (Accounts Admin).
 *
 * المصدر الرسمي: student_affairs.roles.code = 'accounts_admin'
 * عبر platform.user_system_roles + platform.systems.code = 'ACCOUNTS'.
 *
 * Fallback مؤقت بأسماء المستخدمين: للترحيل فقط — موثّق ويصدر تحذيراً مرة واحدة لكل عملية.
 * لا تعتمد عليه كأساس دائم؛ امنح الدور عبر grantAccountsAdminRole / seed / migration 070.
 */
import { AccountsHttpError } from './auth';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';
import { query } from '@/src/lib/db';

export const ACCOUNTS_ADMIN_ROLE_CODE = 'accounts_admin';
export const ACCOUNTS_PLATFORM_SYSTEM_CODE = 'ACCOUNTS';

/**
 * أسماء مستخدمين كانت تُعامل كإدارة قبل الدور الرسمي.
 * محصورة ومؤقتة — أزل الاعتماد بعد اكتمال ترحيل الصلاحيات في البيئات.
 */
const LEGACY_ACCOUNTS_ADMIN_USERNAMES = new Set([
  'accounts',
  'admin',
  'superadmin',
  'super_admin',
]);

let legacyFallbackWarned = false;

function warnLegacyUsernameFallback(username: string): void {
  if (legacyFallbackWarned) return;
  legacyFallbackWarned = true;
  console.warn(
    `[accounts-access] Legacy username admin fallback used for "${username}". ` +
      `Grant role "${ACCOUNTS_ADMIN_ROLE_CODE}" via platform.user_system_roles. ` +
      `This fallback is temporary and must not be the permanent admin model.`
  );
}

/** SQL EXISTS: مستخدم لديه دور accounts_admin لنظام ACCOUNTS */
export function sqlUserHasAccountsAdminRole(userIdParam: string): string {
  return `EXISTS (
    SELECT 1
    FROM platform.user_system_roles usr
    JOIN platform.systems ps ON ps.id = usr.system_id
      AND ps.code = '${ACCOUNTS_PLATFORM_SYSTEM_CODE}'
      AND ps.is_active = TRUE
    JOIN student_affairs.roles r ON r.id = usr.role_id
      AND r.code = '${ACCOUNTS_ADMIN_ROLE_CODE}'
    WHERE usr.user_id = ${userIdParam}::uuid
  )`;
}

/** SQL EXISTS: مطابقة قائمة username القديمة (fallback ترحيل) */
export function sqlUserHasLegacyAccountsAdminUsername(userIdParam: string): string {
  const names = [...LEGACY_ACCOUNTS_ADMIN_USERNAMES]
    .map((u) => `'${u.replace(/'/g, "''")}'`)
    .join(',');
  return `EXISTS (
    SELECT 1 FROM student_affairs.users u
    WHERE u.id = ${userIdParam}::uuid
      AND u.is_active = TRUE
      AND LOWER(TRIM(u.username)) IN (${names})
  )`;
}

/** شرط قائمة/عرض: Admin رسمي أو (مؤقتاً) username قديم */
export function sqlUserIsAccountsAdmin(userIdParam: string): string {
  return `(
    ${sqlUserHasAccountsAdminRole(userIdParam)}
    OR ${sqlUserHasLegacyAccountsAdminUsername(userIdParam)}
  )`;
}

async function loadUsername(
  runner: (text: string, params?: unknown[]) => Promise<{ rows: Array<{ username: string }> }>,
  userId: string
): Promise<string | null> {
  const r = await runner(
    `SELECT username FROM student_affairs.users
     WHERE id = $1::uuid AND is_active = TRUE`,
    [userId]
  );
  return r.rows[0]?.username ?? null;
}

async function hasOfficialAccountsAdminRole(
  runner: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>,
  userId: string
): Promise<boolean> {
  const r = await runner(
    `SELECT 1
     FROM platform.user_system_roles usr
     JOIN platform.systems ps ON ps.id = usr.system_id
       AND ps.code = $2 AND ps.is_active = TRUE
     JOIN student_affairs.roles r ON r.id = usr.role_id AND r.code = $3
     WHERE usr.user_id = $1::uuid
     LIMIT 1`,
    [userId, ACCOUNTS_PLATFORM_SYSTEM_CODE, ACCOUNTS_ADMIN_ROLE_CODE]
  );
  return r.rows.length > 0;
}

function isLegacyAdminUsername(username: string | null | undefined): boolean {
  const u = String(username ?? '').trim().toLowerCase();
  return Boolean(u) && LEGACY_ACCOUNTS_ADMIN_USERNAMES.has(u);
}

/**
 * هل المستخدم Accounts Admin؟
 * يفضّل الدور الرسمي؛ إن غاب يفحص username legacy مع تحذير.
 */
export async function hasAccountsAdminAccess(
  client: TxClient | null,
  userId: string
): Promise<boolean> {
  const runner =
    client != null
      ? (text: string, params?: unknown[]) => txQuery(client, text, params)
      : (text: string, params?: unknown[]) => query(text, params);

  if (await hasOfficialAccountsAdminRole(runner, userId)) {
    return true;
  }

  const username = await loadUsername(runner, userId);
  if (isLegacyAdminUsername(username)) {
    warnLegacyUsernameFallback(String(username));
    return true;
  }
  return false;
}

export async function requireAccountsAdmin(
  client: TxClient | null,
  userId: string,
  message = 'يتطلب صلاحية مدير الحسابات (Accounts Admin)'
): Promise<void> {
  if (!(await hasAccountsAdminAccess(client, userId))) {
    throw new AccountsHttpError(message, 403);
  }
}

/** منح الدور الرسمي (seed / أدوات إدارية) */
export async function grantAccountsAdminRole(userId: string): Promise<void> {
  await query(
    `INSERT INTO student_affairs.roles (code, name_ar, name_en)
     VALUES ($1, 'مدير الحسابات', 'Accounts Admin')
     ON CONFLICT (code) DO NOTHING`,
    [ACCOUNTS_ADMIN_ROLE_CODE]
  );
  await query(
    `INSERT INTO platform.systems (code, name_ar, base_path, description, is_active)
     VALUES ($1, 'نظام الحسابات', '/accounts',
             'نظام الحسابات المالية — صلاحيات تفصيلية عبر user_system_roles', TRUE)
     ON CONFLICT (code) DO UPDATE SET is_active = TRUE, updated_at = NOW()`,
    [ACCOUNTS_PLATFORM_SYSTEM_CODE]
  );
  await query(
    `INSERT INTO platform.user_system_roles (user_id, system_id, role_id, created_at)
     SELECT $1::uuid, ps.id, r.id, NOW()
     FROM platform.systems ps
     CROSS JOIN student_affairs.roles r
     WHERE ps.code = $2 AND r.code = $3
     ON CONFLICT (user_id, system_id) DO UPDATE SET role_id = EXCLUDED.role_id`,
    [userId, ACCOUNTS_PLATFORM_SYSTEM_CODE, ACCOUNTS_ADMIN_ROLE_CODE]
  );
}

/** @deprecated استخدم hasAccountsAdminAccess — مُبقى للتوافق مع اختبارات قديمة */
export function isPrivilegedAccountsUsername(
  username: string | null | undefined
): boolean {
  return isLegacyAdminUsername(username);
}
