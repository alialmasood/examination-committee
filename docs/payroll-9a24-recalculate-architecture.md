# 9.A.2.4 — Payroll Recalculate Architecture

> **الحالة:** Architecture ACCEPTED  
> **Baseline المعتمد:** `4dacb95` (9.A.2.3.2 ACCEPTED)  
> **المراحل المجمدة:** 9.A.1 · 9.A.2.1 · 9.A.2.2 · 9.A.2.3.1 · 9.A.2.3.2  
> **Migrations Frozen:** 094 · 095 · 096  
> **Idempotency:** `request_key_hash` + `request_payload_hash` (SHA-256) — لا مطابقة عبر masked key  
> **بلا Code في مرحلة الاعتماد · التنفيذ يبدأ 9.A.2.4.1 بأمر صريح**

---

## 0. ملخص تنفيذي

| بند | القرار النهائي |
|-----|----------------|
| النموذج | **نفس Run** (D25) — لا Revision Run — لا `revision_number++` |
| الحالة المسموحة | `CALCULATED` فقط (+ حواجز lifecycle مستقبلية) |
| اللقطة | حذف داخل Tx ثم إعادة بناء من المصادر الحية |
| الفشل | Rollback → Run يبقى `CALCULATED` باللقطة السابقة |
| التاريخ | **Historical Recalculation Summary** عبر Audit (قبل/بعد) — **ليس** Full Snapshot Archive |
| Capability | **`payroll_recalculate`** (منفصلة عن `payroll_calculate`) |
| Migration 097 | **لا** — ما دامت Audit JSONB كافية (مثبت أدناه) |

---

## 1. هدف Recalculate

تمكين استبدال نتائج تشغيل محتسب (`CALCULATED`) بنتائج جديدة بعد تغيّر المصادر، مع:

1. الإبقاء على هوية التشغيل (`id` · `run_number` · النطاق · الفترة · العملة · `calculation_date`).  
2. سجل Audit تاريخي مستقل لكل إعادة ناجحة (قبل/بعد) — غير قابل للتعديل.  
3. ذرّية كاملة: لا حذف يُلتزم بلا بناء بديل.  
4. عدم فتح سلسلة Revision / اعتماد / ترحيل / دفع.

**خارج النطاق:** Approval · Posting · Payments · Payslips مقفلة · Full Snapshot Archive · تعديل 094–096 · Revision Run.

---

## 2. القرار النهائي لنموذج Recalculate (D25)

| قرار | تفصيل |
|------|--------|
| نفس Run | نعم |
| Revision Run جديد | لا |
| `revision_number` | لا يزيد |
| نسخ Run | لا |
| هوية التشغيل | ثابتة |
| Audit | كل Recalculate ناجح ⇒ سجل مستقل before/after |

أعمدة سلسلة الإصدار في 095 (`root_run_id` · `supersedes_*` · `revision_reason`) **لا تُستخدم** في هذا المسار.

---

## 3. Eligibility — متى يُسمح / يُمنع

### 3.1 مسموح فقط إذا

| # | الشرط |
|---|--------|
| E1 | `run.status = CALCULATED` |
| E2 | المستخدم يملك **`payroll_recalculate`** |
| E3 | `version` و `updated_at` مطابقان |
| E4 | `confirmation === true` |
| E5 | `reason` صالح (§4) |
| E6 | `idempotency_key` صالح (§9) |
| E7 | لا عملية أخرى قيد التنفيذ على Run (`CALCULATING` مرفوض) |
| E8 | الفترة `OPEN` أو `PROCESSING` |
| E9 | `calculation_date` داخل نطاق الفترة |
| E10 | عملة Run/Period = IQD (سياسة الإصدار) |
| E11 | PERSON_LIST غير فارغة إن كان النطاق PERSON_LIST |
| E12 | **لم يُعتمد** التشغيل (حارس مستقبلي) |
| E13 | **لم يُرحَّل** إلى الأستاذ العام (حارس مستقبلي) |
| E14 | **لم تبدأ** عملية دفع (حارس مستقبلي) |
| E15 | **لم تصدر** قسائم نهائية مقفلة (حارس مستقبلي) |

