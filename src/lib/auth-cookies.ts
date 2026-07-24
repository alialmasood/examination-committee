/**
 * خيارات موحّدة لكوكي المصادقة — maxAge بالثواني (مواصفة المتصفح).
 */
export const ACCESS_COOKIE_MAX_AGE_SEC = 60 * 60; // ساعة
export const REFRESH_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 يوماً

export function authCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSec,
  };
}
