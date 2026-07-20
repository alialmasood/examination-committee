# 9.B — Payroll Approval Workflow Architecture

> **الحالة:** Architecture **ACCEPTED WITH FINAL DECISIONS**
> **Baseline المعتمد:** `6101feb` (9.A.2.4.2 ACCEPTED)
> **المراحل المجمدة:** 9.A.1 · 9.A.2.1 · 9.A.2.2 · 9.A.2.3.1 · 9.A.2.3.2 · 9.A.2.4.1 · 9.A.2.4.2
> **Migrations Frozen:** 094 · 095 · 096
> **Migration 097:** مطلوبة للتنفيذ في **9.B.1** (لا تُنشأ في مرحلة الاعتماد المعماري)

---

## 0. القرارات النهائية المعتمدة (مُلزمة)

| بند | القرار النهائي |
|-----|----------------|
| Lifecycle | `DRAFT → CALCULATING → CALCULATED → UNDER_REVIEW → APPROVED` |
| Reject | `UNDER_REVIEW → CALCULATED` (Action `REJECTED` · **ليست** حالة Run) |
| Cancel من UNDER_REVIEW | **ممنوع** في 9.B |
| Cancel من APPROVED | **ممنوع** في 9.B |
| Cancel | يبقى فقط لـ DRAFT / CALCULATED وفق semantics الحالية |
| Status `REJECTED` | **لا يُضاف** |
| Status `POSTED` في CHECK 097 | **لا يُضاف** — مرحلة Posting لاحقًا فقط |
| SoD Submit ≠ Approve | إلزامي · يشمل `accounts_admin` · **لا Override** |
| SoD Submit ≠ Reject | إلزامي · الرفض قرار مراجعة من مستخدم آخر |
| Review Withdrawal | **خارج 9.B** (`REVIEW_WITHDRAWN` مستقبلي) |
| `payroll_reject` | Capability **مستقلة** |
| Submit comment | **اختياري** (0–500 إن وُجد) |
| Approve comment | **اختياري** (0–500) |
| Reject reason | **إلزامي** 10–500 |
| Migration 097 | **مطلوبة** |
| نجاح Workflow | جدول `payroll_run_approval_actions` = Source of Truth |
| Blocked / Failed | `financial_audit_log` فقط |
| Emergency / self-approval | **ممنوع** |

---

## 0.1 ملخص تنفيذي

| بند | القرار |
|-----|--------|
| النموذج | **مرحلتان:** Submit for Review → Approve / Reject |
| الحالات الجديدة في Run | `UNDER_REVIEW` · `APPROVED` |
| REJECTED كحالة Run | **لا** |
| CANCELLED | إنهاء تشغيل — **مختلفة** عن Reject · **ممنوع** أثناء المراجعة/الاعتماد |
| POSTED | خارج 097 · حاجز مستقبلي فقط |
| Snapshot lock | أعمدة على `payroll_runs` + جدول actions |
| فصل الواجبات | Submitter ≠ Approver **و** Submitter ≠ Rejector |
| Warnings | لا تمنع Submit · تظهر للمراجع |
| Verify عند Approve | **إلزامي** |
| Recalculate | ممنوع في `UNDER_REVIEW` و `APPROVED` · مسموح بعد Reject |

**هدف المرحلة:** منع اعتماد نتائج غير سليمة، وتثبيت اللقطة المعتمدة، وحفظ سلسلة قرارات غير قابلة للفقدان، قبل أي Posting أو Payment.

---

## 1. الحالات الحالية (Migration 095)

### 1.1 `payroll_runs.status` اليوم

```
DRAFT | CALCULATING | CALCULATED | CANCELLED
```

(قيد CHECK في `095_payroll_periods_runs.sql` — **مجمّد**.)

### 1.2 دلالات حالية

| Status | المعنى التشغيلي الحالي |
|--------|-------------------------|
| `DRAFT` | مسودة · Scope/Update مسموحان · Calculate فقط |
| `CALCULATING` | انتقال لحظي داخل Tx الاحتساب/إعادة الاحتساب |
| `CALCULATED` | لقطة موجودة · Recalculate مسموح · Posting guard الحالي يشترط CALCULATED + error_count=0 |
| `CANCELLED` | ملغى نهائيًا لهذه الهوية · لا Calculate/Recalculate |

### 1.3 فهرس «تشغيل حيّ»

`uq_payroll_runs_one_live_regular` يشمل اليوم فقط:

`DRAFT | CALCULATING | CALCULATED`

أي توسيع لحالات workflow يجب أن يوسّع هذا الفهرس الجزئي ليشمل الحالات الحية الجديدة (`UNDER_REVIEW` · `APPROVED`) حتى لا يُنشأ تشغيل REGULAR مكافئ أثناء المراجعة/الاعتماد.