E12–E15: الحالات غير موجودة في CHECK 095 اليوم. تُنفَّذ كدوال حارس في الكود ترجع `false`/تمرّ حاليًا، وتُفعَّل عند إدخال الحالات لاحقًا **بدون اختراع الحالات في 095 الآن**.

### 3.2 جدول الحالات

| Status | Recalculate؟ |
|--------|--------------|
| `DRAFT` | ❌ — استخدم `/calculate` |
| `CALCULATING` | ❌ — 409 |
| `CALCULATED` | ✅ — المسار الوحيد الحالي |
| `CANCELLED` | ❌ |
| `UNDER_REVIEW` (مستقبلي) | ❌ |
| `APPROVED` (مستقبلي) | ❌ |
| `POSTED` (مستقبلي) | ❌ |
| `PARTIALLY_PAID` (مستقبلي) | ❌ |
| `PAID` (مستقبلي) | ❌ |

**لا تُضاف هذه الحالات إلى Migration 095.** يُوثَّق الحارس المستقبلي في الكود/التوثيق فقط.

### 3.3 Capability

```
payroll_recalculate
```

- **لا** تُمنح تلقائيًا عبر `payroll_calculate`.  
- في سياسة المرحلة الحالية: تُضاف إلى مجموعة **Accounts Admin** فقط (مثل calculate/cancel)، ما لم تُقرّ سياسة أوسع لاحقًا.  
- التحقق عبر `assertPayrollCapability` — لا اعتماد على اسم دور خام في الـ Route.

---

## 4. سياسة السبب (reason)

| قاعدة | القيمة |
|-------|--------|
| إلزامي | نعم |
| بعد `trim` | ≥ **10** أحرف |
| الحد الأقصى | **500** حرف |
| فارغ / مسافات فقط | 400 |
| نصوص عامة جدًا (قائمة رفض اختيارية لاحقًا) | مثل «تعديل» وحدها — تُرفض إن طُبّقت قائمة blocklist في التنفيذ |
| التخزين | **Audit فقط** (`description` و/أو `new_values.reason`) |
| داخل Snapshot hash | **لا** |
| محرك الصيغ | **لا** |
| بطاقة الشخص / القسيمة | **لا** |

أمثلة مقبولة: تعديل الراتب الأساسي · إضافة مخصصات · تصحيح مركز كلفة · تحديث عقد.

---

## 5. Transaction — حذف وإعادة بناء

### 5.1 التسلسل الإلزامي (Tx واحدة)

1. قفل **Period** ثم قفل **Run** `FOR UPDATE` (ترتيب ثابت كالنمط الحالي).  
2. تحقق status / version / updated_at / ownership / capability / lifecycle guards.  
3. تحقق Idempotency (§9) — إن replay ⇒ أعد النتيجة **قبل أي حذف**.  
4. **Run-level validations** الممكنة قبل المسح: IQD · PERSON_LIST غير فارغة · فترة · تواريخ.  
   - أي 422 هنا ⇒ **لا حذف** · Run يبقى CALCULATED باللقطة السابقة.  
5. قراءة ملخص اللقطة الحالية إلى متغيرات Tx (**Before**):  
   hash · people/error/warning counts · totals · `calculated_at` · `last_calculation_request_id`.  
6. (اختياري داخل Tx) الانتقال إلى `CALCULATING` فقط إذا بقي متوافقًا مع CHECK 095 ولا يكسر فهارس النطاق الحيّ — الهدف إظهار القفل التشغيلي؛ عند الفشل Rollback يعيد CALCULATED السابق.  
7. حذف بالترتيب الآمن لـ FKs:  
   - `payroll_run_issues`  
   - `payroll_run_lines`  
   - `payroll_run_people`  
8. إعادة البناء عبر **Calculation Core** (Resolve + صيغ + Persist) وفق `calculation_date` نفسه.  
9. حساب totals / hashes الجديدة.  
10. تحديث Run → `CALCULATED` + totals + `snapshot_hash` + `calculated_at`/`calculated_by` + request ids + `version++`.  
11. كتابة Audit نجاح **before/after** داخل نفس Tx.  
12. Commit.

