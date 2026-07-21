# 9.C — Payroll Posting to General Ledger Architecture

> **الحالة:** Architecture **ACCEPTED WITH FINAL DECISIONS**
> **Baseline المعتمد:** `db48bb3` (Payroll 9.B FINAL ACCEPTED)
> **المراحل المجمدة:** Foundation · Periods/Runs · Snapshot · Calculation · Recalculate · 9.B.1–9.B.4
> **Migrations Frozen قبل التنفيذ:** 094 · 095 · 096 · 097
> **Migration 098:** للتنفيذ في **9.C.1** بعد هذا الاعتماد
> **Documentation commit:** `docs(accounts): approve payroll posting architecture 9C`

---

## 0. القرارات النهائية المعتمدة (مُلزمة)

| بند | القرار النهائي |
|-----|----------------|
| Lifecycle 9.C.1 | `APPROVED → POSTED` داخل **Transaction واحدة** |
| حالة `POSTING` | **لا** — أي فشل قبل Commit = Rollback كامل · Run يبقى `APPROVED` |
| عند الفشل قبل Commit | لا Journal · لا Lines · لا Posting record · لا تغيير Run · لا استهلاك نهائي لرقم مستند خارج Tx |
| حالة Run `REVERSED` | **مؤجّلة** إلى **9.C.2** |
| Cancel / Reject / Recalculate / Submit / Approve بعد `POSTED` | **ممنوع قطعًا** |
| Cancel بعد `APPROVED` قبل الترحيل | ممنوع كما في 9.B |
| Statuses بعد 098 | `DRAFT` · `CALCULATING` · `CALCULATED` · `UNDER_REVIEW` · `APPROVED` · **`POSTED`** · `CANCELLED` |
| `POSTED` في live regular index | **نعم** — يمنع Regular Run بديل لنفس الفترة بعد الترحيل |
| Migration 098 | **مطلوبة** — لا تعديل 094–097 |
| حقول Run | `posted_at` · `posted_by` · `posting_journal_entry_id` · `posted_snapshot_hash` فقط |
| حقول مؤجّلة | `posting_reference` · `posting_version` · `reversal_*` |
| جدول `payroll_run_postings` | **نعم** — صف ناجح immutable واحد لكل Run · **بلا** status محاولات |
| فشل / blocked | `financial_audit_log` فقط |
| تجميع القيد | حسب GL account + Cost Center عند الاستخدام · **لا** سطر لكل موظف |
| GL Mapping | Hybrid على 094 · **لا** جدول mapping جديد في 098 |
| Rounding | Decimal فقط · عتبة مركزية **≤ 1 IQD** · فوقها رفض |
| posting_date افتراضي | نهاية فترة الرواتب · إن مغلقة/غير صالحة → **رفض** (لا انتقال صامت لتاريخ اليوم) |
| SoD Approver≠Poster | **غير مفروض في 9.C.1** · قابل للتفعيل لاحقًا · يُسجَّل كلا الطرفين في Audit |
| SoD Submit≠Approve/Reject | يبقى كما في 9.B |
| Reversal / Payments / Payslips | خارج 9.C.1 |
| قيد Journal | `entry_type=SALARY` · `source_type=PAYROLL_RUN` · `status=POSTED` مباشرة |
| Idempotency | namespace `payroll-post` |
| Capability | `payroll_post` |
| Lock order | Fiscal/Accounting Period → Payroll Period → Payroll Run → Idempotency/Posting identity → Mapping/Account rows (ID مرتّب) → Document allocator → Journal source · متوافق مع `acquireAccountingResourceLocks` |
| API/UI | بعد Core فقط |

---

## 0.1 ملخص تنفيذي

**الهدف:** تحويل تشغيل رواتب `APPROVED` إلى قيد أستاذ عام متوازن ونهائي، مربوط بلقطة الاعتماد فقط، بلا تكرار قيد، وبلا الاعتماد على عقود/موظفين أحياء لإعادة الحساب.

**النموذج المعتمد:**

```
… → APPROVED  ──(postPayrollRunCore)──►  POSTED
                 │
                 ├─ Journal Entry (SALARY, POSTED)
                 ├─ payroll_run_postings (سجل نجاح واحد)
                 └─ Audit payroll_run.posted
```