### 1.4 حالات مقترحة للذكر فقط (ليست في 095)

| Status | في 9.B؟ |
|--------|---------|
| `UNDER_REVIEW` | **نعم — جديدة** |
| `APPROVED` | **نعم — جديدة** |
| `REJECTED` | **لا كحالة Run** (حدث رفض فقط) |
| `POSTED` | **مستقبلي** — **لا يدخل CHECK في Migration 097** |

---

## 2. مقارنة نماذج المراجعة

| نموذج | المسار | إيجابيات | سلبيات للكلية الآن |
|-------|--------|----------|---------------------|
| **A** اعتماد مباشر | CALCULATED → APPROVED | بسيط | بلا فصل مراجعة/اعتماد · ضعيف لفصل الواجبات · صعب التوسع |
| **B** مراجعة ثم اعتماد | CALCULATED → UNDER_REVIEW → APPROVED | فصل واضح · SoD طبيعي · مناسب للحجم الحالي | خطوة إضافية |
| **C** مستويات متعددة | REVIEWED → FINANCE → FINAL | حوكمة عالية | مفرط الآن · تأخير · تعقيد Idempotency/UI |

### التوصية المعتمدة للتصميم

**النموذج B — مرحلتان:**

1. **Submit for Review**
2. **Approve** أو **Reject**

```
CALCULATED ──submit──► UNDER_REVIEW ──approve──► APPROVED
                            │
                            └──reject──► CALCULATED  (مع سبب إلزامي)
```

قابلية التوسع لاحقًا: إضافة مستويات عبر صفوف `approval_actions` / أدوار دون كسر هوية التشغيل أو اللقطة.

---

## 3. دورة الحياة المقترحة ومصفوفة الانتقالات

### 3.1 حالات Run بعد 9.B (المستهدف)

```
DRAFT
CALCULATING          (لحظي داخل Tx — ليس حالة UI مستقرة)
CALCULATED
UNDER_REVIEW         (جديد)
APPROVED             (جديد)
CANCELLED
(+ POSTED مستقبليًا)
```

### 3.2 مصفوفة الانتقالات

| من \ إلى | DRAFT | CALCULATING | CALCULATED | UNDER_REVIEW | APPROVED | CANCELLED |
|----------|-------|-------------|------------|--------------|----------|-----------|
| DRAFT | — | Calculate | — | ❌ | ❌ | ✅ Cancel |
| CALCULATING | rollback | — | Calculate/Recalc success | ❌ | ❌ | ❌ |
| CALCULATED | ❌ | Recalculate Tx | Recalculate success | ✅ Submit | ❌ | ✅ Cancel |
| UNDER_REVIEW | ❌ | ❌ | ✅ Reject | — | ✅ Approve | ❌ **ممنوع في 9.B** |
| APPROVED | ❌ | ❌ | ❌ | ❌ | — | ❌ **ممنوع في 9.B** |
| CANCELLED | ❌ | ❌ | ❌ | ❌ | ❌ | — |

\*Cancel مسموح فقط من `DRAFT` و `CALCULATED`. لا Cancel للمراجعة · لا `REVIEW_CANCELLED` في 9.B.

### 3.3 انتقالات ممنوعة صراحة

- CALCULATED → APPROVED مباشرة (تجاوز المراجعة).
- UNDER_REVIEW → DRAFT.
- APPROVED → CALCULATED / UNDER_REVIEW بدون مسار رسمي مستقبلي.
- أي انتقال إلى POSTED في 9.B.
- Recalculate من UNDER_REVIEW أو APPROVED.
- Update Run / Scope mutation خارج DRAFT (قائم) — يبقى ممنوعًا في UNDER_REVIEW/APPROVED.

### 3.4 REJECTED مقابل CANCELLED

| | Reject | Cancel |
|--|--------|--------|
| حالة Run الناتجة | `CALCULATED` | `CANCELLED` |
| المعنى | «أُعيد للتصحيح» | «أُنهي التشغيل» |
| السبب | إلزامي | إلزامي (قائم) |
| Recalculate بعده | مسموح | ممنوع |
| Submit بعده | مسموح بعد إصلاح | ممنوع |
| هل حالة مستقلة؟ | لا | نعم |

**لا تُخلط الدلالتان.** لا تُضاف حالة `REJECTED` إلى CHECK إلا إذا ظهرت حاجة تقارير لاحقة؛ السجل في `approval_actions` يكفي.

### 3.5 POSTED

في 9.B: **حاجز تصميمي فقط**.

