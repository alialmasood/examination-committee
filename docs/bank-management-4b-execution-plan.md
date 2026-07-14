# خطة تنفيذ المرحلة 4.B — سندات القبض والصرف المصرفي

**Baseline:** بعد اكتمال 4.A (تأسيس المصارف والحسابات البنكية) · Migration `068`.

## الهدف

تمكين قبض وصرف مصرفي محاسبي داخل الكلية عبر سندات مرقّمة (BRV/BPV)، مرتبطة بحساب بنكي ACTIVE وGL وحساب مقابل، مع ترحيل قيود ذرّي، رصيد دفتري من القيود المرحلة فقط، صلاحيات على مستوى الحساب البنكي، طباعة عربية، وتدقيق مالي — تمهيداً للتحويلات المصرفية والشيكات والتسويات لاحقاً.

## نطاق المرحلة

- إنشاء/تعديل/حذف مسودات سندات بنكية
- ترحيل سند → قيد `POSTED` (قبض أو صرف)
- إلغاء DRAFT أو إلغاء POSTED مع قيد عكسي
- رصيد دفتري للحساب البنكي من `POSTED` فقط
- صلاحيات `bank_account_users` (عرض / إعداد / ترحيل) مع تجاوز لـ `accounts` / `admin`
- واجهة قائمة + تفاصيل + طباعة
- Seed DEMO + اختبارات آلية

## خارج النطاق (لاحقاً)

تحويل مصرفي · شيكات · كشف حساب · تسوية بنكية · مطابقة كشف · استيراد ملفات مصرفية · موافقات متعددة المستويات (`can_approve`).

---

## المخطط (Migration 068)

جدول `accounts.bank_vouchers`:

| الحقل | ملاحظة |
|--------|--------|
| `voucher_type` | `BANK_RECEIPT` \| `BANK_PAYMENT` |
| `status` | `DRAFT` \| `POSTED` \| `VOID` |
| `voucher_number` | عبر تسلسل `BANK_RECEIPT_VOUCHER` / `BANK_PAYMENT_VOUCHER` → بادئات **BRV** / **BPV** |
| `bank_account_id` | حساب بنكي تشغيلي |
| `counter_account_id` | حساب مقابل ترحيلي (ليس GL البنك) |
| `cost_center_id` | إلزامي إن اشترط أحد الحسابات |
| `amount` / `currency_code` | العملة تطابق عملة الحساب البنكي |
| `journal_entry_id` / `reversal_journal_entry_id` | قيد الترحيل والعكس |
| `version` + `updated_at` | تفاؤل التزامن |

توسيع `document_sequences` لأنواع BRV/BPV، مع `createDefaultSequencesForYear` التي تتضمن بالفعل:

- `BANK_RECEIPT_VOUCHER` → `BRV`
- `BANK_PAYMENT_VOUCHER` → `BPV`

---

## قواعد القيود المحاسبية

| النوع | مدين | دائن |
|-------|------|------|
| قبض (`BANK_RECEIPT`) | GL الحساب البنكي | الحساب المقابل |
| صرف (`BANK_PAYMENT`) | الحساب المقابل | GL الحساب البنكي |

- الترحيل داخل معاملة مع `acquireBanksLock` + محرك القيود.
- `source_type` = نوع السند · `source_id` = معرف السند · `entry_type` = `RECEIPT` / `PAYMENT`.
- منع: حساب غير ACTIVE · تعطيل مصرف/فرع · `allows_receipts/payments = false` · عملة مختلفة · مقابل = GL البنك · حساب تجميعي/غير ترحيلي · صرف بمبلغ أكبر من الرصيد الدفتري المتاح.
- تزامن الصرف: قفل صفوف سندات الحساب + فحص الرصيد داخل القفل؛ صرفان متزامنان لا يجوز أن يُرجعا رصيداً سالباً.

## سياسة الرصيد الدفتري

- المصدر: أسطر قيود `POSTED` على `gl_account_id` فقط (`calculateBankAccountBookBalance` / `getAccountBookBalance`).
- **`opening_balance_reference` مرجعي للعرض ولا يدخل الرصيد الدفتري.**
- المسودات لا تؤثر. إلغاء POSTED عبر قيد عكسي يعيد الأثر الصافي.

## الحالات