**حدود 9.C.1:** Migration 098 + Core + Failpoints + Verify + Tests · **بلا** API/UI/Reversal/Payments/Payslips.

---

## 1. Lifecycle

### 1.1 الخيارات

| Option | المسار | إيجابيات | سلبيات |
|--------|--------|----------|--------|
| **A** | `APPROVED → POSTED` | بسيط · متسق مع student charge auto-post · سهل التحقق | يحتاج توسيع CHECK وlive index |
| **B** | `APPROVED → POSTING → POSTED` | يظهر تقدّمًا إن كان العمل طويلًا خارج Tx | خطر orphan `POSTING` · تعقيد concurrency · غير ضروري إذا كان البناء داخل Tx واحدة |
| **C** | `APPROVED → POSTED → REVERSED` | يغطي التصحيح مبكرًا | يوسّع النطاق · يحتاج سياسة عكس كاملة الآن |

### 1.2 التوصية النهائية: **Option A** (+ Reversal لاحقًا كـ Option C جزئي في 9.C.2)

| سؤال | الجواب |
|------|--------|
| هل نحتاج `POSTING` transient؟ | **لا** في 9.C.1. الترحيل يكتمل أو يُلغى بالكامل داخل Tx. |
| ماذا عند فشل Transaction؟ | **Rollback** · Run يبقى `APPROVED` · لا journal · لا posting record ناجح · Audit `payroll_run.posting_failed` إن سُجّل خارج/قبل commit بحذر (الموصى: failed داخل Tx ثم rollback يزيلها **أو** failed خارج Tx بعد معرفة السبب — تفضيل: Audit failed **بعد** فشل واضح بلا ترك حالة وسيطة على Run). |
| هل `REVERSED` على Run مطلوب الآن؟ | **لا** — يكفي لاحقًا ربط `reversal_journal_entry_id` عبر جدول postings / حقول Run في 9.C.2. نمط Journal `REVERSED` موجود أصلًا في الأستاذ. |
| إلغاء Run بعد `POSTED`؟ | **ممنوع**. |
| Reject / Recalculate / Submit / Approve بعد `POSTED`؟ | **ممنوع**. |
| هل Posting قابل للإعادة؟ | **Replay فقط** لنفس idempotency identity — **لا** قيد ثانٍ ناجح لنفس Run. |

### 1.3 الحالات بعد 098

```
DRAFT → CALCULATING → CALCULATED → UNDER_REVIEW → APPROVED → POSTED
                                              ↘ CANCELLED (من DRAFT/CALCULATED فقط كما اليوم)
```

- `POSTED` تُضاف إلى CHECK وlive-regular index (تشغيل حي حتى الترحيل؛ بعد الترحيل يبقى حيًا لمنع duplicate REGULAR لنفس البصمة التشغيلية — **نعم يُدرَج في فهرس الحي** حتى لا يُنشأ تشغيل موازٍ لنفس الفترة/النطاق).
- بديل إن رُفض إدراج `POSTED` في live index: توثيق أن الترحيل «يغلق» الهوية عبر قيد uniqueness منفصل — **التوصية: إدراج `POSTED` في الفهرس الجزئي الحي** لاتساق 9.B.

---

## 2. Source of Truth

| طبقة | المصدر | الدور |
|------|--------|------|
| مبالغ الرواتب | آثار اللقطة (`payroll_run_people` / `lines` / `issues` + hashes على Run) | **لا قراءة عقود/مخصصات حية** عند الترحيل |
| الاعتماد | `payroll_run_approval_actions` + حقول approval على Run | إثبات `APPROVED` وسلسلة الدورة |
| القيد المحاسبي | `journal_entries` + `journal_entry_lines` | SoT للأستاذ |
| رابط النزاهة | `payroll_run_postings` (+ مؤشرات على Run) | ربط Run ↔ Journal بلا غموض |

**سياسة اللقطة المعتمدة (ملزمة):**