- لا API ترحيل.
- `assertPayrollRunReadyForPosting` يُحدَّث معماريًا ليشترط لاحقًا `APPROVED` + تطابق hash الاعتماد (انظر §21).
- إضافة `POSTED` إلى CHECK: **ممنوعة في 097** — تُضاف فقط في Migration مرحلة Posting.

---

## 4. شروط Submit for Review

حارس مركزي (اسم مقترح: `assertPayrollRunReadyForSubmitReview`):

| # | الشرط |
|---|--------|
| S1 | `status = CALCULATED` |
| S2 | `currency_code = IQD` (وسياسة العملة المدعومة) |
| S3 | `error_count = 0` |
| S4 | لا Issues بحجم ERROR / `is_blocking = true` |
| S5 | `snapshot_hash` موجود وصالح (`isPayrollSnapshotHash`) |
| S6 | totals على Run تطابق مجموع artifacts (تحقق خدمة/Verify) |
| S7 | Verify أساس الاحتساب/اللقطة ناجح في وضع مناسب (على الأقل فحوصات سلامة الـ Run) |
| S8 | الفترة `OPEN` أو `PROCESSING` (ليست `CLOSED`/`CANCELLED`) |
| S9 | لا Tx CALCULATING جارية (الحالة ليست CALCULATING) |
| S10 | لم يُرحَّل / لم يُدفع (حراس مستقبلية = true الآن) |
| S11 | `version` / `updated_at` مطابقان |
| S12 | المستخدم يملك `payroll_submit_review` |
| S13 | لا يوجد `UNDER_REVIEW`/`APPROVED` بالفعل |

### سياسة التحذيرات (Warnings)

| النوع | Submit؟ | عرض للمراجع؟ |
|-------|---------|----------------|
| ERROR / blocking | ❌ يمنع | — |
| WARNING | ✅ يسمح | ✅ يظهر بوضوح في UI/Response |

**القرار:** Errors وBlocking تمنع · Warnings لا تمنع.

### ناتج Submit الناجح

- `status → UNDER_REVIEW`
- تثبيت `review_snapshot_hash = current snapshot_hash`
- `submitted_for_review_at` / `submitted_for_review_by`
- زيادة `version` / تحديث `updated_at`
- سجل `SUBMITTED_FOR_REVIEW` في جدول الإجراءات + Audit نجاح مناسب
- قفل معنوي: Recalculate/Update/Scope ممنوعان

---

## 5. شروط الاعتماد (Approve)

حارس مركزي (اسم مقترح: `assertPayrollRunReadyForApprove`):

| # | الشرط |
|---|--------|
| A1 | `status = UNDER_REVIEW` |
| A2 | `snapshot_hash` الحالي = `review_snapshot_hash` المُثبَّت عند Submit |
| A3 | `version` / `updated_at` مطابقان |
| A4 | `error_count = 0` وإعادة فحص blocking issues = 0 |
| A5 | لم يحدث Recalculate بعد الإرسال (مضمون بـ A2 + منع Recalculate) |
| A6 | لم يُعدَّل Run/Scope (مضمون بالحالة) |
| A7 | المستخدم يملك `payroll_approve` |
| A8 | فصل الواجبات: `actor_id ≠ submitted_for_review_by` |
| A9 | لا اعتماد APPROVED سابق فعّال لنفس Run |
| A10 | **Verify حتمي** قبل الاعتماد النهائي (حسابات + لقطة + اتساق artifacts) |
| A11 | تعليق الاعتماد: **اختياري** (0–500 بعد تطبيع) |

### ناتج Approve الناجح

- `status → APPROVED`
- `approved_snapshot_hash = snapshot_hash`
- `approved_at` / `approved_by`
- سجل `APPROVED` + Audit
- Recalculate يبقى ممنوعًا

---

## 6. شروط الرفض (Reject)

| # | الشرط |
|---|--------|
| R1 | `status = UNDER_REVIEW` |
| R2 | `version` / `updated_at` مطابقان |
| R3 | المستخدم يملك `payroll_reject` (قد يُمنح مع أو منفصلًا عن approve) |
| R4 | **سبب إلزامي** 10–500 بعد تطبيع (نفس روح Recalculate reason) |
| R5 | لا HTML · نص عادي · بلا NUL/تحكم غير مسموح |

### ناتج Reject

- `status → CALCULATED` (**ليس** REJECTED)
- مسح/إبطال قفل المراجعة الحالية:
  - `review_snapshot_hash → NULL` (أو الإبقاء للتاريخ مع `review_open = false` — انظر النموذج)
  - الحقول التشغيلية للإرسال تُصفَّر أو تُؤرشف في action row فقط
- سجل `REJECTED` يحفظ السبب + hash الذي رُفض + from/to
- **Recalculate مسموح** بعد ذلك بمفتاح وسبب جديدين
- أي Submit لاحق يثبت hash جديدًا

