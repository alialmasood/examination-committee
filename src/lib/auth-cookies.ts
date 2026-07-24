/**
 * خيارات موحّدة لكوكي المصادقة — maxAge بالثواني (مواصفة المتصفح).
 *
 * مهم: لا نفعّل Secure تلقائياً لمجرد NODE_ENV=production.
 * كثير من نشرات الشبكة الداخلية تعمل على HTTP، والمتصفح يرفض كوكي Secure
 * فيظهر الدخول ناجحاً ثم تفشل الجلسة فوراً.
 *
 * للإنتاج عبر HTTPS:
 *   COOKIE_SECURE=true
 * أو SITE_URL / NEXT_PUBLIC_SITE_URL يبدأ بـ https://
 */
export const ACCESS_COOKIE_MAX_AGE_SEC = 60 * 60; // ساعة
export const REFRESH_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 يوماً

export function shouldUseSecureCookies(): boolean {
  const explicit = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (explicit === 'true' || explicit === '1') return true;
  if (explicit === 'false' || explicit === '0') return false;

  const siteUrl =
    process.env.SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    '';
  return siteUrl.startsWith('https://');
}

export function authCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSec,
  };
}
