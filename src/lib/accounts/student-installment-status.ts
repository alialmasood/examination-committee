/**
 * حالة القسط الفعّالة — مشتركة بين خطط الرسوم والتحصيلات (تجنّب الاستيراد الدائري).
 */
import { pgDateOnly } from './document-sequences';
import {
  moneyEquals,
  moneyIsPositive,
  moneyIsZero,
  moneyToMillis,
  normalizeMoneyInput,
} from './money';

export type StudentInstallmentStatus =
  | 'PENDING'
  | 'DUE'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED';

export function deriveInstallmentStatus(
  paid: string,
  amount: string,
  dueDate: string,
  asOfDate?: string,
  outstanding?: string
): StudentInstallmentStatus {
  const paidNorm = normalizeMoneyInput(paid);
  const amountNorm = normalizeMoneyInput(amount);
  if (outstanding != null && moneyIsZero(normalizeMoneyInput(outstanding))) {
    return 'PAID';
  }
  if (moneyEquals(paidNorm, amountNorm)) return 'PAID';
  if (moneyIsPositive(paidNorm) && moneyToMillis(paidNorm) < moneyToMillis(amountNorm)) {
    return 'PARTIALLY_PAID';
  }
  const today = asOfDate ?? pgDateOnly(new Date());
  if (dueDate <= today) return 'DUE';
  return 'PENDING';
}
