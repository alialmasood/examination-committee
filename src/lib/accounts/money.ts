/**
 * تحويلات مبالغ آمنة للدينار (دقة حتى 3 منازل عشرية) دون float غير آمن.
 */
const MONEY_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/;
const ZERO = BigInt(0);
const THOUSAND = BigInt(1000);

export function normalizeMoneyInput(value: unknown): string {
  if (value == null || value === '') return '0';
  const raw = String(value).trim().replace(/,/g, '');
  if (!MONEY_RE.test(raw)) {
    throw new Error('INVALID_MONEY');
  }
  const [intPart, frac = ''] = raw.split('.');
  return `${intPart}.${frac.padEnd(3, '0')}`;
}

export function moneyToMillis(value: string): bigint {
  const n = normalizeMoneyInput(value);
  const [intPart, frac = '000'] = n.split('.');
  return BigInt(intPart) * THOUSAND + BigInt(frac.padEnd(3, '0').slice(0, 3));
}

export function millisToMoney(millis: bigint): string {
  const neg = millis < ZERO;
  const abs = neg ? -millis : millis;
  const intPart = abs / THOUSAND;
  const frac = (abs % THOUSAND).toString().padStart(3, '0');
  return `${neg ? '-' : ''}${intPart}.${frac}`;
}

export function sumMoney(values: string[]): string {
  let total = ZERO;
  for (const v of values) total += moneyToMillis(v);
  return millisToMoney(total);
}

export function moneyEquals(a: string, b: string): boolean {
  return moneyToMillis(a) === moneyToMillis(b);
}

export function moneyIsPositive(value: string): boolean {
  return moneyToMillis(value) > ZERO;
}

export function moneyIsZero(value: string): boolean {
  return moneyToMillis(value) === ZERO;
}

/** يقبل الإشارة السالبة للمبالغ (فروقات الجرد وغيرها) */
export function normalizeSignedMoneyInput(value: unknown): string {
  if (value == null || value === '') return '0.000';
  const raw = String(value).trim().replace(/,/g, '');
  const neg = raw.startsWith('-');
  const body = neg ? raw.slice(1) : raw;
  const abs = normalizeMoneyInput(body);
  if (neg && moneyToMillis(abs) !== ZERO) {
    return `-${abs}`;
  }
  return abs;
}

export function moneyToMillisSigned(value: string): bigint {
  const n = normalizeSignedMoneyInput(value);
  if (n.startsWith('-')) {
    return -moneyToMillis(n.slice(1));
  }
  return moneyToMillis(n);
}

export function absoluteMoney(value: string): string {
  const m = moneyToMillisSigned(value);
  return millisToMoney(m < ZERO ? -m : m);
}
