# Execution Plan — المرحلة 5.A
## Student Accounts & Receivables Foundation  
### تأسيس حسابات الطلبة والذمم المدينة

| الحقل | القيمة |
|--------|--------|
| **الإصدار** | 1.0 |
| **التاريخ** | 14 تموز 2026 |
| **الحالة** | Backend + UI + Seed + Tests |
| **Migration** | `075_student_accounts_receivables.sql` |
| **Baseline سابق** | Bank Reconciliation 4.D |

---

## 1) نطاق المرحلة / Scope

**داخل النطاق**
- حساب مالي واحد لكل طالب/عملة (`accounts.student_accounts`) مرتبط بـ `student_affairs.students`
- أنواع رسوم (`student_fee_types`) بحساب إيراد REVENUE
- مطالبات DRAFT → POSTED → VOID مع قيد مدين ذمم / دائن إيراد
- دفتر فرعي تشغيلي (`student_ledger_entries`)
- تسلسل STA / SCH، أقفال محاسبية، Audit، تحقق Subledger ↔ GL
- واجهة `/accounts/students/*` وSeed DEMO

**خارج النطاق (5.B+)**
- تحصيل/قبض على الذمم · أقساط · تخصيم · تعدد عملات · FX · تسوية جزئية متقدمة

---

## 2) قرار دفتر الذمم / Subledger

- **Student Ledger** = دفتر فرعي تشغيلي للحساب المالي للطالب.
- **مصدر الحقيقة SoT** = قيود `journal_entries` بحالة `POSTED`.
- `opening_reference` على الحساب مرجعي فقط ولا يدخل في الرصيد.
- الرصيد = `Σ(debit − credit)` من `student_ledger_entries` باستثناء `OPENING_REFERENCE`.

---

## 3) علاقة الدليل / GL relationship

| الدور | النوع | قيد الترحيل |
|--------|--------|-------------|
| ذمم الطلبة | ASSET ترحيلي (ليس صندوق/بنك) | **مدين** عند CHARGE |
| إيراد الرسوم | REVENUE ترحيلي | **دائن** عند CHARGE |
| العكس VOID | نفس الحسابات | قيد عكسي بتاريخ `charge_date` |

التحقق: `verifyStudentReceivables` يقارن مجموع الدفتر الفرعي بمجموع أرصدة POSTED على كل `receivable_gl_account_id` مستخدم.

---

## 4) حالات الحساب / Account statuses

`ACTIVE` → `SUSPENDED` → `ACTIVE`  
`ACTIVE|SUSPENDED` → `CLOSED` (رصيد صفر + لا مسودات + صلاحية Accounts Admin)

المعلق/المغلق: لا مطالبات جديدة.

---

## 5) حالات المطالبة / Charge statuses

`DRAFT` → `POSTED` → `VOID`  
`DRAFT` → `VOID` (بدون قيد)  
`PARTIALLY_SETTLED` / `SETTLED` محجوزان لـ 5.B — VOID مرفوض عليهما في 5.A.

---

## 6) الترقيم والمستندات

| النوع | البادئة | الملاحظة |
|--------|---------|----------|
| STUDENT_ACCOUNT | STA | عبر `document_sequences` + قفل تسلسل |
| STUDENT_CHARGE | SCH | مرتبط بالسنة المالية للمطالبة |

العملة في 5.A: **IQD فقط**.

---

## 7) التزامن والأقفال

عند الترحيل/العكس:
1. قفل صف المطالبة / الحساب / الدفتر
2. قفل حسابات الذمم والإيراد
3. `journalSourceLock(STUDENT_CHARGE|…_REVERSAL)`
4. `acquireJournalEntriesLock` قبل إنشاء القيد

Concurrency متفائل عبر `version` + `updated_at`.

---

## 8) APIs