1. `status = APPROVED` (قبل التحويل) ثم `POSTED` بعده.
2. `approved_snapshot_hash` موجود وصالح.
3. `approved_snapshot_hash = review_snapshot_hash`.
4. `approved_snapshot_hash = snapshot_hash` الحالي.
5. يُحفظ `posted_snapshot_hash = approved_snapshot_hash` عند النجاح.
6. أي انحراف hash → رفض الترحيل.

---

## 3. Preconditions (إلزامية قبل البناء)

1. Run مرئي للمستخدم + capability `payroll_post`.
2. `status = APPROVED`.
3. لا posting ناجح سابق لنفس Run.
4. `assertPayrollRunReadyForPosting` (+ توسيعه ليشمل `review` hash وapproval action).
5. `verifyPayrollApprovalWorkflow` (أو نواة مكافئة داخل Tx) ناجح لهذا Run / لا mismatches حاسمة.
6. يوجد `APPROVED` action في الدورة الحالية + `SUBMITTED_FOR_REVIEW` سابق في الدورة.
7. `error_count = 0` · لا blocking issues.
8. `currency_code = IQD`.
9. فترة الرواتب مرتبطة بسياق مالي صالح؛ **الفترة المالية للقيد `OPEN`**؛ السنة `ACTIVE`.
10. `entry_date` / `posting_date` ضمن حدود الفترة المالية المختارة.
11. جميع حسابات GL المحلولة: نشطة · `allow_posting` · ليست مجموعة.
12. حيث `requires_cost_center`: مركز كلفة إلزامي على السطر.
13. مجموع مدين = مجموع دائن · كلاهما `> 0`.
14. `version` + `updated_at` متطابقان (optimistic concurrency).
15. Idempotency: لا تعارض هوية/حمولة.

---

## 4. Migration 098 (مقترحة — لا تُنشأ الآن)

**الملف المتوقع:** `db/migrations/098_payroll_posting.sql`

### 4.1 تعديلات `payroll_runs`

| حقل | 9.C.1 | مبرر |
|-----|-------|------|
| توسيع CHECK لإضافة `POSTED` | **مطلوب** | Lifecycle |
| تحديث live-regular index ليشمل `POSTED` | **مطلوب** | منع duplicate حي |
| `posted_at TIMESTAMPTZ` | **مطلوب** | وقت الترحيل |
| `posted_by UUID` | **مطلوب** | المنفّذ |
| `posting_journal_entry_id UUID FK → journal_entries` | **مطلوب** | وصول سريع للقيد |
| `posted_snapshot_hash VARCHAR(64)` | **مطلوب** | تجميد بصمة ما رُحّل |
| `posting_reference` | **يؤجّل** | يكفي `entry_number` عبر JOIN |
| `posting_version` | **يؤجّل** | يكفي `payroll_runs.version` |
| `reversal_journal_entry_id` | **يؤجّل لـ 9.C.2** | |
| `reversed_at` / `reversed_by` | **يؤجّل لـ 9.C.2** | |

**CHECK مقترح لـ POSTED:**

- إن `status = POSTED` ⇒ `posted_at/by` و`posting_journal_entry_id` و`posted_snapshot_hash` NOT NULL و`posted_snapshot_hash = approved_snapshot_hash`.
- إن `status <> POSTED` ⇒ حقول الترحيل NULL (ما عدا بعد تصميم 9.C.2 للعكس).

### 4.2 جدول `accounts.payroll_run_postings` — **نعم**

**لماذا جدول مستقل وليس حقول Run فقط؟**

| حاجة | حقول Run وحدها | جدول postings |
|------|----------------|---------------|
| ناجح واحد لكل Run | ممكن UNIQUE جزئي | أوضح + قابل للتوسع |
| محاولات فاشلة / replay metadata | تُلوّث Run أو تُفقد | صفوف STATUS |
| Reversal لاحقًا | أعمدة إضافية | صف REVERSAL / رابط |
| Payment batches مستقبلًا | ضعيف | قابل للربط |
| Idempotency identity | على Run صعب | طبيعية على صف الترحيل |
| Auditability | جزئي | append-only |

**الحقول المقترحة:**