---

## 7. فصل الواجبات (Segregation of Duties)

| سؤال | القرار لـ 9.B |
|------|----------------|
| من احتسب يستطيع Submit؟ | **نعم** إن ملك `payroll_submit_review` |
| من أرسل للمراجعة يستطيع Approve؟ | **لا** (حتى admin) |
| من أرسل للمراجعة يستطيع Reject؟ | **لا** — الرفض قرار مراجعة من مستخدم آخر يملك `payroll_reject` |
| سحب الطلب من Submitter؟ | **خارج 9.B** (`REVIEW_WITHDRAWN` مستقبلي) |
| هل `accounts_admin` يتجاوز SoD؟ | **لا** |
| Override / Emergency Approval؟ | **ممنوع في 9.B** |

### قواعد صلبة

1. `payroll_submit_review` · `payroll_approve` · `payroll_reject` قدرات **منفصلة**.
2. عند Approve: إن `actor.id === submitted_for_review_by` → **409** `SEGREGATION_OF_DUTIES`.
3. عند Reject: نفس القاعدة — Submitter لا يرفض طلبه.
4. يمكن لنفس الشخص امتلاك approve و reject، لكن ليس Submitter لنفس الدورة عند التنفيذ.
5. لا مسار «admin force approve/reject».

---

## 8. أثر Workflow على Recalculate (9.A.2.4)

| Status | Recalculate |
|--------|-------------|
| CALCULATED | ✅ (قائم) |
| UNDER_REVIEW | ❌ 409 |
| APPROVED | ❌ 409 |
| بعد Reject → CALCULATED | ✅ بمفتاح/سبب جديدين |
| CANCELLED | ❌ (قائم) |

- لا Hard Delete لتاريخ الموافقات عند Reject أو Recalculate لاحق.
- قفل المراجعة السابق يُعتبر غير فعّال بعد Reject؛ Submit جديد ينشئ قفل hash جديد.

تحديث أهلية Recalculate (E12 من معمارية 9.A.2.4): تصبح **حقيقية** — Recalculate ممنوع إذا `UNDER_REVIEW` أو `APPROVED`.

---

## 9. Snapshot Lock ونموذج البيانات

### 9.1 خيارات

| خيار | الوصف | تقييم |
|------|--------|--------|
| **A** حقول فقط على `payroll_runs` | بسيط | ضعيف لتاريخ متعدد · صعوبة uniqueness للأفعال · تقارير محدودة |
| **B** جدول `payroll_run_approval_actions` فقط | تاريخ قوي | يحتاج أعمدة حالة سريعة على Run للاستعلامات/الحراس |
| **C** workflow instance + actions | مرن للمستويات | زائد عن الحاجة للكلية الآن |
| **D (موصى به)** | أعمدة حالة رفيعة على Run + جدول actions غير قابل للتعديل + Audit للـ blocked/failed | أصغر تصميم صحيح وقابل للتوسع |

### 9.2 التوصية: النموذج D

#### أعمدة مقترحة على `payroll_runs` (Migration 097 — لا تُنشأ الآن)

| عمود | الغرض |
|------|--------|
| `review_snapshot_hash` | hash المُثبَّت عند Submit |
| `submitted_for_review_at` | وقت الإرسال |
| `submitted_for_review_by` | مُرسل المراجعة |
| `approved_snapshot_hash` | hash المعتمد |
| `approved_at` | وقت الاعتماد |
| `approved_by` | المعتمد |
| `approval_cycle_number` | عداد دورات Submit (يزيد مع كل Submit ناجح) |

عند Reject: تُصفَّر أعمدة المراجعة المفتوحة (`review_snapshot_hash`, `submitted_*`) مع الإبقاء على التاريخ في جدول الإجراءات. أعمدة الاعتماد تبقى NULL حتى Approve ناجح؛ عند Approve لاحق بعد رفض سابق، تُملأ من جديد.

بديل مقبول: عدم تصفير `submitted_*` والاعتماد على `approval_cycle_number` + آخر action — لكن التصفير أوضح للحراس.

#### جدول `accounts.payroll_run_approval_actions`

سجل **append-only** (ممنوع UPDATE/DELETE من التطبيق؛ لا منح صلاحيات كتابة للمستخدمين على DELETE).

حقول مقترحة:

