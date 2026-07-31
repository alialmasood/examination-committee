/**
 * حساب تخفيض الطالب دون مضاعفة خصم ملف الطالب مع خصم وصل التسديد.
 * الدين المستهدف: القسط الأساسي − (المدفوع + التخفيض).
 */

import { FIXED_CHANNEL_DISCOUNTS } from '@/app/accounts/students/lib/tuitionFees';

export type StudentFeeDiscountBreakdown = {
  channelDiscount: number;
  settlementDiscount: number;
  totalDiscount: number;
  /** القسط بعد التخفيض (المطلوب) */
  netDue: number;
};

function nearlyEqual(a: number, b: number, tol = 1): boolean {
  return Math.abs(a - b) <= tol;
}

/**
 * يستخرج مبلغ التخفيض من أول وصل لكل سنة ثم يعيد مجموع السنوات.
 * يُفضّل لملخصات متعددة السنوات.
 */
export function sumSettlementDiscountsByYear(
  receipts: Array<{
    fee_year?: number | string | null;
    discount_mode?: string | null;
    discount_amount?: number | string | null;
    created_at?: string | null;
    settlement_date?: string | null;
  }>
): number {
  const byYear = new Map<number, typeof receipts>();
  for (const row of receipts) {
    const year = Math.max(1, Math.min(4, Number(row.fee_year) || 1));
    const list = byYear.get(year) || [];
    list.push(row);
    byYear.set(year, list);
  }

  let total = 0;
  for (const [, list] of byYear) {
    const first = [...list].sort((a, b) => {
      const ta = Date.parse(String(a.created_at || a.settlement_date || '')) || 0;
      const tb = Date.parse(String(b.created_at || b.settlement_date || '')) || 0;
      return ta - tb;
    })[0];
    if (!first) continue;
    const mode = String(first.discount_mode || 'none');
    const amount = Math.max(0, Number(first.discount_amount || 0));
    if (mode !== 'none' && amount > 0) total += amount;
  }
  return total;
}

/**
 * تخفيض لسنة واحدة (للعرض السنوي في تفصيل المرحلة): أول سنة فيها خصم على الوصل.
 */
export function primaryYearSettlementDiscount(
  receipts: Array<{
    fee_year?: number | string | null;
    discount_mode?: string | null;
    discount_amount?: number | string | null;
    created_at?: string | null;
    settlement_date?: string | null;
  }>
): number {
  for (const year of [1, 2, 3, 4]) {
    const yearRows = receipts
      .filter((r) => Math.max(1, Math.min(4, Number(r.fee_year) || 1)) === year)
      .sort((a, b) => {
        const ta = Date.parse(String(a.created_at || a.settlement_date || '')) || 0;
        const tb = Date.parse(String(b.created_at || b.settlement_date || '')) || 0;
        return ta - tb;
      });
    const first = yearRows[0];
    if (!first) continue;
    const mode = String(first.discount_mode || 'none');
    const amount = Math.max(0, Number(first.discount_amount || 0));
    if (mode !== 'none' && amount > 0) return amount;
  }
  return 0;
}

/**
 * يفك تداخل خصم القناة (ملف الطالب) مع خصم المودال (الوصل).
 * لا يُشتق تخفيض وهمي من فرق القسط الحالي عن final_fee القديم (مثلاً بعد رفع قسط النفط من 2.5M إلى 3M).
 */
export function resolveStudentFeeDiscount(input: {
  annualBase: number;
  profileDiscountAmount?: number | null;
  expectedNet: number;
  finalFeeAfterDiscount?: number | null;
  settlementDiscountAmount: number;
  discountPercentage?: number | null;
  admissionChannel?: string | null;
}): StudentFeeDiscountBreakdown {
  const annual = Math.max(0, Number(input.annualBase) || 0);
  const settlement = Math.max(0, Number(input.settlementDiscountAmount) || 0);
  const expectedNet = Math.max(0, Number(input.expectedNet) || 0);
  const finalFee = Math.max(0, Number(input.finalFeeAfterDiscount || 0));
  const profileRaw = Math.max(0, Number(input.profileDiscountAmount || 0));
  const pct = Math.max(0, Number(input.discountPercentage || 0));
  const channel = String(input.admissionChannel || '')
    .trim()
    .toLowerCase();

  const hasExplicitDiscount =
    settlement > 0.5 ||
    profileRaw > 0.5 ||
    pct > 0.5 ||
    (channel !== '' &&
      channel !== 'general' &&
      (FIXED_CHANNEL_DISCOUNTS[channel] ?? 0) > 0);

  const profile = profileRaw > 0.5 ? profileRaw : 0;

  const pack = (
    channelDiscount: number,
    settlementDiscount: number,
    totalDiscount: number
  ): StudentFeeDiscountBreakdown => ({
    channelDiscount: Math.max(0, channelDiscount),
    settlementDiscount: Math.max(0, settlementDiscount),
    totalDiscount: Math.max(0, totalDiscount),
    netDue: Math.max(0, annual - Math.max(0, totalDiscount)),
  });

  // خصم الوصل هو المرجع الأقوى عند وجوده
  if (settlement > 0.5) {
    if (profile > 0.5 && !nearlyEqual(profile, settlement) && settlement < profile - 1) {
      return pack(profile, settlement, profile + settlement);
    }
    if (
      hasExplicitDiscount &&
      finalFee > 0 &&
      nearlyEqual(Math.max(0, annual - finalFee), profile) &&
      profile > 0.5 &&
      !nearlyEqual(profile, settlement)
    ) {
      return pack(profile, settlement, profile + settlement);
    }
    return pack(0, settlement, settlement);
  }

  if (profile > 0.5) {
    return pack(profile, 0, profile);
  }

  // اشتقاق من final_fee فقط عند تخفيض صريح (قناة/نسبة) — لا من فرق جدول قديم
  if (hasExplicitDiscount && finalFee > 0 && annual > 0) {
    const derivedTotal = Math.max(0, annual - finalFee);
    if (derivedTotal > 0.5) {
      return pack(derivedTotal, 0, derivedTotal);
    }
  }

  // بدون تخفيض صريح: لا تُحسب الفروقات عن final_fee القديم تخفيضاً
  const fallbackProfile =
    expectedNet > 0 && expectedNet < annual - 0.5 && hasExplicitDiscount
      ? Math.max(0, annual - expectedNet)
      : 0;

  return pack(fallbackProfile, 0, fallbackProfile);
}

/** الدين = القسط الأساسي − (المدفوع + التخفيض) */
export function computeDebtFromBase(
  annualBase: number,
  paidAmount: number,
  totalDiscount: number
): number {
  return Math.max(
    0,
    Math.max(0, annualBase) -
      Math.max(0, paidAmount) -
      Math.max(0, totalDiscount)
  );
}