| حقل | وصف |
|-----|-----|
| `id` | PK |
| `payroll_run_id` | FK |
| `payroll_period_id` | نسخة من السياق |
| `journal_entry_id` | FK · NOT NULL عند SUCCESS |
| `status` | `SUCCESS` فقط في 9.C.1 (فشل = لا صف ناجح؛ المحاولات الفاشلة في Audit) |
| `posted_snapshot_hash` | |
| `gross_total` / `deduction_total` / `employer_contribution_total` / `net_total` | نسخة من ملخص التشغيل عند الترحيل |
| `currency_code` | |
| `fiscal_year_id` / `fiscal_period_id` | سياق القيد |
| `posting_date` / `entry_date` | |
| `actor_id` / `actor_display_name_snapshot` | |
| `comment` | اختياري |
| `request_key_hash` / `request_payload_hash` / `request_key_masked` | Idempotency |
| `version_before` / `version_after` | |
| `created_at` | |

**قيود:**

- `UNIQUE (payroll_run_id) WHERE status = 'SUCCESS'` — ترحيل ناجح واحد.
- `UNIQUE (request_key_hash)` — عالمي ضمن namespace المدمج في الـ hash.
- FK `journal_entry_id` فريد عند SUCCESS (لا مشاركة قيد بين تشغيلين).

**قرار فشل المحاولة:** لا صف `FAILED` إلزامي في 9.C.1 — `financial_audit_log` يكفي للـ blocked/failed (اتساقًا مع 9.B). يمكن إضافة `FAILED` لاحقًا إن لزم التشخيص.

---

## 5. GL Mapping Model

### 5.1 الخيارات

| | النموذج | ملاءمة |
|-|---------|--------|
| A | ثابت على مستوى النظام | سريع لكن هش |
| B | على مستوى Component | موجود جزئيًا (`expense_account_id` / `liability_account_id`) |
| C | Department / Cost Center فقط | ناقص للمبالغ |
| **D Hybrid** | Component + `payroll_account_mappings` + DEFAULT/ROUNDING | **موصى به** |

### 5.2 التوصية: Hybrid (D) على البنية الحالية 094

**ترتيب الحل (مقترح للتنفيذ لاحقًا):**

1. إن وُجد mapping نطاق `COMPONENT` نشط للمكوّن → استخدمه.
2. وإلا حقول GL على `payroll_components`.
3. وإلا mapping `PERSON_TYPE` / `CALENDAR` حسب الأولوية `priority`.
4. وإلا mapping `DEFAULT`.
5. فروقات التقريب → حساب `ROUNDING` mapping.
6. صافي الرواتب المستحق → `payable_account_id` من DEFAULT أو حقل مخصّص للـ net payable (يُثبت في التنفيذ: حساب التزام «رواتب مستحقة» إلزامي على مستوى DEFAULT).

### 5.3 تصنيفات الحسابات المستهدفة

**مصروفات (مدين عادة):**

- راتب أساسي / أجور.
- مخصصات.
- ساعات إضافية (إن وُجد مكوّن).
- حصة صاحب العمل (مصروف).

**التزامات (دائن عادة):**

- صافي الرواتب المستحقة (Net payable).
- استقطاعات الموظفين المجمّعة (أو حسب نوع الاستقطاع إن توفّر mapping).
- ضريبة / ضمان / تقاعد مستحق الدفع.
- حصة صاحب العمل المستحقة الدفع (إن فُصلت عن المصروف).

**9.C.1 لا يفرض شجرة حسابات جديدة** — يشترط أن تكون الحسابات مُعدّة عبر UI الخرائط الحالية قبل الترحيل؛ نقص mapping → رفض واضح.

---

## 6. Journal Debit / Credit Design

### 6.1 الشكل المفاهيمي

```
مدين:
  مصروف الرواتب / المخصصات / …          (مجمّع حسب حساب المصروف)
  مصروف مساهمة صاحب العمل                 (إن وُجد)

دائن:
  استقطاعات / ضرائب / ضمان مستحقة         (مجمّع حسب حساب الالتزام)
  مساهمة صاحب العمل المستحقة              (إن فُصلت)
  صافي الرواتب المستحقة                   (الباقي الموازن)
```

**معادلة التوازن الملزمة:**

```
Σ expenses + Σ employer_exp
  = Σ deduction_liabilities + Σ employer_payables + net_payable
  (+ rounding line إن لزم بقيمة صغيرة على حساب ROUNDING)
```