| حقل | نوع | ملاحظات |
|-----|------|---------|
| `id` | UUID PK | |
| `payroll_run_id` | UUID FK | |
| `payroll_period_id` | UUID | نسخة وقت الحدث |
| `action` | VARCHAR | انظر §10 |
| `from_status` | VARCHAR | |
| `to_status` | VARCHAR | |
| `actor_id` | UUID | |
| `reason` / `comment` | TEXT | Reject إلزامي |
| `snapshot_hash` | VARCHAR(64) | hash وقت القرار |
| `version_before` | INT | |
| `version_after` | INT | |
| `approval_cycle_number` | INT | |
| `request_key_hash` | CHAR(64) | idempotency |
| `request_payload_hash` | CHAR(64) | |
| `created_at` | TIMESTAMPTZ | |
| `metadata_json` | JSONB | غير حسّاس فقط |

**قيود مهمة:**

- Unique جزئي: نجاح واحد مفتوح لكل `(run_id, action=SUBMITTED_FOR_REVIEW, cycle)` أو Unique على `(run_id, request_key_hash)` لأفعال النجاح.
- Index: `(payroll_run_id, created_at DESC)`, `(action)`, `(request_key_hash)`.
- لا تخزين raw idempotency key · لا snapshot_json · لا lines.

---

## 10. نموذج التاريخ والأفعال

### 10.1 أفعال النجاح (في جدول الإجراءات)

- `SUBMITTED_FOR_REVIEW`
- `APPROVED`
- `REJECTED`
- `REVIEW_CANCELLED` (إن أُلغي التشغيل أثناء UNDER_REVIEW عبر Cancel)

### 10.2 أفعال محظورة/فاشلة

تُفضَّل في `financial_audit_log` (مثل Recalculate blocked/failed) **أو** صفوف actions بـ `outcome=BLOCKED|FAILED` إن رُغب توحيد الاستعلام.

**التوصية لـ 9.B:**

| الحدث | أين |
|-------|-----|
| نجاح Submit/Approve/Reject | `payroll_run_approval_actions` + Audit موجز |
| `APPROVAL_BLOCKED` (422/409 أعمال) | `financial_audit_log` best-effort |
| `APPROVAL_FAILED` (500) | `financial_audit_log` best-effort |

### 10.3 لماذا لا يكفي Audit JSONB وحده؟

| الحاجة | Audit JSONB | جدول actions |
|--------|-------------|--------------|
| Unique idempotency على مستوى DB | ضعيف | قوي |
| استعلام سلسلة القرارات مرتبة | بطيء/هش | سريع |
| منع APPROVED مكرر بقيود | صعب | Unique جزئي |
| تقارير الحوكمة | محدود | مناسب |
| إثبات from/to/version/hash | ممكن لكن غير مقيّد | مقيّد |

**القرار:** جدول مخصص للنجاحات + Audit مكمّل للـ blocked/failed والملخصات.

---

## 11. قرار Migration 097

### الحكم: **نعم — Migration 097 مطلوبة**

لا تُنشأ في مرحلة Architecture هذه.

### لماذا ليست «لا Migration»؟

بدون توسيع CHECK وإضافة أعمدة القفل وجدول الإجراءات:

- لا يمكن تمثيل `UNDER_REVIEW`/`APPROVED` بأمان في القاعدة.
- فهرس التشغيل الحيّ يبقى ناقصًا.
- Idempotency/concurrency للاعتماد أضعف من معيار 9.A.2.4.
- Posting لاحقًا سيحتاج نفس البنية — تأجيلها الآن يراكم دينًا تقنيًا.

### محتوى 097 المتوقع (تصميم فقط)

1. إسقاط/إعادة قيد CHECK للحالات: إضافة `UNDER_REVIEW`, `APPROVED`.
2. توسيع `uq_payroll_runs_one_live_regular` ليشمل الحالات الحية الجديدة.
3. أعمدة القفل على `payroll_runs` (§9.2).
4. جدول `payroll_run_approval_actions` + فهارس + FKs.
5. **لا** تعديل 094/095/096 محتوىً تاريخيًا — فقط 097 لاحقة.
6. **لا** جداول Posting/Payment.

---

## 12. Idempotency

Namespaces منفصلة (SHA-256 كما في Recalculate):

| عملية | Prefix المفتاح |
|-------|----------------|
| Submit | `payroll-submit-review:` |
| Approve | `payroll-approve:` |
| Reject | `payroll-reject:` |

### Payloads دلالية (بعد تطبيع)

**Submit:**

```json
{
  "operation": "SUBMIT_REVIEW",
  "run_id": "...",
  "expected_version": 1,
  "expected_updated_at": "ISO",
  "snapshot_hash": "...",
  "comment": "normalized or empty"
}
```

**Approve:**

```json
{
  "operation": "APPROVE",
  "run_id": "...",
  "expected_version": 1,
  "expected_updated_at": "ISO",
  "reviewed_snapshot_hash": "...",
  "comment": "normalized or empty"
}
```

**Reject:**

