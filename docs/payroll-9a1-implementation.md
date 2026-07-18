# تنفيذ أساس الرواتب — 9.A.1 (Payroll Foundation: Schema, Access & Core Registry)

> نقطة الانطلاق: `f8ac935` — المرجع المعماري الملزم: `docs/payroll-9a-architecture-plan.md` (Architecture Frozen).
> هذه الوثيقة توثّق ما نُفّذ فعلياً في الحزمة 9.A.1 فقط.

## 1. النطاق المنفّذ (Scope)

بنية تأسيسية لوحدة الرواتب مستقلة تماماً عن HR، تشمل السجلّ الأساسي فقط دون أي احتساب:

- Migration الأساس `094_payroll_foundation.sql`.
- صلاحيات الرواتب (Capabilities) بأقل امتياز.
- سجلّ الأشخاص، التقاويم، العقود، التكليفات، المكوّنات، إسنادات المكوّنات، خرائط الحسابات.
- Document Sequences للأشخاص/العقود/التكليفات.
- Resource Locks للرواتب بترتيب حتمي.
- خدمات منفصلة + APIs أساسية + واجهات UI أساسية.
- تسجيل التدقيق (Audit) لكل عملية إنشاء/تعديل/انتقال حالة.
- Seed DEMO idempotent.
- Verify تأسيسي (عادي + صارم) + مجموعة اختبارات شاملة.

### النطاق المؤجّل صراحةً (Known Deferred)

Payroll Period processing الكامل، Payroll Runs، Calculation Engine، Review/Approval،
Accounting Posting، Payroll Journal Entries، Payments، Attendance، Lecturer Hours،
Daily Attendance، Advances/Loans، Payroll Batch، Formula Engine، وتنفيذ `CUSTOM_FORMULA`
(محجوز فقط ويُرفض استخدامه برسالة عربية واضحة).

## 2. الجداول المنشأة (schema: `accounts`)

| الجدول | الوصف |
| --- | --- |
| `payroll_calendars` | تقاويم الرواتب (MONTHLY/LECTURER/DAILY/SUMMER/ACADEMIC) — بنية فقط بلا توليد فترات. |
| `payroll_people` | سجلّ أشخاص الرواتب (5 أنواع) مع تأريخ سريان وبيانات مصرفية مقنّعة فقط. |
| `payroll_contracts` | العقد الأساسي لكل شخص (عقد فعّال واحد فقط) + أساس الاستحقاق والحسابات. |
| `payroll_assignments` | مصادر استحقاق/مسؤوليات إضافية (ليست عقداً ثانياً). |
| `payroll_components` | مكوّنات الرواتب (EARNING/DEDUCTION/EMPLOYER_CONTRIBUTION) وطرق الاحتساب. |
| `payroll_component_assignments` | ربط المكوّن بالشخص/العقد/التكليف. |
| `payroll_account_mappings` | خرائط الحسابات المرنة (DEFAULT/PERSON_TYPE/COMPONENT/CALENDAR/ROUNDING). |

## 3. أهم القيود والفهارس

- `uq_payroll_calendars_code`, `uq_payroll_people_code`, `uq_payroll_contracts_number`,
  `uq_payroll_assignments_code`, `uq_payroll_components_code`, `uq_payroll_account_mappings_code` — تفرّد الأكواد.
- `uq_payroll_contracts_one_active` — فهرس فريد جزئي يضمن **عقداً فعّالاً واحداً لكل شخص** على مستوى القاعدة.
- `uq_pca_person_component_source_period` — منع تكرار إسناد المكوّن لنفس (الشخص/المكوّن/المصدر/الفترة).
- قيود `CHECK` لكل Enum (نوع الشخص/الحالة/أساس الاستحقاق/طريقة الاحتساب/نطاق الخريطة/نوع التقويم…).
- قيود `CHECK` على التأريخ: `effective_to` لا يسبق `effective_from`.
- `ON DELETE RESTRICT` للعلاقات الحرجة و`ON DELETE SET NULL` للمراجع الاختيارية (القسم/مركز الكلفة/المستخدم).
- `hr_person_id UUID NULL` **بدون Foreign Key** إلى HR.
- فهارس للقوائم والحالات والتأريخ (status/person_type/payroll_person_id…).
- أنواع Document Sequences الجديدة: `PAYROLL_PERSON`، `PAYROLL_CONTRACT`، `PAYROLL_ASSIGNMENT`.

