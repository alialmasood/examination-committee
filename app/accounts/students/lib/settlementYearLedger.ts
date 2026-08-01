export type FeeYear = 1 | 2 | 3 | 4;

export type SettlementHistoryRow = {
  id?: string;
  receipt_number?: string;
  fee_year?: number | string | null;
  pay_amount?: number | string | null;
  after_discount?: number | string | null;
  remaining_amount?: number | string | null;
  annual_fee?: number | string | null;
  discount_mode?: string | null;
  discount_input?: number | string | null;
  discount_amount?: number | string | null;
  discount_channel?: string | null;
  discount_fee_years?: string | number[] | null;
  periods?: number | string | null;
  settlement_date?: string | null;
  created_at?: string | null;
};

export type YearLedgerEntry = {
  year: FeeYear;
  label: string;
  target: number;
  paid: number;
  remaining: number;
  status: 'completed' | 'current' | 'pending';
  receiptsCount: number;
};

export type YearLedger = {
  years: YearLedgerEntry[];
  currentYear: FeeYear | null;
  allYearsCompleted: boolean;
};

/** حالة العرض في جدول الحسابات: أخضر / أصفر / أحمر / أبيض */
export type YearVisualStatus =
  | 'completed'
  | 'current_partial'
  | 'current_unpaid'
  | 'pending';

export type YearVisualEntry = {
  year: FeeYear;
  label: string;
  visual: YearVisualStatus;
  target: number;
  paid: number;
  remaining: number;
  isCurrent: boolean;
};

export function getYearVisualEntries(ledger: YearLedger): YearVisualEntry[] {
  return ledger.years.map((entry) => {
    let visual: YearVisualStatus = 'pending';
    if (entry.status === 'completed') {
      visual = 'completed';
    } else if (entry.status === 'current') {
      visual = entry.paid > 0.01 ? 'current_partial' : 'current_unpaid';
    }
    return {
      year: entry.year,
      label: entry.label,
      visual,
      target: entry.target,
      paid: entry.paid,
      remaining: entry.remaining,
      isCurrent: entry.status === 'current',
    };
  });
}

/** فئة فلتر التسديد — مطابقة لصناديق حالة السنة */
export type PaymentFilterCategory = 'settled' | 'partial' | 'unpaid';

export type FeeYearFilter = FeeYear | '' | null | undefined;

function categoryFromYearEntry(
  entry: Pick<YearVisualEntry, 'paid' | 'remaining' | 'visual'> | null | undefined
): PaymentFilterCategory {
  if (!entry) return 'unpaid';
  if (entry.visual === 'completed' || entry.remaining <= 0.01) return 'settled';
  if (entry.visual === 'current_partial' || entry.paid > 0.01) return 'partial';
  return 'unpaid';
}

/**
 * تصنيف حالة التسديد.
 * - بدون feeYear: السنة الجارية في الدفتر (أو مسدّد إن اكتملت الكل).
 * - مع feeYear 1–4: تقييم تلك السنة تحديداً.
 */
