export const CASH_BOX_TYPE_SEED = [
  {
    code: 'MAIN',
    name_ar: 'الصندوق الرئيسي',
    name_en: 'Main cash box',
    sort_order: 1,
    description: 'النقد العام للإدارة المالية',
  },
  {
    code: 'PETTY',
    name_ar: 'صندوق المصروفات النثرية',
    name_en: 'Petty cash',
    sort_order: 2,
    description: 'مصروفات صغيرة بسقف محدد',
  },
  {
    code: 'FEES',
    name_ar: 'صندوق الأقساط',
    name_en: 'Fees cash box',
    sort_order: 3,
    description: 'تحصيل أقساط الطلبة نقداً',
  },
  {
    code: 'TEMPORARY',
    name_ar: 'صندوق مؤقت',
    name_en: 'Temporary cash box',
    sort_order: 4,
    description: 'صناديق مؤقتة أو استثنائية',
  },
] as const;

export type CashBoxTypeCode = (typeof CASH_BOX_TYPE_SEED)[number]['code'];
