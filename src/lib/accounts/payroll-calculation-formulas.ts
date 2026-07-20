/**
 * تقريب مالي ROUND_HALF_UP — بلا JavaScript Number.
 * دقة داخلية ≥ 6 منازل (مقياس ثابت 1e6).
 */
import { normalizeMoneyInput, moneyToMillis, millisToMoney } from './money';

const SCALE6 = BigInt(1_000_000);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const THOUSAND = BigInt(1_000);
const TEN_THOUSAND = BigInt(10_000);
const HUNDRED = BigInt(100);

/** مقياس العملة المعتمد — IQD = 0 منازل. */
export function currencyDecimalScale(currencyCode: string): number {
  const c = String(currencyCode ?? 'IQD').trim().toUpperCase();
  if (c === 'IQD') return 0;
  // افتراضي آمن لعملات أخرى حتى يُعرَّف جدول عملات لاحقًا
  return 2;
}

/** يحوّل مبلغًا مخزَّنًا (حتى 3 منازل) إلى مقياس داخلي 6. */
export function moneyToScale6(value: unknown): bigint {
  const m = moneyToMillis(normalizeMoneyInput(value));
  return m * THOUSAND;
}

/** نسبة NUMERIC(9,4) → مقياس 6 (قيمة النسبة ككسر × 1e6، مثل 12.5% → 125000). */
export function percentageToScale6Fraction(percentage: unknown): bigint {
  const raw = String(percentage ?? '').trim().replace(/,/g, '');
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(raw)) {
    throw new Error('INVALID_PERCENTAGE');
  }
  const [intPart, frac = ''] = raw.split('.');
  const padded = (frac + '0000').slice(0, 4);
  const pctE4 = BigInt(intPart) * TEN_THOUSAND + BigInt(padded);
  // 12.5% → 0.125 → scale6 = 125000
  // pctE4(12.5000)=125000; 125000 * 1e6 / (10000*100) = 125000
  return (pctE4 * SCALE6) / (TEN_THOUSAND * HUNDRED);
}

/**
 * ROUND_HALF_UP من مقياس 6 إلى `scale` منازل عشرية، يُرجع سلسلة مال (3 منازل مخزّنة).
 * للـ IQD scale=0: 125.125→125.000 ، 125.5→126.000
 */
export function roundHalfUpScale6ToMoney(valueScale6: bigint, currencyScale: number): string {
  if (currencyScale < 0 || currencyScale > 3) {
    throw new Error('INVALID_CURRENCY_SCALE');
  }
  const neg = valueScale6 < ZERO;
  let abs = neg ? -valueScale6 : valueScale6;

  // وحدات عند مقياس العملة داخل scale6
  // scale0: divisor = 1e6; scale2: divisor = 1e4; scale3: divisor = 1e3
  const divisor = BigInt(10) ** BigInt(6 - currencyScale);
  const half = divisor / TWO;
  let units = abs / divisor;
  const rem = abs % divisor;
  if (rem >= half) units += ONE;

  // units عند currencyScale منازل → حوّل إلى millis (3 منازل)
  const millisFactor = BigInt(10) ** BigInt(3 - currencyScale);
  let millis = units * millisFactor;
  if (neg) millis = -millis;
  return millisToMoney(millis);
}

/** FIXED_AMOUNT: يقرّب المبلغ إلى مقياس العملة. */
export function calculateFixedAmount(
  amount: unknown,
  currencyCode: string
): { calculated: string; baseAmount: null } {
  const scale = currencyDecimalScale(currencyCode);
  const s6 = moneyToScale6(amount);
  return { calculated: roundHalfUpScale6ToMoney(s6, scale), baseAmount: null };
}

/**
 * PERCENTAGE_OF_BASIC:
 * ROUND_HALF_UP(base × percentage ÷ 100, currency_scale)
 */
export function calculatePercentageOfBasic(
  baseAmount: unknown,
  percentage: unknown,
  currencyCode: string
): { calculated: string; baseAmount: string } {
  const scale = currencyDecimalScale(currencyCode);
  const base = normalizeMoneyInput(baseAmount);
  const baseS6 = moneyToScale6(base);
  const fracS6 = percentageToScale6Fraction(percentage);
  // product at scale6: baseS6 * (frac as portion of 1e6) / 1e6
  const product = (baseS6 * fracS6) / SCALE6;
  return {
    calculated: roundHalfUpScale6ToMoney(product, scale),
    baseAmount: base,
  };
}
