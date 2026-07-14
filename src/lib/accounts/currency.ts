/**
 * تطبيع رمز العملة (ISO 4217 — 3 أحرف) — Sprint A (Architecture Hardening).
 * استُخرج من bank-accounts.ts::normalizeCurrency للاستخدام المشترك المستقبلي عبر
 * مسارات إنشاء/تحديث الحسابات المصرفية والصناديق دون تغيير السلوك الحالي.
 */
import { AccountsHttpError } from './auth';

/**
 * يُطبّع رمز العملة: يقلّم المسافات، يحوّل لحروف كبيرة، ويتحقق من أنه 3 أحرف لاتينية.
 * القيمة الافتراضية عند عدم التمرير: 'IQD' (نفس السلوك السابق في bank-accounts.ts).
 */
export function normalizeCurrencyCode(value: unknown, fallback = 'IQD'): string {
  const s = String(value ?? fallback).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(s)) {
    throw new AccountsHttpError('رمز العملة يجب أن يكون 3 أحرف (ISO)', 400);
  }
  return s;
}