**لا حذف خارج Transaction.**

### 5.2 CALCULATING داخل المعاملة

مسموح كحالة وسيطة داخل Tx (موجودة في 095). عند Rollback لا تُلتزم.  
إن ظهر تعارض مع قيود النطاق الحيّ أثناء التنفيذ، يُعالَج في Core بحيث المسح+الإعادة ذرّيان تحت قفل Run.

### 5.3 ترتيب الحذف

مطابق لـ FKs 096: Issues → Lines → People (لا عكس).

---

## 6. حدود التاريخ المحفوظ

### 6.1 ما هي هذه المرحلة؟

**Historical Recalculation Summary** — وليست Full Historical Snapshot Archive.

يمكن معرفة:

- من أعاد الاحتساب · متى · لماذا  
- previous/new hash  
- previous/new counts & totals  

**لا يمكن** إعادة عرض Lines/Issues/People المحذوفة للنسخة السابقة.

هذا مقبول **فقط** لأن Recalculate ممنوع بعد Approval/Posting.

### 6.2 مشروع منفصل (خارج 9.A.2.4)

`Payroll Calculation Revisions / Snapshot Archive` — إن طُلب استعراض كل نسخة تفصيلية لاحقًا.

### 6.3 حقل `calculation_attempt_number`

موجود فعليًا في 095. يُسمح بزيادته عند كل Recalculate حقيقي (وليس replay) كعدّاد تشغيلي على الصف — **دون** اختراع جدول attempts منفصل.  
في الوثائق/الـ API يُفضَّل وصفه كـ «رقم تسلسل عملية الاحتساب على التشغيل» وربطه باسم العمود الفعلي، لا كمفهوم «attempt table».

---

## 7. Audit — الحقول المطلوبة

### 7.1 قدرة البنية الحالية (إثبات)

جدول `accounts.financial_audit_log` (058):

| عمود | يكفي لـ |
|------|---------|
| `user_id` | actor_id |
| `action` | تمييز الحدث |
| `entity_type` / `entity_id` | payroll_run / run_id |
| `old_values` JSONB | **Before summary** |
| `new_values` JSONB | **After summary** + metadata |
| `description` | reason (مقصوص) |
| `created_at` | timestamp |
| `ip_address` / `user_agent` | اختياري |

**الخلاصة:** يمكن حفظ كل ملخص Recalculate المطلوب **بلا Migration 097**.

### 7.2 أحداث مقترحة (نمط المشروع)

| action | متى |
|--------|-----|
| `payroll_run.recalculation_started` | داخل Tx بعد اجتياز الفحوص وقبل/مع بدء المسح (يختفي عند Rollback) |
| `payroll_run.recalculated` | داخل Tx عند النجاح — السجل التاريخي الإلزامي |
| `payroll_run.recalculation_blocked` | best-effort خارج Tx لـ 422 قبل المسح |
| `payroll_run.recalculation_failed` | best-effort خارج Tx بعد Rollback لـ 500 |

### 7.3 محتوى `recalculated` (إلزامي)

**old_values (Before):**

- `snapshot_hash`  
- `people_count` · `error_count` · `warning_count`  
- `gross_total` · `deduction_total` · `employer_contribution_total` · `net_total` (decimal strings)  
- `calculated_at`

**new_values (After + meta):**

- `snapshot_hash`  
- `people_count` · `error_count` · `warning_count`  
- `gross_total` · `deduction_total` · `employer_contribution_total` · `net_total`  
- `calculated_at`  
- `payroll_period_id`  
- `reason` (أو الاعتماد على `description`)  
- `idempotency_key_masked` / hashed  
- `source_action: "RECALCULATE"`  
- `calculation_request_id` (UUID المخزَّن بعد map — ليس المفتاح الخام)

**description:** نص السبب (≤500).

### 7.4 ممنوع في Audit

raw snapshots · كل Lines القديمة · بيانات مصرفية · عقد كامل · SQL · stack · request body كامل · idempotency key خام.

