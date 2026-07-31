/**
 * جدول الأقساط السنوية حسب القسم ونوع الدراسة.
 * القيم الافتراضية للتلقيم الأولي؛ المصدر التشغيلي: accounts.department_tuition_fees
 * عبر /accounts/students/department-installments
 */

export const FIXED_CHANNEL_DISCOUNTS: Record<string, number> = {
  general: 0,
  martyrs: 50,
  social_care: 50,
  siblings_married: 10,
  top_students: 10,
  health_ministry: 20,
};

export const STUDENT_DEPARTMENTS = [
  { id: 'anesthesia', name: 'تقنيات التخدير' },
  { id: 'radiology', name: 'تقنيات الاشعة' },
  { id: 'dental', name: 'تقنيات صناعة الاسنان' },
  { id: 'construction', name: 'هندسة تقنيات البناء والانشاءات' },
  { id: 'oil-gas', name: 'تقنيات هندسة النفط والغاز' },
  { id: 'health-physics', name: 'تقنيات الفيزياء الصحية' },
  { id: 'optics', name: 'تقنيات البصريات' },
  { id: 'community-health', name: 'تقنيات صحة المجتمع' },
  { id: 'emergency-medicine', name: 'تقنيات طب الطوارئ' },
  { id: 'physical-therapy', name: 'تقنيات العلاج الطبيعي' },
  { id: 'cybersecurity', name: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية' },
  { id: 'law', name: 'القانون' },
] as const;

export type TuitionFeeLookupMap = Record<
  string,
  { morning: number; evening: number }
>;

export function normalizeDeptKey(value?: string | null): string {
  return String(value || '')
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ');
}

function isEveningStudy(studyType?: string | null): boolean {
  const st = String(studyType || '').toLowerCase().trim();
  return st === 'evening' || st === 'مسائي';
}

/** القيم الافتراضية (تلقيم أولي + احتياط) */
export function getDefaultAnnualTuitionFee(
  department: string,
  studyType?: string | null
): number {
  const isEvening = isEveningStudy(studyType);
  const fees: Record<string, number> = {
    'تقنيات التخدير': isEvening ? 2750000 : 3000000,
    'تقنيات الاشعة': isEvening ? 2750000 : 3000000,
    'تقنيات الأشعة': isEvening ? 2750000 : 3000000,
    'تقنيات صناعة الاسنان': isEvening ? 2250000 : 2500000,
    'تقنيات صناعة الأسنان': isEvening ? 2250000 : 2500000,
    'تقنيات البصريات': 2750000,
    'تقنيات طب الطوارئ': 2750000,
    'تقنيات صحة المجتمع': 2750000,
    'تقنيات العلاج الطبيعي': 2750000,
    'هندسة تقنيات البناء والانشاءات': 2500000,
    'تقنيات البناء والاستشارات': 2500000,
    'تقنيات هندسة النفط والغاز': 3000000,
    'تقنيات الفيزياء الصحية': 2500000,
    'هندسة تقنيات الامن السيبراني والحوسبة السحابية': 3000000,
    'تقنيات الامن السيبراني': 3000000,
    'تقنيات الأمن السيبراني': 3000000,
    القانون: 0,
  };
  return fees[department] || 0;
}

/**
 * القسط السنوي.
 * مرّر feesMap من قاعدة البيانات ليصبح هو المصدر؛ وإلا تُستخدم القيم الافتراضية.
 */
export function getAnnualTuitionFee(
  department: string,
  studyType?: string | null,
  feesMap?: TuitionFeeLookupMap | null
): number {
  if (feesMap) {
    const entry = feesMap[normalizeDeptKey(department)];
    if (entry) {
      return isEveningStudy(studyType) ? entry.evening : entry.morning;
    }
  }
  return getDefaultAnnualTuitionFee(department, studyType);
}

export function expectedAnnualFee(
  row: {
    major: string;
    study_type?: string | null;
    admission_channel?: string | null;
    discount_percentage?: number | null;
    discount_amount?: number | null;
    final_fee_after_discount?: number | null;
  },
  feesMap?: TuitionFeeLookupMap | null
): number {
  const annual = getAnnualTuitionFee(row.major, row.study_type, feesMap);
  const channel = String(row.admission_channel || 'general').trim() || 'general';
  const discountPct =
    row.discount_percentage != null && Number(row.discount_percentage) >= 0
      ? Number(row.discount_percentage)
      : FIXED_CHANNEL_DISCOUNTS[channel] ?? 0;
  const computedNet = Math.max(0, annual - (annual * discountPct) / 100);
  const profileDiscount = Math.max(0, Number(row.discount_amount || 0));
  const finalFee = Math.max(0, Number(row.final_fee_after_discount || 0));

  const hasPercentDiscount = discountPct > 0.5;
  const hasAmountDiscount = profileDiscount > 0.5;
  const hasChannelFixed =
    channel !== 'general' && (FIXED_CHANNEL_DISCOUNTS[channel] ?? 0) > 0;

  if (hasPercentDiscount || hasChannelFixed) {
    return computedNet;
  }

  if (hasAmountDiscount) {
    return Math.max(0, annual - Math.min(profileDiscount, annual));
  }

  if (finalFee > 0 && Math.abs(finalFee - annual) < 1) {
    return annual;
  }

  return annual;
}