| الحالة | التعديل | الترحيل | الإلغاء |
|--------|---------|---------|---------|
| DRAFT | نعم | نعم | نعم (بدون قيد) |
| POSTED | لا | idempotent إن وُجد قيد | نعم + قيد عكسي |
| VOID | لا | لا | idempotent |

ربط العكس: `journal_entries.reversal_entry_id` على الأصل و`reverses_entry_id` + `is_reversal` على العكسي.

## الصلاحيات

1. **دخول النظام:** `requireAccountsAccess` (توكن + نظام `ACCOUNTS`) → 401 / 403.
2. **على الحساب البنكي** عبر `bank_account_users`:
   - `can_view` · `can_prepare` (إنشاء/تعديل مسودة) · `can_post` (ترحيل/إلغاء مرحّل)
3. **تجاوز privileged:** أسماء المستخدم `accounts` أو `admin` (و`superadmin` / `super_admin`) عبر `isAccountsPrivilegedUser` — لا يحتاجون صفاً في `bank_account_users`.
4. **IDOR:** مستخدم ACCOUNTS بلا تعيين على `bank_account_id` → 403 عند الإعداد/الترحيل.
5. خيارات العمليات تعرض حسابات **ACTIVE** فقط (لا `SUSPENDED`/`CLOSED`).

## APIs

| طريقة | مسار |
|--------|------|
| GET/POST | `/api/accounts/bank-vouchers` |
| GET | `/api/accounts/bank-vouchers/options` |
| GET/PATCH/DELETE | `/api/accounts/bank-vouchers/[id]` |
| POST | `/api/accounts/bank-vouchers/[id]/post` |
| POST | `/api/accounts/bank-vouchers/[id]/void` |

تدقيق: `bank_voucher.created|updated|posted|voided|deleted`.

## الواجهة والطباعة

- `/accounts/banks/vouchers` — قائمة وفلاتر وإنشاء
- `/accounts/banks/vouchers/[id]` — تفاصيل · تعديل DRAFT · ترحيل/إلغاء · **طباعة** (`print-container`)

## Seed

`npm run seed:accounts-demo` (idempotent):

- تعيين مستخدم على `DEMO-BA-IQD` بـ view/prepare/post
- `DEMO-BV-RECEIPT` مرحّل ≈ 5000 (مقابل DEMO-GAIN)
- `DEMO-BV-PAYMENT` مرحّل ≈ 1000 (مقابل DEMO-LOSS)
- `DEMO-BV-DRAFT` مسودة
- روابط طباعة: `/accounts/banks/vouchers/{id}`

## الاختبارات

```bash
npm run test:bank-vouchers
```

يغطي إنشاء/تعديل/ترقيم · قيود التشغيل · ترحيل اتجاهي · رصيد غير كافٍ · تزامن صرف · idempotency · إلغاء DRAFT/POSTED · ربط العكس · رصيد POSTED فقط · opening_ref · صلاحيات وIDOR وauth · تدقيق · طباعة · smoke لجداول النقد/البنوك.

## Acceptance Criteria

- [ ] BRV/BPV في `createDefaultSequencesForYear` وmigration 068
- [ ] قبض: مدين بنك / دائن مقابل · صرف: العكس
- [ ] رصيد دفتري = قيود POSTED فقط؛ opening_ref لا يؤثر
- [ ] صلاحيات + تجاوز `accounts`/`admin` · 401/403 صحيحان
- [ ] VOID مرحّل يُنشئ قيداً عكسياً مرتبطاً
- [ ] Seed DEMO ونجح `test:bank-vouchers`
- [ ] واجهة قائمة/تفاصيل/طباعة عربية

## سيناريو العرض أمام العميد (≈5 دقائق)

1. فتح `/accounts/banks` → الحساب `DEMO-BA-IQD`.
2. الانتقال إلى `/accounts/banks/vouchers` وإظهار قبض DEMO مرحّل (~5000) وصرف (~1000).
3. فتح مسودة `DEMO-BV-DRAFT` وشرح دورة DRAFT → ترحيل.
4. عرض قيد اليومية المرتبط واتجاه المدين/الدائن.
5. طباعة سند من صفحة التفاصيل (`print-container`).
6. التأكيد: لا تحويلات/شيكات بعد — هذه مرحلة سندات بنكية فقط.