### 7.5 استقلالية السجل

كل Recalculate بمفتاح جديد وسبب جديد ⇒ صف Audit **جديد** حتى لو تطابق hash الجديد مع السابق.

Replay ⇒ **لا** Audit نجاح مكرر.

---

## 8. تغيّر المصادر عند Recalculate

لا تُعاد استخدام Snapshot القديمة. تُعاد قراءة المصادر الحية وفق **`calculation_date` نفسه** (لا يتغير أثناء Recalculate):

شخص · نطاق · Assignments · Department · College · Cost Center · عقد · base_amount · عملة · Component Assignments · قيم · effective dates · حالة المكوّنات.

قد ينتج: إضافة/إزالة شخص · EXCLUDED · ERROR · تغيّر عقد/basic/lines/totals/hashes.

إن تغيّرت حقول Run/Period المؤثرة بعد CALCULATED بطريقة غير مشروعة: **رفض Recalculate أو كشفها عبر Verify** — لا تصحيح صامت.

---

## 9. Scope — إعادة الحل

### 9.1 ALL / COLLEGE / DEPARTMENT / COST_CENTER

إعادة **Resolve كاملة** للأشخاص من المصادر الحالية وفق `calculation_date` وسياسة الأهلية المعتمدة (بما فيها COST_CENTER = تكليف فعّال فقط).

### 9.2 PERSON_LIST — القرار النهائي

| بند | قرار |
|-----|------|
| أعضاء `payroll_run_scope_members` | **تبقى كما هي** — لا حذف/إعادة إنشاء أثناء Recalculate |
| الأهلية | يُعاد فحص كل عضو |
| غير مؤهل | `EXCLUDED` أو `ERROR` وفق سياسة Core الحالية (`SCOPE_PERSON_INELIGIBLE` → EXCLUDED) |
| قائمة فارغة | **422 قبل حذف اللقطة** — النتيجة السابقة تبقى |

تعديل قائمة الأعضاء يبقى عبر APIs النطاق وفقط في `DRAFT` (Immutability الحالية).

---

## 10. Idempotency — Semantics دقيقة (معتمدة نهائيًا)

### 10.1 Namespace

| العملية | Namespace |
|---------|-----------|
| Calculate | `payroll-calc:` |
| Recalculate | `payroll-recalc:` |

مفاتيح العمليتين **منفصلة** — نفس النص الخام لا يتصادم.

### 10.2 Fingerprints (قرار نهائي — لا masked key للمطابقة)

**لا** تُستخدم قيمة masked للمطابقة أو كشف التعارض.

```
request_key_hash =
  SHA-256( "payroll-recalc:" + normalized_idempotency_key )
  → lowercase hex (64)

request_payload_hash =
  SHA-256( canonical_json({
    operation: "RECALCULATE",
    run_id,
    reason: normalized_reason,
    expected_version,
    expected_updated_at
  }) )
  → lowercase hex (64)
```

**التطبيع:**

| حقل | قاعدة |
|-----|--------|
| idempotency key | `trim` فقط + حدود الطول (1..128) |
| reason | `trim` · توحيد `\r\n`/`\r` → `\n` · طي المسافات المتتالية الأفقية إلى مسافة واحدة (حتمي) · بدون NUL/control غير مسموح |
| updated_at | ISO canonical (نفس تمثيل التزامن المستخدم في النظام) |
| JSON | مفاتيح بترتيب ثابت · UTF-8 · بلا مسافات زائدة في التسلسل الكانوني |
| Hash | SHA-256 · **lowercase hex** |

**Audit يخزّن:**

- `request_key_hash` كاملًا  
- `request_payload_hash` كاملًا  
- `request_key_masked` للعرض فقط  
- `source_action = "RECALCULATE"`  

**لا** يُسجَّل idempotency key الخام.

### 10.3 Semantics

