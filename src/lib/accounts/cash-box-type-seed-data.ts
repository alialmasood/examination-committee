/** أنواع الصناديق الثابتة المعتمدة في الواجهة */
export const CASH_BOX_TYPE_SEED = [
  {
    code: 'MAIN',
    name_ar: 'الصندوق الرئيسي',
    name_en: 'Main cash box',
    sort_order: 1,
    description: 'الصندوق الرئيسي للكلية',
  },
  {
    code: 'HIGHER_ED',
    name_ar: 'صندوق التعليم العالي',
    name_en: 'Higher education cash box',
    sort_order: 2,
    description: 'صندوق التعليم العالي',
  },
] as const;

export type CashBoxTypeCode = (typeof CASH_BOX_TYPE_SEED)[number]['code'];

export const FIXED_CASH_BOX_TYPES: Array<{ code: string; name_ar: string }> =
  CASH_BOX_TYPE_SEED.map((t) => ({ code: t.code, name_ar: t.name_ar }));
