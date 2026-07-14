# خطة تنفيذ المرحلة 4.C — التحويلات بين الحسابات المصرفية

**Baseline:** بعد اعتماد 4.B (`fbf328d`) · Migration `069`.

## القرار المحاسبي

**قيد واحد متعدد الأسطر** يمثل عملية التحويل (متوافق مع Journal Engine و`entry_type = TRANSFER`).

| الحالة | الأسطر |
|--------|--------|
| بدون رسوم | Dr Destination Bank GL · Cr Source Bank GL |
| مع رسوم | Dr Destination (amount) · Dr Fees Expense (fee) · Cr Source (amount+fee) |

بديل مرفوض لهذه المرحلة: قيدان منفصلان (تحويل + رسوم) — يزيد التعقيد دون فائدة تدقيقية هنا.

- `entry_date` = `transfer_date`
- `value_date` مرجع مصرفي فقط ولا يغيّر تاريخ القيد
- تاريخ العكس عند VOID = `transfer_date` (مثل 4.B) ويجب أن تكون الفترة OPEN

## الجدول

`accounts.bank_transfers` — انظر Migration `069_create_bank_transfers.sql`.

الترقيم: `BANK_TRANSFER_VOUCHER` / بادئة **BTR** عبر `document_sequences` مع `FOR UPDATE`.

## التزامن وترتيب الأقفال

1. قفل صف التحويل (`FOR UPDATE`)
2. `acquireBanksLock` (نفس قفل 4.B)
3. قفل صفوف الحسابات البنكية بترتيب UUID تصاعدي
4. قفل صفوف Bank GL (+ GL الرسوم إن وُجد) بترتيب UUID تصاعدي
5. قفل `bank_vouchers` و`bank_transfers` المرتبطة بالمصدر
6. حساب رصيد المصدر من دفتر الأستاذ POSTED
7. التحقق: الرصيد ≥ amount + fee_amount
8. إنشاء وترحيل القيد وربط الحالة

سياسة ملزمة: أي خصم من Bank GL يجب أن يستخدم `acquireBanksLock` + قفل GL — مشترك مع `BANK_PAYMENT`.

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
