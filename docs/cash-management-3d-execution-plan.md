# Execution Plan — المرحلة 3.D
## سندات القبض والصرف النقدي (`cash_vouchers`)

| الحقل | القيمة |
|--------|--------|
| **الإصدار** | 1.0 |
| **التاريخ** | 12 تموز 2026 |
| **الحالة** | **مكتملة** (Backend + UI + اختبارات) |
| **المرجعية** | 3.A–3.C · Journal Engine · Document Sequences (RV/PV) |

---

## الهدف

إضافة سندات قبض/صرف نقدي مرتبطة بالصندوق والجلسة المفتوحة والقيود المرحلة، مع رصيد متوقع للجلسة وطباعة عربية.

---

## قاعدة البيانات

Migration: `db/migrations/065_create_cash_vouchers.sql`

جدول موحّد `accounts.cash_vouchers`:

- أنواع: `CASH_RECEIPT` | `CASH_PAYMENT`
- حالات: `DRAFT` | `POSTED` | `VOID`
- ترقيم عبر تسلسلات موجودة: `RECEIPT_VOUCHER` → `RV-YYYY-######` · `PAYMENT_VOUCHER` → `PV-YYYY-######`
- `source_type` للقيد: `CASH_RECEIPT` / `CASH_PAYMENT` · `source_id` = voucher.id
- `entry_type`: `RECEIPT` / `PAYMENT`

---

## قواعد القيد

| النوع | مدين | دائن |
|-------|------|------|
| قبض | حساب الصندوق | الحساب المقابل |
| صرف | الحساب المقابل | حساب الصندوق |

- الترحيل ذرّي داخل Transaction مع محرك القيود.
- منع الحساب المقابل = حساب الصندوق.
- صرف: رفض إن المبلغ > الرصيد المتوقع للجلسة.
- VOID لـ POSTED عبر `createReversalEntry` ثم الإبقاء على الأصل `POSTED` مع قيد عكسي `POSTED` (صافي صفر على الرصيد الدفتري، دون حذف القيد الأصلي).

---

## الجلسة والرصيد المتوقع

`expected = opening + posted_receipts − posted_payments`

الجرد في 3.C يعتمد لقطة GL (التي تتضمن قيود السندات المرحلة).

عمليات السند تتطلب جلسة `OPEN` فقط.

---

## APIs

| طريقة | مسار |
|-------|------|
| GET/POST | `/api/accounts/cash-vouchers` |
| GET | `/api/accounts/cash-vouchers/options` |
| GET/PATCH/DELETE | `/api/accounts/cash-vouchers/[id]` |
| POST | `/api/accounts/cash-vouchers/[id]/post` |
| POST | `/api/accounts/cash-vouchers/[id]/void` |

جلسة الصندوق تُرجع `vouchers` + `expected_balance`.

---

## UI

- `/accounts/cashbox/vouchers` — قائمة + إنشاء
- `/accounts/cashbox/vouchers/[id]` — تفاصيل + تعديل DRAFT + ترحيل/إلغاء + طباعة
- تحديث صفحة الجلسة بقسم الحركات
- رابط من إدارة الصناديق

---

## Audit

`cash_voucher.created|updated|posted|voided|deleted`

---

## اختبارات وSeed

```bash
npm run test:cash-vouchers
npm run seed:accounts-demo
```

---

## Acceptance

انظر checklist في نص الطلب — تُعتبر مكتملة بعد نجاح الاختبارات و`tsc` وESLint و`build`.
