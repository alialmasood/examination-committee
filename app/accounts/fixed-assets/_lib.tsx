/* eslint-disable @typescript-eslint/no-explicit-any */
/** أدوات مشتركة لواجهة الأصول الثابتة — 8.A */

export const COLLEGE_NAME = 'كلية الشرق للعلوم التقنية التخصصية';

export const API = {
  options: '/api/accounts/fixed-assets/options',
  categories: '/api/accounts/fixed-assets/categories',
  locations: '/api/accounts/fixed-assets/locations',
  assets: '/api/accounts/fixed-assets',
  fromPurchasing: '/api/accounts/fixed-assets/from-purchasing',
  movements: '/api/accounts/fixed-assets/movements',
  custodyHistory: '/api/accounts/fixed-assets/custody-history',
  depreciationRuns: '/api/accounts/fixed-assets/depreciation-runs',
  disposals: '/api/accounts/fixed-assets/disposals',
} as const;

export async function fetchJson(url: string, init?: RequestInit) {
  try {
    const r = await fetch(url, { credentials: 'include', ...init });
    const body = await r.json().catch(() => ({}));
    return { ...body, __status: r.status, __ok: r.ok };
  } catch {
    return { success: false, message: 'تعذّر الاتصال بالخادم', __status: 0, __ok: false };
  }
}

/** رسالة خطأ عربية موحّدة مع معالجة 401/403 بلطف */
export function errMsg(r: any): string {
  if (r?.__status === 401) return 'انتهت الجلسة أو تحتاج إلى تسجيل الدخول';
  if (r?.__status === 403) return r?.message || 'ليس لديك صلاحية لتنفيذ هذا الإجراء';
  return r?.message || r?.error || 'تعذّر تنفيذ العملية';
}

/** صلاحيات الأصول الثابتة (يجب أن تطابق FIXED_ASSETS_CAPABILITIES في الخادم). */
export const CAP = {
  CATEGORY_VIEW: 'asset_categories.view',
  CATEGORY_MANAGE: 'asset_categories.manage',
  LOCATION_VIEW: 'asset_locations.view',
  LOCATION_MANAGE: 'asset_locations.manage',
  ASSET_VIEW: 'fixed_assets.view',
  ASSET_PREPARE: 'fixed_assets.prepare',
  ASSET_ACTIVATE: 'fixed_assets.activate',
  ASSET_SUSPEND: 'fixed_assets.suspend',
  ASSET_CANCEL: 'fixed_assets.cancel',
  ASSET_THRESHOLD_OVERRIDE: 'fixed_assets.threshold_override',
  ASSET_CAPITALIZE: 'fixed_assets.capitalize_from_purchasing',
  MOVEMENT_VIEW: 'asset_movements.view',
  MOVEMENT_PREPARE: 'asset_movements.prepare',
  MOVEMENT_POST: 'asset_movements.post',
  MOVEMENT_VOID: 'asset_movements.void',
  DEP_VIEW: 'depreciation.view',
  DEP_PREPARE: 'depreciation.prepare',
  DEP_POST: 'depreciation.post',
  DEP_VOID: 'depreciation.void',
  DISPOSAL_VIEW: 'asset_disposals.view',
  DISPOSAL_PREPARE: 'asset_disposals.prepare',
  DISPOSAL_POST: 'asset_disposals.post',
  DISPOSAL_VOID: 'asset_disposals.void',
} as const;

export function can(caps: string[] | undefined | null, cap: string): boolean {
  return Array.isArray(caps) && caps.includes(cap);
}

/** تنسيق المبالغ بالدينار العراقي (3 خانات عشرية كبقية صفحات الحسابات). */
export function money(v: unknown): string {
  if (v == null || v === '') return '0.000';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function iqd(v: unknown): string {
  return `${money(v)} د.ع`;
}

export const ASSET_STATUS: Record<string, string> = {
  DRAFT: 'مسودة',
  ACTIVE: 'نشط',
  SUSPENDED: 'موقوف',
  FULLY_DEPRECIATED: 'مستهلك بالكامل',
  DISPOSED: 'مستبعد',
  CANCELLED: 'ملغى',
};

export const DOC_STATUS: Record<string, string> = {
  DRAFT: 'مسودة',
  POSTED: 'مرحّل',
  VOIDED: 'ملغى',
};

export const ACQUISITION_TYPE: Record<string, string> = {
  PURCHASE: 'من المشتريات',
  MANUAL: 'يدوي',
  DONATION: 'تبرّع',
  OPENING: 'رصيد افتتاحي',
};

export const MOVEMENT_TYPE: Record<string, string> = {
  LOCATION: 'نقل موقع',
  CUSTODY: 'نقل عهدة',
  DEPARTMENT: 'نقل قسم',
  MIXED: 'مختلط',
};

export const DISPOSAL_TYPE: Record<string, string> = {
  SALE: 'بيع',
  SCRAP: 'إتلاف',
  DAMAGE: 'تلف',
  LOSS: 'فقد',
  DONATION_OUT: 'تبرّع خارج',
};

export const LOCATION_TYPE: Record<string, string> = {
  BUILDING: 'مبنى',
  FLOOR: 'طابق',
  ROOM: 'غرفة',
  WAREHOUSE: 'مخزن',
  OFFICE: 'مكتب',
  LAB: 'مختبر',
  OTHER: 'أخرى',
};

export const DEP_METHOD: Record<string, string> = {
  STRAIGHT_LINE: 'القسط الثابت',
  NONE: 'بدون إهلاك',
};

export function label(map: Record<string, string>, s: string | null | undefined): string {
  if (!s) return '—';
  return map[s] ?? s;
}

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  ACTIVE: 'bg-green-100 text-green-800',
  POSTED: 'bg-green-100 text-green-800',
  SUSPENDED: 'bg-amber-100 text-amber-800',
  FULLY_DEPRECIATED: 'bg-blue-100 text-blue-800',
  DISPOSED: 'bg-purple-100 text-purple-800',
  CANCELLED: 'bg-red-100 text-red-800',
  VOIDED: 'bg-red-100 text-red-800',
};

export function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
  const tone = STATUS_TONE[status] ?? 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${tone}`}>
      {label(map, status)}
    </span>
  );
}

/** بطاقة إحصائية بسيطة قابلة للنقر (للوحة). */
export function StatCard({
  label: lbl,
  value,
  href,
  tone,
}: {
  label: string;
  value: string | number;
  href?: string;
  tone?: string;
}) {
  const inner = (
    <>
      <p className="text-sm text-gray-500">{lbl}</p>
      <p className={`text-2xl font-bold mt-1 ${tone ?? 'text-gray-900'}`}>{value}</p>
    </>
  );
  const cls = 'bg-white rounded-xl shadow p-4 block';
  return href ? (
    <a href={href} className={`${cls} hover:ring-2 hover:ring-red-200`}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
