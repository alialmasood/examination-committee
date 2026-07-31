/**
 * حساب تخفيض الطالب دون مضاعفة خصم ملف الطالب مع خصم وصل التسديد.
 * الدين المستهدف: القسط الأساسي − (المدفوع + التخفيض).
 */

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
 */
export function resolveStudentFeeDiscount(input: {
  annualBase: number;
  profileDiscountAmount?: number | null;
  expectedNet: number;
  finalFeeAfterDiscount?: number | null;
  settlementDiscountAmount: number;
}): StudentFeeDiscountBreakdown {
  const annual = Math.max(0, Number(input.annualBase) || 0);
  const settlement = Math.max(0, Number(input.settlementDiscountAmount) || 0);
  const expectedNet = Math.max(0, Number(input.expectedNet) || 0);
  const finalFee = Math.max(0, Number(input.finalFeeAfterDiscount || 0));
  const profileRaw = Math.max(0, Number(input.profileDiscountAmount || 0));
  const profile =
    profileRaw > 0.5 ? profileRaw : Math.max(0, annual - expectedNet);

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

  if (finalFee > 0 && annual > 0) {
    const derivedTotal = Math.max(0, annual - finalFee);

    if (settlement > 0.5) {
      // خصم الوصل كُتب أيضاً على final_fee → لا تضاعف
      if (nearlyEqual(derivedTotal, settlement)) {
        return pack(0, settlement, settlement);
      }
      // final_fee = بعد خصم القناة فقط، وخصم الوصل إضافي فوقه
      if (nearlyEqual(derivedTotal, profile) && settlement > 0.5) {
        return pack(derivedTotal, settlement, derivedTotal + settlement);
      }
      // مشتق أكبر من خصم الوصل: جزء قناة + وصل
      if (derivedTotal > settlement + 0.5) {
        return pack(derivedTotal - settlement, settlement, derivedTotal);
      }
      // خصم الوصل أكبر أو يساوي المشتق → الوصل مرجع
      return pack(0, settlement, settlement);
    }

    return pack(derivedTotal, 0, derivedTotal);
  }

  if (settlement > 0.5) {
    // نفس المبلغ على الملف والوصل (بعد تسديد يسجّل القناة)
    if (nearlyEqual(profile, settlement)) {
      return pack(0, settlement, settlement);
    }
    // الوصل يشمل خصم القناة (أو أكبر منه)
    if (settlement >= profile - 1) {
      return pack(0, settlement, settlement);
    }
    return pack(profile, settlement, profile + settlement);
  }

  return pack(profile, 0, profile);
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
