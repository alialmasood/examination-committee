/**
 * قنوات القبول ونسب التخفيض المعتمدة في التسديد.
 * النسب الثابتة مصدرها FIXED_CHANNEL_DISCOUNTS في tuitionFees.
 */

export type AdmissionChannelKey =
  | 'general'
  | 'martyrs'
  | 'social_care'
  | 'special_needs'
  | 'political_prisoners'
  | 'siblings_married'
  | 'minister_directive'
  | 'dean_approval'
  | 'faculty_children'
  | 'top_students'
  | 'health_ministry';

export type AdmissionChannelDef = {
  key: AdmissionChannelKey;
  label: string;
  /** نسبة ثابتة؛ null = تُدخل يدوياً */
  fixedPercent: number | null;
  /** موافقة العميد فقط: نسبة أو مبلغ */
  allowAmountOrPercent?: boolean;
};

export const ADMISSION_CHANNEL_DEFS: AdmissionChannelDef[] = [
  { key: 'general', label: 'القناة العامة', fixedPercent: 0 },
  { key: 'martyrs', label: 'قناة ذوي الشهداء', fixedPercent: 50 },
  { key: 'social_care', label: 'قناة الرعاية الاجتماعية', fixedPercent: 50 },
  { key: 'special_needs', label: 'قناة ذوي الهمم', fixedPercent: null },
  { key: 'political_prisoners', label: 'قناة السجناء السياسيين', fixedPercent: null },
  { key: 'siblings_married', label: 'تخفيض الأخوة والمتزوجين', fixedPercent: 10 },
  { key: 'minister_directive', label: 'تخفيض توجيهات معالي الوزير', fixedPercent: null },
  {
    key: 'dean_approval',
    label: 'تخفيض موافقة السيد العميد',
    fixedPercent: null,
    allowAmountOrPercent: true,
  },
  { key: 'faculty_children', label: 'تخفيض أبناء الهيئة التدريسية', fixedPercent: null },
  { key: 'top_students', label: 'تخفيض الأوائل', fixedPercent: 10 },
  { key: 'health_ministry', label: 'تخفيض موظفي وزارة الصحة', fixedPercent: 20 },
];

export function getAdmissionChannelDef(
  key?: string | null
): AdmissionChannelDef | undefined {
  if (!key) return undefined;
  return ADMISSION_CHANNEL_DEFS.find((c) => c.key === key);
}

export function formatAdmissionChannelLabel(key?: string | null): string {
  return getAdmissionChannelDef(key)?.label || key?.trim() || 'غير محدد';
}

export function parseDiscountFeeYears(raw: unknown): number[] {
  const source: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.trim()
      ? raw.split(/[,\s]+/)
      : [];

  const years: number[] = [];
  for (const item of source) {
    const value = Number(item);
    if (value >= 1 && value <= 4 && !years.includes(value)) {
      years.push(value);
    }
  }
  return years.sort((a, b) => a - b);
}

export function serializeDiscountFeeYears(years: number[]): string {
  return [...new Set(years.filter((n) => n >= 1 && n <= 4))]
    .sort((a, b) => a - b)
    .join(',');
}