| الحالة | النتيجة |
|--------|---------|
| نفس `request_key_hash` + نفس `request_payload_hash` | **Idempotent replay** · لا حذف · لا إعادة حساب · لا Audit نجاح جديد · لا `version++` · لا `updated_at` جديد · يُعاد ملخص النتيجة الحالية المتوافقة |
| نفس `request_key_hash` + `request_payload_hash` مختلف | **409 IDEMPOTENCY_CONFLICT** |
| `request_key_hash` جديد | Recalculate جديد مسموح إن بقي Run مؤهلًا |

### 10.4 Lookup قبل أي حذف

البحث في `financial_audit_log` عن نجاح Recalculate سابق لنفس:

- `entity_type = payroll_run` · `entity_id = run_id`  
- `action = payroll_run.recalculated` (أو المكافئ)  
- `new_values.request_key_hash` = المحسوب  
- `new_values.source_action = RECALCULATE`

إن وُجد و`request_payload_hash` مطابق وAudit مكتمل (يحوي `new_snapshot_hash`) والحالة الحالية متوافقة ⇒ Replay.  
إن وُجد وpayload مختلف ⇒ 409.  
إن Audit فاسد/ناقص ⇒ رفض integrity آمن — **لا** replay صامت ولا حذف.  
إن لم يوجد ⇒ تابع.

### 10.5 حقول Run 095

- `calculation_request_id` / `last_calculation_request_id` (UUID): تُشتق من fingerprint عبر mapping مستقر (مثل أخذ بايتات من `request_key_hash` إلى UUID v4-shaped) **للاتساق مع Calculate** — وليست مصدر الحقيقة لإعادة التشغيل.  
- مصدر الحقيقة للـ replay/conflict = **Audit + request_key_hash / request_payload_hash**.

### 10.6 لا Migration 097

Fingerprints تُخزَّن في JSONB للـ Audit. لا أعمدة جديدة.

---

## 11. Concurrency

| سباق | النتيجة |
|------|---------|
| Recalculate × Recalculate | واحد ينجح؛ الآخر 409 |
| Recalculate × Calculate | Calculate 409 (ليس DRAFT) أو replay إن نفس منطق المفتاح |
| Recalculate × Cancel | A: CALCULATED جديد + Cancel يفشل · أو B: CANCELLED + Recalculate يفشل |
| Recalculate × Update Run | Update مرفوض على غير DRAFT؛ أو 409 stale |
| Recalculate × Scope members | تعديل الأعضاء DRAFT-only أصلًا ⇒ 409 |
| Recalculate × Approval/Posting (مستقبلي) | الحارس يمنع Recalculate أو العملية الأخرى بـ 409 |

ضمانات: فائز واحد · 409 واضح · لا deadlock ظاهر للعميل · لا artifacts مزدوجة · لا لقطة مختلطة · لا حذف ملتزم بلا بناء · قفل Period ثم Run.

---

## 12. Versioning و Optimistic Locking

### Request

```json
{
  "version": 4,
  "updated_at": "<iso>",
  "idempotency_key": "<≤128>",
  "reason": "<10..500>",
  "confirmation": true
}
```

### قبل أي حذف

تحقق: version · updated_at · status · آخر request id (idempotency) · access · lifecycle locks المستقبلية.

### عند نجاح Recalculate حقيقي

- `version` يزيد وفق نمط المشروع  
- `updated_at` يتغير  
- `calculated_at` / `calculated_by` يتحدّثان  
- `snapshot_hash` قد يتغير أو يبقى إن تطابقت المصادر — **مسموح**  
- Audit جديد إلزامي (مفتاح جديد + سبب جديد)

### عند Replay

لا تغيير version / updated_at / totals / hash / Audit نجاح.

---

## 13. سياسة Hash

- يُبنى من اللقطة الجديدة فقط (نفس خوارزمية 9.A.2.2/3).  
- **لا يدخل:** previous hash · reason · actor · request id · audit · timestamp · عدّاد العمليات على التشغيل.  
- نفس المصادر + نفس `calculation_date` ⇒ **نفس hash** حتى بعد Recalculate.

---

## 14. الأخطاء