يجب أن تطابق مجاميع الملخص المعتمد (gross / deductions / employer / net) ضمن تسوية التقريب الموثّقة.

### 6.2 استراتيجية التجميع — **موصى بها**

| خيار | القرار |
|------|--------|
| سطر GL لكل موظف | **مرفوض في 9.C.1** — يضخم الأستاذ ويعقّد القفل/التحقق |
| تجميع حسب `account_id` (+ `cost_center_id` عند الإلزام أو التوفّر المتسق) | **معتمد** |
| تفاصيل الموظفين | Snapshot + شاشات الرواتب |

**Traceability:**

- رأس القيد: `source_type = 'PAYROLL_RUN'`, `source_id = payroll_run_id`.
- `entry_type = 'SALARY'`.
- `reference_number` = رقم التشغيل أو رمز الفترة (يُحدَّد في التنفيذ).
- وصف الرأس: «ترحيل رواتب — {run_number} — {period}».
- وصف السطر: اسم الحساب + نوع البند (مصروف/التزام/صافي).
- اختياري لاحقًا: `reference_type='PAYROLL_COMPONENT'` على سطور مكوّن دون فتح سطر لكل شخص.

### 6.3 الأبعاد

- البعد الوحيد على السطر اليوم: `cost_center_id`.
- إن تعارضت مراكز الكلفة داخل نفس الحساب عند التجميع: **تقسيم السطر حسب مركز الكلفة** (لا دمج مراكز مختلفة في سطر واحد).
- لا `department_id` على سطور القيد في المخطط الحالي.

### 6.4 التواريخ

| حقل | سياسة مقترحة |
|-----|----------------|
| `entry_date` | تاريخ نهاية فترة الرواتب افتراضيًا · أو `posting_date` إن مُرّر وبقي ضمن الفترة المالية |
| `posting_date` (طلب API) | اختياري · افتراضي = `entry_date` · يجب ضمن `fiscal_period` المفتوحة |
| تاريخ الوثيقة المحاسبي | `entry_date` على `journal_entries` |

### 6.5 رقم المستند

- عبر `allocateJournalEntryNumber` الموجود (تسلسل per fiscal year).
- يُحجز **داخل نفس Tx** بعد التحقق وقبل الإدراج.
- Replay لا يخصص رقمًا جديدًا.

---

## 7. Rounding

- العملة IQD · دقة النظام الحالية `NUMERIC(18,3)` على القيود.
- أي فرق تجميع ≤ عتبة صغيرة (تُثبَّت في التنفيذ، مثل 0.001–1.000 حسب سياسة IQD) يُرحَّل إلى حساب `ROUNDING`.
- فرق أكبر → **رفض** (انحراف منطق / mapping).
- لا إخفاء فروقات داخل Net payable دون توثيق.

---

## 8. Currency

- 9.C.1: **IQD فقط** (متسق مع Calculate/Recalculate).
- عملات أخرى → مؤجّلة.

---

## 9. Fiscal Period Policy

1. يُشتق `fiscal_period_id` من ربط `payroll_periods.fiscal_period_id` إن وُجد؛ وإلا يُحل بالـ `entry_date` عبر `assertFiscalContextForEntry`.
2. الفترة يجب `OPEN` · السنة `ACTIVE`.
3. إغلاق الفترة أثناء Post × Close: قفل الفترة/سياق القيود يضمن فائزًا واحدًا — إما ترحيل ينجح قبل الإغلاق أو يُرفض بعد الإغلاق.
4. لا ترحيل على فترة `LOCKED`/`CLOSED`.

---

## 10. Posting Core — `postPayrollRunCore`

### 10.1 التدفق