```json
{
  "operation": "REJECT",
  "run_id": "...",
  "expected_version": 1,
  "expected_updated_at": "ISO",
  "reason": "normalized 10..500"
}
```

| نفس key + نفس payload | 200 Replay |
| نفس key + payload مختلف | 409 IDEMPOTENCY_CONFLICT |
| Audit/Action تالف أو مكرر نجاح | 409 integrity — بلا mutation |

تخزين: `request_key_hash` + `request_payload_hash` فقط · masked في Audit blocked/failed إن لزم · **لا raw key**.

---

## 13. Reason وComments

| الحقل | السياسة |
|-------|---------|
| Submit comment | **اختياري** · إن وُجد: trim · حد أقصى 500 · نفس قواعد النظافة |
| Approve comment | **اختياري** · 0–500 |
| Reject reason | **إلزامي** · 10–500 بعد تطبيع · نص عادي · لا HTML · في actions + Audit |
| Override | غير موجود في 9.B |

---

## 14. Capabilities

| Capability | الغرض |
|------------|--------|
| `payroll_submit_review` | إرسال للمراجعة |
| `payroll_approve` | اعتماد نهائي |
| `payroll_reject` | رفض وإعادة لـ CALCULATED |
| `payroll_view_approval_history` | قراءة سجل القرارات (يمكن دمجها مع `payroll_view_runs` إن رُغب تبسيط — **التوصية:** منفصلة للوضوح، مع منحها لكل من يملك VIEW_RUNS في mapping أولي) |

### Mapping مبدئي (دون نظام أدوار موازٍ)

| الدور | Submit | Approve | Reject | View history |
|-------|--------|---------|--------|--------------|
| accounts_viewer | ❌ | ❌ | ❌ | ✅ (عبر VIEW_RUNS أو القدرة المنفصلة) |
| accounts_clerk | ✅ مقترح | ❌ | ❌ | ✅ |
| accounts_approver | ❌ | ✅ | ✅ | ✅ |
| accounts_admin | ✅ | ✅ | ✅ | ✅ |
| SoD | يُطبَّق حتى على admin | | | |

**ملاحظة:** إن مُنح admin القدرتين، ما زال ممنوعًا أن يعتمد ما أرسله بنفسه.

التحقق عبر `assertPayrollCapability` — لا فحوصات `accounts_admin` خام في Routes.

---

## 15. تصميم API (بلا تنفيذ)

### 15.1 Endpoints

```
POST /api/accounts/payroll/runs/[id]/submit-review
POST /api/accounts/payroll/runs/[id]/approve
POST /api/accounts/payroll/runs/[id]/reject
GET  /api/accounts/payroll/runs/[id]/approval-history
```

### 15.2 أجسام الطلب (ملخص)

**Submit:** `{ version, updated_at, idempotency_key, confirmation: true, comment? }`
**Approve:** `{ version, updated_at, idempotency_key, confirmation: true, comment? }`
**Reject:** `{ version, updated_at, idempotency_key, confirmation: true, reason }`

### 15.3 استجابة النجاح

- `ok` / `success` / `idempotent_replay`
- `run` (حقول آمنة + status الجديد)
- `approval` ملخص: action · from/to · snapshot_hash مختصر · actor display إن أمكن · timestamps
- بلا raw keys · بلا hashes طلب · بلا snapshot_json

### 15.4 أكواد الحالة

| Code | أمثلة |
|------|--------|
| 400 | confirmation · version · reason قصير · JSON |
| 403 | capability |
| 404 | Run غير موجود/غير مرئي |
| 409 | stale · SoD · status · idempotency conflict · concurrency · integrity |
| 422 | error_count · blocking · currency · verify فشل أعمال · hash ناقص |
| 500 | فشل تقني معقّم — الحالة السابقة محفوظة |
| 200 | نجاح أو replay |

### 15.5 Visibility / IDOR

نفس نمط Payroll Runs: عضوية ACCOUNTS + VIEW_RUNS · Run غير موجود → 404 موحّد · لا اعتماد على body لتحديد الملكية.

---

## 16. تصميم UI (بلا تنفيذ)

المسار: `/accounts/payroll/runs/[id]`

| الحالة | أزرار |
|--------|--------|
| CALCULATED + error_count=0 + capability | **إرسال للمراجعة** |
| CALCULATED + أخطاء | لا Submit · بانر إصلاح |
| UNDER_REVIEW + approve/reject cap + ليس Submitter | **اعتماد الرواتب** · **رفض وإعادة للتصحيح** |
| UNDER_REVIEW | إخفاء Recalculate |
| APPROVED | لا Recalculate · لا Submit · بانر «معتمد» |

عرض للمراجع: المُرسل · وقت الإرسال · hash مختصر · warnings · totals · عدد الأشخاص · سجل القرارات · سبب الرفض عند العودة.