export function paymentCategoryFromYearStatus(
  status: {
    current_year: number | null;
    all_completed: boolean;
    years: YearVisualEntry[];
  } | null | undefined,
  feeYear?: FeeYearFilter
): PaymentFilterCategory {
  if (!status) return 'unpaid';

  const selected =
    feeYear === 1 || feeYear === 2 || feeYear === 3 || feeYear === 4
      ? feeYear
      : null;

  if (selected != null) {
    const entry = status.years.find((y) => y.year === selected);
    return categoryFromYearEntry(entry);
  }

  // اكتملت كل السنوات (أو لا سنة جارية) → مسدّد
  if (status.all_completed || status.current_year == null) return 'settled';

  const current =
    status.years.find((y) => y.isCurrent) ||
    status.years.find((y) => y.year === status.current_year);

  return categoryFromYearEntry(current);
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function feeYearLabel(year: number): string {
  switch (year) {
    case 1:
      return 'السنة الأولى';
    case 2:
      return 'السنة الثانية';
    case 3:
      return 'السنة الثالثة';
    case 4:
      return 'السنة الرابعة';
    default:
      return `السنة ${year}`;
  }
}

/**
 * مبلغ الفترة الواحدة = المتبقي بذمة السنة ÷ عدد الفترات
 * (لا يُقسَّم مستحق السنة الكامل متجاهلاً المدفوع السابق)
 */
export function perPeriodFromRemaining(
  outstandingBefore: number,
  periods: number
): number {
  const due = Math.max(0, Number(outstandingBefore) || 0);
  const count = Math.max(1, Math.min(10, Math.floor(Number(periods) || 1)));
  return Math.round((due / count) * 100) / 100;
}

function receiptTime(row: SettlementHistoryRow): number {
  const a = Date.parse(String(row.created_at || ''));
  if (Number.isFinite(a)) return a;
  const b = Date.parse(String(row.settlement_date || ''));
  return Number.isFinite(b) ? b : 0;
}

function resolveFeeYear(row: SettlementHistoryRow): FeeYear {
  const y = toNumber(row.fee_year, 1);
  return Math.max(1, Math.min(4, y || 1)) as FeeYear;
}

function clampYearTarget(raw: number, annual: number): number {
  let target = Math.max(0, raw);
  if (annual > 0) target = Math.min(target, annual);
  if (target <= 0 && annual > 0) target = annual;
  return target;
}

/**
 * هدف السنة من آخر وصل، مع إعادة الاحتساب من القسط الأصلي الحالي.
 * الخصم يُؤخذ من حقول الوصل فقط (مودال التسديد) — لا يُدمج final_fee.
 */
export function resolveYearTargetFromReceipt(
  row: SettlementHistoryRow,
  annualFee: number
): number {
  const annual = Math.max(0, annualFee);
  const mode = String(row.discount_mode || 'none').trim().toLowerCase();
  const discountInput = Math.max(0, toNumber(row.discount_input, 0));
  const discountAmount = Math.max(0, toNumber(row.discount_amount, 0));

  if (mode === 'percent') {
    if (discountInput > 0) {
      const pct = Math.min(100, discountInput);
      return clampYearTarget(annual - (annual * pct) / 100, annual);
    }
    // نسبة محفوظة كمبلغ ناتج فقط
    if (discountAmount > 0) {
      return clampYearTarget(annual - Math.min(discountAmount, annual), annual);
    }
    return annual;
  }

  if (mode === 'amount') {
    if (discountAmount > 0 || discountInput > 0) {
      const amount = discountAmount > 0 ? discountAmount : discountInput;
      return clampYearTarget(annual - Math.min(amount, annual), annual);
    }
    return annual;
  }

  // بدون خصم في الوصل → القسط الأصلي كاملاً (لا نعتمد after_discount القديم)
  return annual;
}

/**
 * بناء دفتر السنوات: كل سنة مستقلة وسقفها القسط السنوي.
 * المتبقي = مستحق السنة − مجموع المدفوع لهذه السنة فقط.
 */
export function buildYearLedger(
  receipts: SettlementHistoryRow[],
  annualFee: number
): YearLedger {
  const annual = Math.max(0, annualFee);
  const paidByYear: Record<FeeYear, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const targetByYear: Record<FeeYear, number | null> = {
    1: null,
    2: null,
    3: null,
    4: null,
  };
  const countByYear: Record<FeeYear, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

  const sorted = [...receipts].sort((a, b) => receiptTime(a) - receiptTime(b));

  for (const row of sorted) {
    const pay = Math.max(0, toNumber(row.pay_amount, 0));
    if (pay <= 0) continue;

    const year = resolveFeeYear(row);

    // آخر وصل للسنة يحدد مستحقها (يسمح بإلغاء/تعديل الخصم لاحقاً من المودال)
    targetByYear[year] = resolveYearTargetFromReceipt(row, annual);

    paidByYear[year] += pay;
    countByYear[year] += 1;
  }

  let currentYear: FeeYear | null = null;
  for (let y = 1; y <= 4; y++) {
    const fy = y as FeeYear;
    const target = targetByYear[fy] ?? annual;
    if (paidByYear[fy] < target - 0.01) {
      currentYear = fy;
      break;
    }
  }

  const years: YearLedgerEntry[] = ([1, 2, 3, 4] as FeeYear[]).map((year) => {
    const target = targetByYear[year] ?? annual;
    const paid = paidByYear[year];
    const remaining = Math.max(0, target - paid);
    return {
      year,
      label: feeYearLabel(year),
      target,
      paid,
      remaining,
      status: 'pending',
      receiptsCount: countByYear[year],
    };
  });

  const refined = years.map((entry) => {
    if (!currentYear) {
      return {
        ...entry,
        status:
          entry.target <= 0 || entry.paid >= entry.target - 0.01
            ? ('completed' as const)
            : ('pending' as const),
      };
    }
    if (entry.year === currentYear) return { ...entry, status: 'current' as const };
    if (entry.year < currentYear) return { ...entry, status: 'completed' as const };
    return { ...entry, status: 'pending' as const };
  });

  return {
    years: refined,
    currentYear,
    allYearsCompleted: currentYear == null && annual > 0,
  };
}

/** حالة السنة الجارية قبل دفعة جديدة */
export function getOpenYearState(
  receipts: SettlementHistoryRow[],
  annualFee: number
): {
  feeYear: FeeYear | null;
  yearTarget: number;
  yearPaidBefore: number;
  outstandingBefore: number;
  receiptsCount: number;
  firstReceipt: SettlementHistoryRow | null;
} {
  const ledger = buildYearLedger(receipts, annualFee);
  const feeYear = ledger.currentYear;
  if (!feeYear) {
    return {
      feeYear: null,
      yearTarget: 0,
      yearPaidBefore: 0,
      outstandingBefore: 0,
      receiptsCount: 0,
      firstReceipt: null,
    };
  }

  const entry = ledger.years.find((y) => y.year === feeYear)!;
  const yearRows = [...receipts]
    .filter((r) => toNumber(r.pay_amount, 0) > 0 && resolveFeeYear(r) === feeYear)
    .sort((a, b) => receiptTime(a) - receiptTime(b));

  return {
    feeYear,
    yearTarget: entry.target,
    yearPaidBefore: entry.paid,
    outstandingBefore: entry.remaining,
    receiptsCount: entry.receiptsCount,
    firstReceipt: yearRows[0] || null,
  };
}

/**
 * إعادة حساب المتبقي التراكمي لكل وصل (للعرض والإصلاح).
 */
export function recalculateRemainingByReceipt(
  receipts: SettlementHistoryRow[],
  annualFee: number
): Array<{ id: string; remaining_amount: number; fee_year: FeeYear }> {
  const annual = Math.max(0, annualFee);
  const sorted = [...receipts]
    .filter((r) => r.id && toNumber(r.pay_amount, 0) > 0)
    .sort((a, b) => receiptTime(a) - receiptTime(b));

  const paidByYear: Record<FeeYear, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const targetByYear: Record<FeeYear, number | null> = {
    1: null,
    2: null,
    3: null,
    4: null,
  };

  const out: Array<{ id: string; remaining_amount: number; fee_year: FeeYear }> =
    [];

  for (const row of sorted) {
    const year = resolveFeeYear(row);
    const pay = Math.max(0, toNumber(row.pay_amount, 0));
    // آخر وصل يحدد مستحق السنة
    targetByYear[year] = resolveYearTargetFromReceipt(row, annual);
    paidByYear[year] += pay;
    const target = targetByYear[year] ?? annual;
    out.push({
      id: String(row.id),
      fee_year: year,
      remaining_amount: Math.max(0, target - paidByYear[year]),
    });
  }

  return out;
}