1. Begin transaction.
2. **Lock order** (انظر §11).
3. Idempotency lookup بالـ `request_key_hash`.
4. تحميل Run `FOR UPDATE` · فحص `version`/`updated_at`.
5. Validate `APPROVED` + guard + لا SUCCESS posting سابق.
6. Verify approval chain (نواة خفيفة داخل Tx).
7. Validate snapshot hashes.
8. Load approved snapshot artifacts فقط (people/lines المجمدة).
9. Resolve GL mappings لكل مكوّن/بند.
10. Build aggregated balanced journal lines.
11. Validate totals + rounding policy.
12. `assertFiscalContextForEntry`.
13. Reserve document sequence (`allocateJournalEntryNumber`).
14. Insert `journal_entries` (`SALARY`, `POSTED`, source…).
15. Insert `journal_entry_lines`.
16. Insert `payroll_run_postings` SUCCESS.
17. Update Run → `POSTED` + حقول الترحيل + `version++`.
18. Audit `payroll_run.posted`.
19. Commit.
20. على تعارض/فشل متوقع: Audit blocked/failed حسب النمط 9.B ثم خطأ عربي عام.

### 10.2 فشل منتصف الطريق

- أي استثناء قبل Commit → Rollback كامل.
- لا يُترك Run على `POSTING`.
- لا journal يتيم (UNIQUE source يمنع إعادة الإدراج الجزئي بعد commit فاشل — وفي rollback لا يبقى شيء).

---

## 11. Lock Order (نهائي معتمد)

**لا** يُحجز Document Allocator قبل قفل Payroll Run.

الترتيب المعتمد داخل `postPayrollRunCore` (متوافق مع `acquireAccountingResourceLocks` الحتمي بالفرز + أقفال صفية):

1. **Fiscal / Accounting Period** — التحقق + قفل سياق الفترة المالية عند الحاجة.
2. **Payroll Period** — `payrollPeriodLock` + `FOR UPDATE` عند اللزوم.
3. **Payroll Run** — `payrollRunLock` + `SELECT … FOR UPDATE`.
4. **Idempotency / Posting identity** — lookup صف `payroll_run_postings` / `journalSourceLock('PAYROLL_RUN', runId)` ضمن مجموعة أقفال مفرّزة.
5. **Required mapping / chart accounts** — `chartAccountLock` لكل حساب مطلوب بترتيب UUID حتمي عبر `acquireAccountingResourceLocks`.
6. **Document sequence allocator** — `acquireJournalEntriesLock` / `documentSequenceLock` **بعد** ثبات أهلية الترحيل.
7. **Journal Entry source / related rows** — عند الإدراج.

لماذا بلا deadlock: كل موارد `acquireAccountingResourceLocks` تُفرز بـ `localeCompare` عالميًا؛ Allocator العام رقم قفل ثابت يُؤخذ بعد استقرار Run؛ لا دائرة عكسية مع سندات البنك/الصندوق التي تأخذ domain locks ثم allocator.

---

## 12. Idempotency

| عنصر | قيمة |
|------|------|
| Namespace | `payroll-post` |
| Same key + same payload | **Replay** (نفس journal · لا رقم جديد · لا version++ · لا صف posting جديد · لا audit نجاح مكرر) |
| Same key + different payload | **409 IDEMPOTENCY_CONFLICT** |
| Corrupt identity | **INTEGRITY conflict** |
| بعد `POSTED` | Replay يعمل |

**Canonical payload (فقط):**

- `payroll_run_id`
- `expected version`
- `expected updated_at`
- `posting_date` (بعد التطبيع)
- `normalized comment` إن قُبل في Core
- `confirmation` إن ضمن العقد

**لا يتضمن من العميل:** actor · snapshot hash · journal number · totals · GL lines.

---

## 13. Concurrency Matrix

| تسابق | النتيجة المتوقعة |
|-------|-------------------|
| Post × Post | واحد SUCCESS · الآخر replay أو تعارض حالة |
| Post × Reversal | غير موجود في 9.C.1 |
| Post × Approve/Reject/Recalc | الطرف الثاني مرفوض بالحالة/القفل |
| Post × Period close | واحد ينجح أو الترحيل يُرفض بفترة غير OPEN |
| Post × Manual journal على نفس source | ممنوع بـ UNIQUE source؛ التعديل اليدوي لقيد SALARY المرحّل **سياسة: ممنوع في 9.C** (تحقق Verify) |
| Post × Sequence | لا أرقام مكررة |

---

## 14. Reversal Policy