Dialogs: ConfirmDialog لـ Submit/Approve · Reject مع سبب إلزامي · loading · double-submit · idempotency key ثابت · رسائل stale عربية.

---

## 17. Cancel Semantics

| Status | Cancel؟ | من؟ | سبب؟ |
|--------|---------|-----|------|
| DRAFT | ✅ (قائم) | `payroll_cancel_runs` | إلزامي |
| CALCULATED | ✅ (قائم) | cancel capability | إلزامي |
| UNDER_REVIEW | ❌ **ممنوع في 9.B** | — | استخدم Reject من مراجع آخر |
| APPROVED | ❌ **ممنوع في 9.B** | — | Unapprove مستقبلي |
| بعد Reject (CALCULATED) | ✅ كأي CALCULATED | | |

لا `REVIEW_CANCELLED` · لا Review Withdrawal في 9.B.

---

## 18. قيود على APIs الحالية (معماريًا — بلا تنفيذ)

| API | UNDER_REVIEW | APPROVED |
|-----|--------------|----------|
| Calculate | ❌ أصلًا (ليس DRAFT) | ❌ |
| Recalculate | ❌ 409 | ❌ 409 |
| Update Run | ❌ (ليس DRAFT) | ❌ |
| Scope members | ❌ (ليس DRAFT) | ❌ |
| Cancel | ❌ **ممنوع** | ❌ **ممنوع** |
| Results GET | ✅ قراءة | ✅ قراءة |
| Posting | ❌ غير موجود؛ الحارس سيرفض لاحقًا بلا APPROVED صحيح | لاحقًا فقط من APPROVED |

---

## 19. Concurrency وترتيب الأقفال

### السيناريوهات

| سباق | النتيجة المقبولة |
|------|------------------|
| Submit × Submit | فائز واحد · الآخر 409 |
| Submit × Recalculate | فائز واحد · لا UNDER_REVIEW على hash قديم |
| Submit × Cancel | Cancel على CALCULATED يفوز أو Submit يفوز · لا Cancel بعد UNDER_REVIEW |
| Approve × Approve | فائز واحد |
| Approve × Reject | فائز واحد · حالة نهائية واحدة |
| Approve × Recalculate | Recalculate يُرفض إن سبق القفل / أو Approve يفوز ثم Recalc 409 |
| Reject × Cancel | حالة نهائية واحدة متسقة |
| Update/Scope × Submit | Update أصلًا 409 على CALCULATED |
| Approve × Posting (مستقبلي) | Posting ينتظر APPROVED مستقر |

### ترتيب الأقفال

```
1) payrollPeriodLock(period_id)
2) payrollRunLock(run_id)
3) قفل صفوف approval cycle / إدراج action تحت نفس Tx
```

نفس روح 9.A.2.4 لتجنب deadlock.

---

## 20. Atomicity

كل Action في **Transaction واحدة**:

lock → validate → transition → insert action → audit success → version++ → commit

| الفشل | السلوك |
|-------|--------|
| Business blocked (422/409 قبل mutation) | لا تغيير حالة · blocked Audit اختياري |
| Technical failure بعد بدء mutation | Rollback كامل · الحالة السابقة · failed Audit best-effort · بلا history نجاح جزئي |

---

## 21. Verify المقترح

فحوصات (normal/strict حسب الخطورة):

- APPROVED بلا `approved_by` / `approved_at` / `approved_snapshot_hash`
- `approved_snapshot_hash ≠ run.snapshot_hash`
- UNDER_REVIEW بلا `submitted_by` / `submitted_at` / `review_snapshot_hash`
- UNDER_REVIEW مع `error_count > 0` أو blocking issues
- Submitter = Approver على آخر APPROVED (انتهاك SoD)
- تكرار APPROVED نجاح لنفس الدورة
- انتقال from/to غير قانوني في history
- سلسلة version غير متسقة
- Action بعد Recalculate أحدث يناقض القفل
- APPROVED ثم تغيّر artifacts (mismatch)
- Reject بلا reason
- POSTED بلا APPROVED (مستقبلي)
- idempotency duplicate/conflict
- raw keys أو بيانات حساسة في history/audit

---

## 22. Posting Boundary (تحديث معماري)

`assertPayrollRunReadyForPosting` — **مستهدف لاحقًا** (ليس تنفيذ 9.B):

يجب أن يتطلب:

1. `status = APPROVED` (بدل CALCULATED الحالي)
2. `approved_snapshot_hash = snapshot_hash`
3. `error_count = 0`
4. لا blocking issues
5. Verify ناجح
6. لم يُلغَ الاعتماد
7. لم يُرحَّل مسبقًا

