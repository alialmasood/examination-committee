# 5.C.2 — الإشعارات الدائنة واستردادات الطلبة

**Baseline:** `1a529b0` — fix(accounts): harden student relief eligibility and settlement 5C1

## الفرق بين Credit Note وRefund

| | Credit Note | Refund |
|--|-------------|--------|
| الغرض | تخفيض/تصحيح ذمة أو إنشاء رصيد دائن محاسبي | إعادة نقد سبق تحصيله |
| نقد خارج؟ | لا | نعم (سند صرف نقدي/مصرفي) |
| paid_amount | لا يزيد | لا يغيّر |
| relief_amount | لا يغيّر | لا يغيّر |

## قرار Credit Balance

```
Student Balance = Σ(debit − credit) على student_ledger_entries
                  (باستثناء OPENING_REFERENCE)

Credit Balance = max(0, −Student Balance)
```

ينشأ الرصيد الدائن فقط عبر قيد مرحّل (Credit Note / تصحيح) يجعل الصافي سالباً.

### وضعان لـ Credit Note

1. **DEBT_REDUCTION** (مرتبط بمطالبة و`outstanding > 0`):
   - `eligible = outstanding − reserved(PENDING/APPROVED)`
   - يخفض `charge/installment outstanding` ويزيد `credit_note_amount`
   - صيغة القسط: `outstanding = amount − paid − relief − credit_note_amount`

2. **CREDIT_BALANCE_CREATE** (بعد تحصيل؛ المطالبة SETTLED أو بدون أثر إضافي على outstanding):
   - `eligible = posted_collections_on_charge − posted_cns_credit_mode − reserved`
   - لا يخفض outstanding تحت الصفر
   - لا يزيد `credit_note_amount` فوق حد التسوية
   - ينتج رصيد دائن في الـ Subledger فقط

**Refund:** `amount ≤ Credit Balance` ومرتبط بتحصيلات عبر `student_refund_allocations`.

## القواعد المحاسبية

### Credit Note POST
`Dr Revenue Adjustment (EXPENSE) / Cr Student Receivables`

### Credit Note VOID
`Dr Student Receivables / Cr Revenue Adjustment`

### Refund CASH (عبر Cash Payment Voucher فقط)
`Dr Student Receivables / Cr Cash` — لا قيد مكرر

### Refund BANK (عبر Bank Payment Voucher فقط)
`Dr Student Receivables / Cr Bank` — لا قيد مكرر

### Subledger
- CREDIT_NOTE (credit) / CREDIT_NOTE_REVERSAL (debit)
- REFUND (debit) / REFUND_REVERSAL (credit)

## منع VOID Credit Note مع Refund مرتبط

يمنع VOID لـ Credit Note POSTED إذا وُجد Refund POSTED يعتمد على الرصيد الدائن الناتج منه (أو أي Refund POSTED على نفس الحساب ما دام Credit Balance بعد العكس يصبح سالباً). السياسة المحافظة في 5.C.2:

* يمنع VOID Credit Note إن وُجد Refund POSTED على نفس `student_account_id` وحالة الرصيد بعد العكس التقديري < 0.

## خارج النطاق

Advance Payments · منح متعددة العملات · استرداد دون Credit Balance · قيد دفع مكرر بجانب السند.