| المسار | الوظيفة |
|--------|---------|
| `GET/POST /api/accounts/student-accounts` | قائمة / إنشاء |
| `GET/PATCH …/student-accounts/[id]` | تفاصيل / تعديل |
| `POST …/suspend` · `activate` · `close` | دورة الحالة |
| `GET …/ledger` · `summary` | دفتر + ملخص |
| `GET/POST /api/accounts/student-fee-types` | أنواع الرسوم |
| `PATCH …/fee-types/[id]` · `POST …/deactivate` | تعديل / تعطيل |
| `GET/POST /api/accounts/student-charges` | مطالبات |
| `PATCH …/charges/[id]` · `POST …/post` · `POST …/void` | تحديث / ترحيل / إلغاء |
| `GET /api/accounts/student-options` | خيارات الواجهة |

الوصول: `requireAccountsAccess` · إغلاق الحساب: Accounts Admin.

---

## 9) UI

| المسار | المحتوى |
|--------|---------|
| `/accounts/students` | ملخص + تبويبات |
| `/accounts/students/accounts` | قائمة + فلاتر + ترقيم + إنشاء |
| `/accounts/students/accounts/[id]` | تفاصيل + دفتر + مطالبات + إجراءات |
| `/accounts/students/accounts/[id]/print` | كشف حساب للطباعة (`print-container`) |
| `/accounts/students/charges` | قائمة + مسودة + ترحيل/إلغاء |
| `/accounts/students/fee-types` | CRUD + تعطيل |

تنقل الشريط الجانبي: **حسابات الطلبة** مع تفعيل للمسارات المتداخلة.

---

## 10) Seed

`seed-accounts-student-receivables-demo.ts` من `seed:accounts-demo`:

- طلاب `DEMO-STU-001/002/003`
- GL: `DEMO-RECV-GL` · `DEMO-REV-TUITION|REG|LAB`
- رسوم: `DEMO-FEE-TUITION|REG|LAB`
- مطالبات: POSTED / DRAFT / VOID عبر `external_reference`
- روابط طباعة تحت `/accounts/students/accounts/...`

Idempotent بالـ university_id / fee code / external_reference.

**مهم:** `charge_date` / `entryDate` من فترة **OPEN** (غالباً `2026-01-*`) وليس `new Date()` إن كان اليوم خارج الفترات المفتوحة.

---

## 11) الاختبارات

```bash
npm run test:student-receivables
npm run accounts:verify-student-receivables
```

يغطي: طالب فريد DEMO، ذمم/إيراد، تكرار حساب، STA متزامن، مسودة/تحديث/ترحيل أطراف القيد، idempotent، VOID DRAFT/POSTED، تعليق، تعطيل رسم، إغلاق برصيد، verify، 401، صفحة الطباعة.

---

## 12) Acceptance Criteria (ملخص)

- حساب واحد لكل طالب/عملة · STA دون تكرار تحت التزامن  
- Fee type بـ Revenue GL فقط · رفض GL غير صالح  
- ترحيل مدين ذمم / دائن إيراد · لا double posting/subledger  
- VOID مسودة بلا قيد · VOID مرحّل بقيد عكسي + دائن دفتر  
- إغلاق برصيد غير صفري مرفوض  
- verify Subledger ↔ GL  
- Seed idempotent · UI RTL بهوية الحسابات (أحمر/رمادي)  
- TypeScript نظيف لمسارات 5.A

---

## 13) مخاطر معروفة

- مقارنة `verifyStudentReceivables` على **كل** حسابات الذمم المستخدمة؛ قيود يدوية على نفس GL دون دفتر فرعي تكسر التطابق.
- الاعتماد على فترة OPEN لتواريخ المطالبة في بيئات العرض/الاختبار.

---

## 14) Next — 5.B (تحصيلات على الذمم)

- قبض/تسديد جزئي وكامل · ربط سندات قبض/بنك  
- حالات `PARTIALLY_SETTLED` / `SETTLED` التشغيلية  
- تقارير أعمار الذمم · إشعارات · خصومات/منح (حسب القرار المحاسبي)
