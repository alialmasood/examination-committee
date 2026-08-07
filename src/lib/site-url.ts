import type { NextRequest } from 'next/server';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function isLocalhostOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1';
  } catch {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(origin);
  }
}

function isLocalhostHost(host: string): boolean {
  const h = host.toLowerCase().split(':')[0];
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1';
}

function parseOriginCandidate(raw: string | null | undefined): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    // يدعم قيمة كاملة أو host فقط
    if (/^https?:\/\//i.test(value)) {
      return stripTrailingSlash(new URL(value).origin);
    }
    return null;
  } catch {
    return null;
  }
}

/** مرشحون من متغيرات البيئة بالترتيب: SITE_URL ثم NEXT_PUBLIC_* */
export function getConfiguredSiteOriginCandidates(): string[] {
  const keys = ['SITE_URL', 'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_APP_URL'] as const;
  const out: string[] = [];
  for (const key of keys) {
    const origin = parseOriginCandidate(process.env[key]);
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

export function getConfiguredSiteOrigin(): string | null {
  const candidates = getConfiguredSiteOriginCandidates();
  const nonLocal = candidates.find((c) => !isLocalhostOrigin(c));
  return nonLocal || candidates[0] || null;
}

/**
 * أصل الموقع العام للروابط (QR / الاستمارة العامة).
 * الأولوية:
 * 1) رؤوس البروكسي / Host للطلب الحالي (ما يفتحه المستخدم فعلاً)
 * 2) SITE_URL
 * 3) NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_APP_URL
 * 4) nextUrl.origin
 */
export function getRequestSiteOrigin(request: NextRequest): string {
  const xfProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedProto =
    xfProto ||
    (request.headers.get('x-forwarded-ssl')?.toLowerCase() === 'on' ? 'https' : '');

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedHost && !isLocalhostHost(forwardedHost)) {
    const proto =
      forwardedProto ||
      (request.nextUrl.protocol.replace(':', '') || 'https');
    return stripTrailingSlash(`${proto}://${forwardedHost}`);
  }

  const host = request.headers.get('host')?.split(',')[0]?.trim();
  if (host && !isLocalhostHost(host)) {
    const proto =
      forwardedProto ||
      (request.nextUrl.protocol === 'https:' ? 'https' : 'http');
    return stripTrailingSlash(`${proto}://${host}`);
  }

  const configured = getConfiguredSiteOrigin();
  if (configured && !isLocalhostOrigin(configured)) {
    return configured;
  }

  if (forwardedHost) {
    const proto = forwardedProto || 'http';
    return stripTrailingSlash(`${proto}://${forwardedHost}`);
  }

  if (configured) return configured;
  return stripTrailingSlash(request.nextUrl.origin);
}

export function normalizeApplicationCode(code: string): string {
  return String(code || '').trim().toUpperCase();
}

export function buildPublicApplicationPath(code: string): string {
  return `/public/application/${normalizeApplicationCode(code)}`;
}

export function buildPublicApplicationUrl(origin: string, code: string): string {
  return `${stripTrailingSlash(origin)}${buildPublicApplicationPath(code)}`;
}

/** على المتصفح: ابنِ رابط الاستمارة من أصل الصفحة الحالية دائماً */
export function buildBrowserPublicApplicationUrl(code: string): string {
  if (typeof window === 'undefined') {
    const configured = getConfiguredSiteOrigin();
    if (configured) return buildPublicApplicationUrl(configured, code);
    return buildPublicApplicationPath(code);
  }
  return buildPublicApplicationUrl(window.location.origin, code);
}

/**
 * عند الطباعة من المتصفح: استخدم دائماً نطاق الصفحة الحالية.
 * هذا يمنع أخطاء .env مثل .org.com بدل .org.
 */
export function resolvePublicApplicationUrl(_publicUrl: string, code: string): string {
  const normalizedCode = normalizeApplicationCode(code);
  if (typeof window !== 'undefined') {
    return buildPublicApplicationUrl(window.location.origin, normalizedCode);
  }
  const configured = getConfiguredSiteOrigin();
  if (configured) return buildPublicApplicationUrl(configured, normalizedCode);
  return buildPublicApplicationPath(normalizedCode);
}