## 4. الصلاحيات (Capabilities) — أقل امتياز

الملف: `src/lib/accounts/payroll-access.ts` — `PAYROLL_CAPABILITIES` / `getPayrollCapabilities` /
`hasPayrollCapability` / `assertPayrollCapability`.

| القدرة | viewer | clerk | approver | admin |
| --- | :---: | :---: | :---: | :---: |
| `VIEW` | ✓ | ✓ | ✓ | ✓ |
| `MANAGE_PEOPLE` | | ✓ | | ✓ |
| `MANAGE_CONTRACTS` | | ✓ | | ✓ |
| `MANAGE_ASSIGNMENTS` | | ✓ | | ✓ |
| `MANAGE_COMPONENTS` | | | | ✓ |
| `MANAGE_MAPPINGS` | | | | ✓ |
| `ADMIN` (التقاويم) | | | | ✓ |

- العضوية المجرّدة في نظام ACCOUNTS = `VIEW` فقط.
- `MANAGE_COMPONENTS` و`MANAGE_MAPPINGS` و`ADMIN` مقصورة على `accounts_admin` (إعدادات مالية حساسة).

## 5. الأقفال (Resource Locks)

الملف: `src/lib/accounts/payroll-locks.ts` (فوق `acquireAccountingResourceLocks`).
الترتيب المنطقي الموثّق: `Person → Contract → Assignment → Component → Component Assignment → Mapping → Calendar`،
والفرز الحتمي داخل `acquireAccountingResourceLocks` يمنع الـ Deadlock عالمياً. تُستخدم في:
تفعيل/إيقاف العقد، تعديل التأريخ، إنشاء التكليف، تعديل إسناد المكوّن، تحديث الخريطة.

## 6. الخدمات (Services)

`payroll-validation.ts` (تحقق مشترك بلا منطق مرتبط بالنوع)، `payroll-calendars.ts`،
`payroll-people.ts`، `payroll-contracts.ts`، `payroll-assignments.ts`، `payroll-components.ts`،
`payroll-component-assignments.ts`، `payroll-account-mappings.ts`.
كل خدمة: معاملات ACID، تحقق `version` (تزامن متفائل 409)، تمييز 400/403/404/409، رسائل عربية، تدقيق، بلا اعتماد على HR.

## 7. APIs

`/api/accounts/payroll/{people,contracts,assignments,components,component-assignments,calendars,account-mappings}`
مع: `GET`/`POST` للقوائم، `GET`/`PATCH` للعنصر، ومسارات انتقال الحالة
(`activate/suspend/terminate/cancel/deactivate` حسب المورد) + `/options`.
الحماية: فحص الصلاحية لكل عملية، `version` في PATCH والحالات الحساسة، 409 عند التعارض، Pagination/Filters،
عدم إرجاع بيانات مصرفية كاملة، لا حذف فعلي.

## 8. واجهات UI

`/accounts/payroll` (Dashboard مع تنبيه بأن Payroll Runs لاحقاً)، `/people` + `/people/[id]`،
`/contracts`، `/assignments`, `/components`، `/calendars`، `/account-mappings`.
العربية أساس، ConfirmDialog للأفعال الحساسة، حالات Loading/Empty/Error، إخفاء الأزرار غير المصرّح بها،
وتقنيع الحسابات البنكية.

## 9. Zero Hardcoded Payroll Logic

لا يوجد `if (personType === …)` ولا `if (componentCode === …)`. كل السلوك من البيانات
(العقد/التكليفات/المكوّنات/الإسنادات/الخرائط/طريقة الاحتساب/التأريخ). الاستثناءات: تحقق Enum عام،
Labels في UI فقط.