| النوع | السلوك |
|-------|--------|
| Run-level blocking قبل المسح (422) | CALCULATED السابق يبقى · لا حذف · لا hash جديد · `recalculation_blocked` best-effort |
| Technical بعد بدء Tx | Rollback · اللقطة القديمة كاملة · 500 sanitized · `recalculation_failed` خارج Tx إن لزم |
| Person-level business | لا تمنع اكتمال Recalculate · شخص ERROR · Run CALCULATED · `error_count` قد > 0 · Posting يبقى ممنوعًا |

---

## 15. API المقترحة

```http
POST /api/accounts/payroll/runs/[id]/recalculate
```

**Capability:** `payroll_recalculate`

**Body:** كما §12.

**Status codes:** 400 · 403 · 404 · 409 · 422 · 500 · 200 (نجاح أو replay).

**Response:** مشابه لـ Calculate مع `"source_action": "RECALCULATE"` و decimal strings.

Route رفيع → `recalculatePayrollRunCore` (مشاركة منطق البناء مع Calculate عبر استخراج داخلي مفضّل).

---

## 16. UI المقترحة

- زر **إعادة احتساب الرواتب** فقط عند: `CALCULATED` + `payroll_recalculate` + لا lifecycle lock.  
- ConfirmDialog: تحذير الاستبدال · إعادة قراءة العقود/المكوّنات · سبب إلزامي · تحذير IQD · منع double submit · loading.  

**النص المقترح:**

> سيعيد النظام قراءة بيانات الموظفين والعقود والمخصصات والاستقطاعات وفق تاريخ الاحتساب، ثم يستبدل نتائج التشغيل الحالية بنتائج جديدة. ستبقى معلومات العملية السابقة محفوظة في سجل التدقيق، لكن لن تبقى تفاصيل أسطرها قابلة للعرض.

رسائل 409/422/500 عربية. لا زر Posting.

---

## 17. Verify

| فحص | قابل للكشف الآن؟ |
|-----|------------------|
| نجاح Recalculate بلا previous/new hash في Audit | ✅ عبر JSONB |
| نقص totals قبل/بعد في Audit | ✅ |
| entity_id لا يطابق Run | ✅ |
| تكرار success لنفس request id | ✅ عدّ Audit |
| same key بنتائج تشغيل متضاربة مع replay | جزئي — عبر request id + حالة Run |
| CALCULATED بلا snapshot_hash | ✅ (core verify) |
| totals ⊭ artifacts | ✅ |
| artifacts جزئية / CALCULATING عالق | ✅ |
| last request id ⊭ آخر نجاح | ✅ |
| Audit reason فارغ | ✅ |
| Recalculate بعد Approval/Posting | ✅ عندما تُضاف الحالات + الحارس |
| غير IQD artifacts | ✅ |
| ERROR بلا blocking issue | ✅ |
| تلاعب PERSON_LIST أثناء Recalculate | جزئي — مقارنة عدد الأعضاء قبل/بعد إن وُثّق في اختبارات؛ Verify بنيوي: لا يُفترض تغيير members من مسار Recalculate |

Verify مقترح: امتداد integration أو `verify-payroll-recalculate` — UI-agnostic.

---

## 18. Acceptance Tests (الحد الأدنى)

1. نجاح مع تغيّر `base_amount`  
2. تغيّر مبلغ Component  
3. إضافة Component  
4. انتهاء Component Assignment  
5. دخول شخص للنطاق تلقائيًا  
6. خروج شخص من النطاق  
7. عضو PERSON_LIST غير مؤهل → EXCLUDED  
8. Multiple contracts بعد الاحتساب الأول  
9. Currency mismatch بعد الاحتساب الأول  
10. نفس المصادر → نفس hash  
11. تغيّر مصادر → تغيّر hash  
12. totals قديمة/جديدة في Audit  
13. reason محفوظ  
14. same key → replay  
15. new key → Recalculate آخر مسموح  
16. same key + payload مختلف → 409  
17. stale version  
18. stale updated_at  
19. من DRAFT ممنوع  
20. من CANCELLED ممنوع  
21. PERSON_LIST فارغة لا تحذف اللقطة  
22. عملة غير مدعومة لا تحذف اللقطة  
23. فشل تقني بعد delete → Rollback للقديمة  
24–27. failpoints: بعد person · بعد line · قبل hash · أثناء Audit  
28. Recalculate×Recalculate  
29. Recalculate×Cancel  
30. لا duplicate artifacts  
31. لا partial Audit نجاح  
32. IDOR  
33. بلا capability  
34. أخطاء معقّمة  
35. cleanup = 0 ×2  
36. Verifies normal/strict  