في 9.B يمكن الإبقاء على الحارس الحالي مع تعليق/توثيق أن Approval سيُشدَّد لاحقًا، أو تضييقه تدريجيًا عند إدخال الحالات — **قرار التنفيذ في 9.B.1**.

**لا Posting في 9.B.**

---

## 23. قائمة اختبارات القبول (تصميم)

### Submit
1. CALCULATED نظيف → UNDER_REVIEW
2. error_count > 0 مرفوض
3. blocking issue مرفوض
4. warning فقط مسموح
5. hash ناقص مرفوض
6. stale version
7. stale updated_at
8. بلا capability
9. IDOR
10. same key replay
11. same key payload conflict
12. concurrent submit
13. Submit × Recalculate
14. Submit × Cancel

### Approve
15. UNDER_REVIEW → APPROVED
16. من CALCULATED مرفوض
17. Submitter لا يعتمد
18. Approver مختلف ينجح
19. hash تغيّر مرفوض
20. artifacts تغيّرت مرفوضة
21. خطأ مُدخل مرفوض
22. stale version
23. بلا capability
24. IDOR
25. replay
26. key conflict
27. Approve × Approve
28. Approve × Reject
29. حارس Posting مستقبلي يرفض غير APPROVED

### Reject
30. UNDER_REVIEW → CALCULATED
31. reason إلزامي
32. سبب قصير مرفوض
33. بلا capability
34. replay
35. conflict
36. Reject × Approve
37. history محفوظ
38. Recalculate بعد الرفض مسموح

### Integrity
39. history غير قابل للتعديل من API
40. status/history متسقان
41. snapshot lock
42. posting guard لاحقًا APPROVED فقط
43. audit نجاح مرة
44. لا raw key
45. failpoint rollback
46. cleanup صفر
47. verify normal/strict

---

## 24. تقسيم التنفيذ المقترح

| مرحلة | النطاق | يعتمد على |
|-------|--------|-----------|
| **9.B.1** | Migration 097 + نموذج البيانات + نواة الانتقالات + حراس + قفل + SoD + Idempotency Core | Baseline 9.A.2.4.2 |
| **9.B.2** | Submit API + UI + blocked/failed Audit | 9.B.1 |
| **9.B.3** | Approve/Reject API + UI + SoD enforcement | 9.B.1 + 9.B.2 |
| **9.B.4** | History API/UI + Verify + Hardening + تحديث Recalculate/Posting guards | 9.B.1–3 |

بديل أصغر: دمج 9.B.2+9.B.3 إن كان الحجم يسمح — **غير موصى به** لفصل القبول.

---

## 25. المؤجّل خارج 9.B

- GL Posting · Journal Entries
- Payroll Payments · Bank files
- Payslips نهائية مقفلة
- Multi-level approvals المتقدمة
- Emergency override
- Full snapshot archive
- Digital signatures
- إشعارات بريد (إلا إن بسيطة بلا أثر على Core)
- حالة Run اسمها REJECTED
- Unapprove بعد APPROVED

---

## 26. المخاطر

| خطر | تخفيف |
|-----|--------|
| توسيع CHECK دون توسيع فهرس الحيّ | بند إلزامي في 097 |
| Admin يتجاوز SoD | ممنوع افتراضيًا |
| اعتماد على hash قديم | review_snapshot_hash + منع Recalculate |
| الاكتفاء بـ Audit JSONB | جدول actions مخصص |
| خلط Reject/Cancel | دلالات منفصلة موثّقة |
| تشديد Posting guard مبكرًا يكسر اختبارات CALCULATED | تحديث مرحلي موثّق في 9.B.4 |

---

## 27. قرارات مفتوحة (للمراجعة)

1. هل تُضاف `POSTED` إلى CHECK في 097؟ **مُغلق: لا.**
2. هل `payroll_reject` منفصلة؟ **مُغلق: نعم.**
3. هل Cancel من UNDER_REVIEW؟ **مُغلق: ممنوع.**
4. هل Submitter يستطيع Reject؟ **مُغلق: لا.**
5. هل Submit comment إلزامي؟ **مُغلق: اختياري.**
6. هل clerk يُمنح Submit؟ **مفتوح للتنفيذ في mapping — التوصية نعم.**

---

## 28. خلاصة القرار

**Approval Workflow بمرحلتين (B)** مع حالات `UNDER_REVIEW` و `APPROVED`، ورفض يعود إلى `CALCULATED`، و**Migration 097 إلزامية** لنموذج قفل + جدول إجراءات، وفصل واجبات صارم، وIdempotency بأسماء منفصلة، دون Posting/Payments في هذه المرحلة.

**لا تنفيذ حتى اعتماد هذه الوثيقة.**
