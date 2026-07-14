# خطة تنفيذ المرحلة 4.C — التحويلات بين الحسابات المصرفية

**Baseline:** بعد اعتماد 4.B (`fbf328d`) · Migration `069`.

## القرار المحاسبي

**قيد واحد متعدد الأسطر** يمثل عملية التحويل (متوافق مع Journal Engine و`entry_type = TRANSFER`).

| الحالة | الأسطر |
|--------|--------|
| بدون رسوم | Dr Destination Bank GL · Cr Source Bank GL |
| مع رسوم | Dr Destination (amount) · Dr Fees Expense (fee) · Cr Source (amount+fee) |

- `entry_date` = `transfer_date`
- `value_date` مرجع مصرفي فقط ولا يغيّر تاريخ القيد
- **تاريخ العكس عند VOID = `transfer_date`** (ليس تاريخ الإلغاء) — يجب أن تكون الفترة OPEN

## DELETE API

`DELETE /api/accounts/bank-transfers/[id]` يحذف **مسودة DRAFT فقط**:

- يتطلب `can_prepare` على المصدر و`can_view` على الوجهة
- يرفض POSTED وVOID (409)
- لا يُستخدم للترحيلات الملغاة — الإلغاء عبر VOID
- يسجّل `bank_transfer.deleted`

## التزامن وترتيب الأقفال

1. قفل صف التحويل (`FOR UPDATE`)
2. `acquireBanksLock` (نفس قفل 4.B)
3. قفل صفوف الحسابات البنكية بترتيب UUID تصاعدي
4. قفل صفوف Bank GL (+ GL الرسوم إن وُجد) بترتيب UUID تصاعدي
5. قفل `bank_vouchers` و`bank_transfers` المرتبطة بالمصدر
6. إعادة التحقق من الحالات **بدون** إعادة قفل بترتيب المصدر→الوجهة
7. حساب رصيد المصدر من دفتر الأستاذ POSTED
8. التحقق: الرصيد ≥ amount + fee_amount
9. إنشاء وترحيل القيد

VOID يستخدم نفس `acquireBanksLock` ثم قفل الحسابات/GL بترتيب UUID (لا المصدر أولاً دائماً).

## الصلاحيات

| العملية | المصدر | الوجهة |
|---------|--------|--------|
| إنشاء/تعديل | `can_prepare` | `can_view` على الأقل |
| ترحيل / VOID POSTED | `can_post` | `can_view` |
| عرض التفاصيل | `can_view` على **كليهما** (تحفظي) | — |

تجاوز Admin المركزي المؤقت في `bank-account-access.ts` فقط.

## الحالات

`DRAFT` → `POSTED` → `VOID` (عكس قيد؛ الأصل يبقى POSTED مع ربط العكس).

## APIs

- `GET/POST /api/accounts/bank-transfers`
- `GET/PATCH/DELETE /api/accounts/bank-transfers/[id]`
- `POST .../[id]/post` · `POST .../[id]/void`
- `GET .../options`

## الواجهة

- `/accounts/banks/transfers` · `/accounts/banks/transfers/[id]`
- تحديث `/accounts/banks/[id]` لعرض الصادر/الوارد دون مضاعفة الرصيد

## Audit

`bank_transfer.created|updated|posted|voided|deleted`

## Seed

`DEMO-BA-IQD` → `DEMO-BA-IQD-2` · `DEMO-BT-PLAIN` · `DEMO-BT-FEE` · `DEMO-BT-DRAFT` · `DEMO-BANK-FEE`

## الاختبارات

`npm run test:bank-transfers`

## خارج النطاق

تحويل خارجي · متعدد العملات · FX · SWIFT · اعتمادات متعددة · استيراد كشف · تسوية بنكية.

## Acceptance Criteria

انظر المتطلبات التنفيذية في طلب المرحلة 4.C — جميع النقاط مغطاة بالاختبارات والتوثيق أعلاه.