| خيار | القرار |
|------|--------|
| A. Posting فقط الآن | **معتمد لـ 9.C.1** |
| B. Posting + Reversal Core | 9.C.2 |
| C. Void قبل اعتماد القيد | غير منطقي — القيد يُنشأ POSTED مباشرة |

**مبررات التأجيل:**

- نمط `createReversalEntry` جاهز في الأستاذ ويُعاد استخدامه لاحقًا.
- إدخال `REVERSED` على Run الآن يوسّع CHECK/UI/Verify بلا حاجة تسليم الترحيل الأول.
- التصحيح المحاسبي بعد الترحيل يجب أن يكون **قيد عكس** لا حذف ولا Void لصفر السجل.

**في 9.C.1 صراحةً:** لا Delete · لا Void · لا Reverse API للرواتب.

---

## 15. Audit

| حدث | المكان |
|-----|--------|
| نجاح | `payroll_run.posted` + صف `payroll_run_postings` |
| حظر | `payroll_run.posting_blocked` |
| فشل تقني | `payroll_run.posting_failed` |

**ممنوع في Audit:** raw key · request body كامل · snapshot_json · SQL · stack.

---

## 16. Public API (لاحقًا — لا تنفيذ)

```
POST /api/accounts/payroll/runs/[id]/post
```

**Capability:** `payroll_post` عبر `assertPayrollCapability`.

**Request:**

```json
{
  "version": 12,
  "updated_at": "2026-07-20T10:00:00.000Z",
  "idempotency_key": "…",
  "posting_date": "2026-01-31",
  "comment": null,
  "confirmation": true
}
```

**Response نجاح (مبدئي):**

```json
{
  "success": true,
  "data": {
    "run": { "id": "…", "status": "POSTED", "version": 13 },
    "posting": {
      "id": "…",
      "journal_entry_id": "…",
      "entry_number": "…",
      "posted_at": "…",
      "totals": { "debit": "…", "credit": "…" }
    },
    "replayed": false
  }
}
```

| Status | معنى |
|--------|------|
| 200 | نجاح أو replay |
| 400 | تحقق إدخال / تاريخ |
| 403 | لا صلاحية |
| 404 | Run غير مرئي/مفقود |
| 409 | حالة · idempotency · stale version · فترة |
| 422 | mapping ناقص · عملة · توازن |
| 500 | فشل تقني مع رسالة عامة |

---

## 17. UI (لاحقًا — لا تنفيذ)

- زر «ترحيل الرواتب إلى الأستاذ» يظهر فقط عند `APPROVED` + `can_post`.
- Confirm dialog: ملخص مدين/دائن · تاريخ الترحيل · تحذير نهائية العملية.
- بعد النجاح: بانر `POSTED` + رقم القيد + رابط `/accounts/journal-entries/[id]`.
- إخفاء Recalculate/Submit/Approve/Reject/Cancel.
- لا شاشة Payments هنا.

---

## 18. Verify — `accounts:verify-payroll-posting`

يكشف على الأقل:

1. `POSTED` بلا journal / بلا posting SUCCESS.
2. posting SUCCESS بلا Run أو بلا journal.
3. journal `source_type/source_id` غير مطابق.
4. hash mismatch (`posted` ≠ `approved` ≠ current عند POSTED).
5. debit ≠ credit على القيد.
6. مجاميع القيد ≠ ملخص التشغيل (خارج سياسة التقريب).
7. أكثر من SUCCESS posting لنفس Run.
8. فترة مالية خاطئة / مغلقة على قيد مرحّل تاريخيًا (تحذير/strict).
9. حسابات غير posting / غير نشطة على السطور.
10. raw idempotency key في Audit.
11. duplicate request identity.
12. `APPROVED` بحقول posted جزئية غير NULL.
13. `POSTED` بلا اعتماد صالح / بلا action APPROVED.
14. تعديل مشتبه لسطور القيد بعد الترحيل (إن أمكن كشف الانحراف عن بصمة محفوظة — اختياري عبر hash سطور في 9.C.2).
15. تناقضات reversal عند تفعيل 9.C.2.

Empty env: `ok=true`, `mismatch_count=0`.

---

## 19. Acceptance Test Plan (مجموعات — بلا كتابة الآن)