## 10. Seed DEMO

`npm run seed:accounts-payroll-demo` (idempotent): 3 تقاويم، 5 أشخاص، 5 عقود مفعّلة،
3 تكليفات، 9 مكوّنات (استحقاقات/استقطاعات)، إسنادات مكوّنات، 3 خرائط حسابات — بأكواد `DEMO-*` فقط.
**نتيجة التشغيل مرتين:** ناجح دون تكرار (الاختبار #45 يتحقق من ثبات العدد).

## 11. Verify

`npm run accounts:verify-payroll-foundation` و`…:strict`.
يكشف: عقود ACTIVE متعددة، عقد فعّال لشخص غير فعّال، روابط غير متطابقة، تأريخ معكوس،
استخدام `CUSTOM_FORMULA`، خرائط غامضة/بحسابات غير ترحيلية، أكواد مكرّرة، سجلات orphan،
`version` غير صالح، بيانات مصرفية غير مقنّعة، وأنواع Document Sequences الناقصة.
**النتيجة:** عادي وصارم = `ok: true`، 0 mismatches / 0 warnings / 0 unexplained.

## 12. الاختبارات

`npm run test:payroll-foundation` — **47/47 ناجح**. تغطي: الأشخاص (أنواع/حالات/تزامن/تقنيع/عدم كشف مصرفي)،
العقود (تفعيل/عقد واحد فعّال/تزامن تفعيل عقدين/تأريخ/حسابات/عملة/شخص غير فعّال)، التكليفات (تعدد/منع cross-person/حالات/تفرّد)،
المكوّنات (كل طرق الاحتساب/رفض CUSTOM_FORMULA/تفعيل/تفرّد/حسابات/تأريخ)، إسنادات المكوّنات (روابط/منع cross-person/منع عقد+تكليف معاً/قيم سالبة)،
الخرائط (صالحة/غامضة/أولوية/ROUNDING/شكل النطاق/حسابات)، الصلاحيات (أقل امتياز لكل الأدوار)، التدقيق، ثبات البذرة، والتحقق عادي/صارم.

## 13. أوامر التحقق

```bash
npx tsc --noEmit                                    # لا أخطاء
npx eslint <ملفات payroll>                          # 0 errors / 0 warnings
npm run test:payroll-foundation                     # 47/47
npm run accounts:verify-payroll-foundation          # ok
npm run accounts:verify-payroll-foundation:strict   # ok
npm run seed:accounts-payroll-demo                  # مرتين — idempotent
git diff --check                                    # نظيف
```

## 14. الملفات (الجديدة والمعدّلة ضمن النطاق)

**Migration:** `db/migrations/094_payroll_foundation.sql`.

**مكتبة الحسابات (جديد):** `payroll-access.ts`، `payroll-locks.ts`، `payroll-validation.ts`،
`payroll-calendars.ts`، `payroll-people.ts`، `payroll-contracts.ts`، `payroll-assignments.ts`،
`payroll-components.ts`، `payroll-component-assignments.ts`، `payroll-account-mappings.ts`،
`verify-payroll-foundation.ts`.

**مكتبة الحسابات (معدّل — إضافات رواتب فقط):** `accounting-locks.ts`، `audit.ts`،
`document-sequences.ts`، `auth.ts` (رسائل `mapPgError` لقيود الرواتب).

**APIs:** كل ملفات `app/api/accounts/payroll/**`.

**UI:** كل ملفات `app/accounts/payroll/**`.

**Scripts:** `seed-accounts-payroll-demo.ts`، `verify-payroll-foundation.ts`، `test-payroll-foundation.ts` + `package.json`.

## 15. ملاحظات ونطاق مؤجّل

- `CUSTOM_FORMULA` محجوز فقط ويُرفض فعلياً.
- لا FK إلى HR؛ `hr_person_id` مرجع منطقي فقط.
- لا Payroll Runs/Batch/Formula tables في هذه الحزمة.
