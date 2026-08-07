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

/** أصل الموقع من متغيرات البيئة (إن وُجدت) */
export function getConfiguredSiteOrigin(): string | null {
  const raw =
    process.env.SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    '';
  if (!raw) return null;
  try {
    return stripTrailingSlash(new URL(raw).origin);
  } catch {
    return stripTrailingSlash(raw);
  }
}

/**
 * أصل الموقع العام للروابط (QR / الاستمارة العامة).
 * الأولوية: SITE_URL → رؤوس البروكسي → Host → nextUrl.origin
 * يتجنب إرجاع localhost في الإنتاج خلف reverse proxy قدر الإمكان.
 */
export function getRequestSiteOrigin(request: NextRequest): string {
  const configured = getConfiguredSiteOrigin();
  if (configured && !isLocalhostOrigin(configured)) {
    return configured;
  }

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const xfProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedProto =
    xfProto ||
    (request.headers.get('x-forwarded-ssl')?.toLowerCase() === 'on' ? 'https' : '');

  if (forwardedHost) {
    const hostIsLocal =
      forwardedHost.startsWith('localhost') ||
      forwardedHost.startsWith('127.0.0.1') ||
      forwardedHost.startsWith('0.0.0.0');
    const proto =
      forwardedProto ||
      (hostIsLocal ? 'http' : request.nextUrl.protocol.replace(':', '') || 'https');
    const origin = stripTrailingSlash(`${proto}://${forwardedHost}`);
    if (!isLocalhostOrigin(origin)) return origin;
  }

  const host = request.headers.get('host')?.split(',')[0]?.trim();
  if (host) {
    const hostIsLocal =
      host.startsWith('localhost') ||
      host.startsWith('127.0.0.1') ||
      host.startsWith('0.0.0.0');
    if (!hostIsLocal) {
      const proto =
        forwardedProto ||
        (request.nextUrl.protocol === 'https:' ? 'https' : 'http');
      return stripTrailingSlash(`${proto}://${host}`);
    }
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

/** على المتصفح: ابنِ رابط الاستمارة من أصل الصفحة الحالية */
export function buildBrowserPublicApplicationUrl(code: string): string {
  if (typeof window === 'undefined') {
    return buildPublicApplicationPath(code);
  }
  return buildPublicApplicationUrl(window.location.origin, code);
}

/**
 * يصحّح روابط localhost أو النسبية قبل وضعها في QR.
 * عند الطباعة من المتصفح يُفضَّل دائماً أصل الصفحة الحالية.
 */
export function resolvePublicApplicationUrl(publicUrl: string, code: string): string {
  const normalizedCode = normalizeApplicationCode(code);
  const fallbackPath = buildPublicApplicationPath(normalizedCode);

  if (typeof window !== 'undefined') {
    const browserUrl = buildPublicApplicationUrl(window.location.origin, normalizedCode);
    if (
      !publicUrl ||
      publicUrl.startsWith('/') ||
      isLocalhostOrigin(publicUrl) ||
      !/^https?:\/\//i.test(publicUrl)
    ) {
      return browserUrl;
    }
    // إن كان الرابط يشير لنطاق مختلف عن الصفحة الحالية ويحتوي localhost — استبدله
    try {
      const u = new URL(publicUrl);
      if (isLocalhostOrigin(u.origin) && !isLocalhostOrigin(window.location.origin)) {
        return browserUrl;
      }
    } catch {
      return browserUrl;
    }
    return publicUrl;
  }

  if (!publicUrl || publicUrl.startsWith('/') || !/^https?:\/\//i.test(publicUrl)) {
    const configured = getConfiguredSiteOrigin();
    if (configured) return buildPublicApplicationUrl(configured, normalizedCode);
    return fallbackPath;
  }

  if (isLocalhostOrigin(publicUrl)) {
    const configured = getConfiguredSiteOrigin();
    if (configured && !isLocalhostOrigin(configured)) {
      return buildPublicApplicationUrl(configured, normalizedCode);
    }
  }

  return publicUrl;
}