| مجموعة | أمثلة |
|--------|------|
| Migration | CHECK POSTED · FKs · UNIQUE SUCCESS |
| GL mapping | حل Hybrid · نقص mapping → 422 |
| Posting success | APPROVED→POSTED + journal |
| Balancing | مدين=دائن |
| Snapshot integrity | رفض عند drift |
| Approval integrity | رفض بلا action / SoD تاريخي فاسد |
| Idempotency | replay / conflict |
| Concurrency | post×post |
| Fiscal | CLOSED/LOCKED مرفوض |
| Permissions | capability |
| IDOR | 404 |
| Audit | لا تسريب |
| Failpoints | بعد insert journal → rollback نظيف |
| Verify | corrupt cases |
| Cleanup | صفر بقايا اختبار |
| Regression | 9.B + calculate/recalculate |

---

## 20. تقسيم التنفيذ المقترح (بعد اعتماد المعمارية)

| مرحلة | المحتوى |
|-------|---------|
| **9.C.1** | Migration 098 + `postPayrollRunCore` + Verify core |
| **9.C.1.b** | API `POST …/post` + DTO |
| **9.C.1.c** | UI زر الترحيل |
| **9.C.2** | Reversal |
| لاحقًا | Payments · Payslips |

---

## 21. Deferred Items

- Payments / payment batches / bank files.
- Payslips.
- Reversal / Run status `REVERSED`.
- Multi-currency.
- سطور GL per employee.
- Override mapping من شاشة الترحيل.
- تعديل يدوي لقيد SALARY المرحّل.
- Notification.
- Multi-level post approval (قيد الرواتب يُنشأ POSTED مباشرة؛ لا workflow يدوي DRAFT→… للرواتب).

---

## 22. Risks

| خطر | تخفيف |
|-----|--------|
| Mapping ناقص عند أول ترحيل إنتاجي | Verify readiness + رسالة 422 واضحة + دليل إعداد خرائط |
| تضخم سطور إن كُسر قرار التجميع | اختبارات تفرض سقف تجميع |
| إغلاق فترة أثناء الترحيل | lock order + رفض صريح |
| Double post | UNIQUE source + UNIQUE SUCCESS + idempotency |
| انحراف عن اللقطة المعتمدة | hashes إلزامية + منع mutate بعد APPROVED |
| تعقيد reversal مبكر | تأجيل 9.C.2 |

---

## 23. قرارات كانت مفتوحة — **اعتُمدت**

1. Option A بلا `POSTING` — **معتمد**.
2. إدراج `POSTED` في live-regular index — **معتمد**.
3. جدول `payroll_run_postings` — **معتمد**.
4. تأجيل Reversal إلى 9.C.2 — **معتمد**.
5. تجميع حسب الحساب (+ مركز كلفة) — **معتمد**.
6. Hybrid mapping على 094 — **معتمد**.
7. قيد `SALARY` / `POSTED` مباشرة — **معتمد**.
8. افتراضي `posting_date` = نهاية فترة الرواتب · إن غير صالح → رفض — **معتمد**.
9. عتبة التقريب **≤ 1 IQD** مركزية — **معتمدة**.
10. لا SoD إلزامي Approver≠Poster في 9.C.1 — **معتمد** (قابل للتفعيل لاحقًا).

---

## 24. خلاصة القرار

| الموضوع | القرار |
|---------|--------|
| Final statuses | إضافة `POSTED` في 098 |
| Migration 098 | CHECK + حقول posted_* + جدول postings |
| Posting table | نعم · نجاح واحد · append-only تطبيقيًا |
| Journal aggregation | حسب GL (+ cost center) |
| GL mapping | Hybrid موجود |
| Currency | IQD |
| Rounding | ≤ 1 IQD وإلا رفض |
| Reversal | مؤجّل 9.C.2 |
| Payment / Payslip | مستبعدان |
| API/UI | بعد Core |
| Verify | `verify-payroll-posting` |
| Lock order | Period(fiscal) → Period(payroll) → Run → identity → accounts → allocator → journal source |
| Idempotency | `payroll-post` |
| Snapshot | معتمدة فقط |

---

**الوثيقة معتمدة. التنفيذ يبدأ في 9.C.1 · بلا Push.**
