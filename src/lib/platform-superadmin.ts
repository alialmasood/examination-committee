/**
 * حساب السوبر أدمن الوحيد لبوابة /platform-admin
 * منفصل تماماً عن حسابات أنظمة العمل (مثل admin لشؤون الطلبة).
 */
export const PLATFORM_SUPERADMIN_USERNAME = 'ssaarrqq2026';

export function isPlatformSuperAdminUsername(
  username: string | null | undefined
): boolean {
  if (!username) return false;
  return username.trim().toLowerCase() === PLATFORM_SUPERADMIN_USERNAME.toLowerCase();
}