---

## 19. Migration 097

### القرار: **لا Migration 097**

لأن:

1. Audit JSONB يحمل before/after بالكامل.  
2. `calculation_request_id` / `last_calculation_request_id` كافيان مع namespace للمفاتيح.  
3. `payroll_recalculate` صلاحية كودية لا تحتاج جدولًا.  
4. الحالات المستقبلية تُحرس في الكود دون توسيع CHECK الآن.

### متى يُفتح Gap ويُوقف التنفيذ؟

إذا ثبت أثناء التنفيذ أن:

- قراءة Audit لتعارض reason غير موثوقة/غير مقبولة للأداء، **و**  
- رُفض سلوك replay المتساهل،

⇒ **توقف · Gap Report · خياران:** (1) replay متساهل · (2) أصغر 097 لبصمة الحمولة — **دون إنشاء Migration تلقائيًا**.

---

## 20. تقسيم التنفيذ

### 9.A.2.4.1 — Recalculate Core

Eligibility · reason · idempotency · locks · atomic delete/rebuild · before/after summary · audit payload builder · rollback · verify · core tests.  
**بلا API/UI.**

### 9.A.2.4.2 — API / UI / Audit Integration

Endpoint · capability · confirm · reason field · refresh نتائج · HTTP/UI tests · IDOR · docs.

---

## 21. المخاطر

| خطر | تخفيف |
|-----|--------|
| فقدان Lines القديمة | مقبول ومُعلن في UI؛ ممنوع بعد Posting |
| سباق Cancel | اختبارات + أقفال؛ A أو B فقط |
| تعارض H7 | مسار Recalculate صريح فقط للمسح تحت CALCULATING/Tx |
| اختلاط calc/recalc keys | namespace `payroll-recalc:` |
| اعتماد Approval مبكر | حراس E12–E15 |

---

## 22. قرارات مرقّمة (بعد المراجعة)

| ID | القرار |
|----|--------|
| R0 | D25 نفس Run |
| R1 | CALCULATED فقط + حواجز مستقبلية |
| R2 | Capability = `payroll_recalculate` مستقلة |
| R3 | reason ≥10 ≤500 · Audit فقط |
| R4 | Delete issues→lines→people داخل Tx ثم rebuild |
| R5 | فشل ⇒ CALCULATED السابق سليم |
| R6 | Historical Summary عبر Audit — لا أرشفة لقطة كاملة |
| R7 | PERSON_LIST: أعضاء ثابتون · إعادة فحص أهلية · فارغة ⇒ 422 قبل المسح |
| R8 | Idempotency: `request_key_hash` + `request_payload_hash` (SHA-256) · replay / conflict 409 / مفتاح جديد |
| R9 | Namespace `payroll-calc:` vs `payroll-recalc:` · لا مطابقة عبر masked |
| R10 | لا 097 ما دامت Audit كافية |
| R11 | Hash من اللقطة فقط — reason خارج hash |
| R12 | تقسيم 9.A.2.4.1 / 9.A.2.4.2 |

---

## 23. معايير اعتماد المعمارية

- [x] اعتماد R0–R12  
- [x] اعتماد `payroll_recalculate` مستقلة  
- [x] اعتماد fingerprints: `request_key_hash` + `request_payload_hash` (لا masked للمطابقة)  
- [x] تأكيد لا 097  
- [ ] إذن بدء 9.A.2.4.1 بعد Approval ← **ACCEPTED — التنفيذ جارٍ**

---

*نهاية Architecture 9.A.2.4 — ACCEPTED. التنفيذ: 9.A.2.4.1 Core ثم 9.A.2.4.2 Integration.*
