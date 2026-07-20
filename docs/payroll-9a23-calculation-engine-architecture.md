# 9.A.2.3 — Payroll Calculation Engine Architecture

> **الحالة:** Architecture Approved  
> **النوع:** تصميم معتمد — لا Code · لا Migration · لا API · لا Commit · لا Push في هذه الوثيقة  
> **Stable Baseline:** `f65ee9e` — `fix(accounts): harden payroll snapshot acceptance 9A22`  
> **المراجع الملزمة:**  
> - `docs/payroll-9a2-architecture-plan.md` (D3–D27)  
> - `docs/payroll-9a21-implementation.md`  
> - `docs/payroll-9a22-snapshot-schema.md`  
> - Migrations **094 / 095 / 096 Frozen** — **لا Migration 097**؛ حقول 095 فقط  

---

## 1. Current Baseline

| عنصر | قيمة |
|------|------|
| HEAD / Baseline | `f65ee9e` |
| 9.A.1 | Accepted |
| 9.A.2.1 | Accepted |
| 9.A.2.2 | Accepted |
| 9.A.2.3 Architecture | **Approved** |
| 094 / 095 / 096 | Frozen — لا تعديل |
| Migration 097 | **مرفوضة** — غير مطلوبة |
| جداول اللقطة | `payroll_run_people` · `payroll_run_lines` · `payroll_run_issues` |
| حالات Run | `DRAFT` · `CALCULATING` · `CALCULATED` · `CANCELLED` (095) |
| حقول Run المستخدمة | `people_count`, `gross_total`, `deduction_total`, `employer_contribution_total`, `net_total`, `warning_count`, `error_count`, `snapshot_hash`, `calculation_request_id`, `last_calculation_request_id`, `calculation_attempt_number`, `calculated_at/by` — **بدون** `calculation_started_at` |

---

## 2. Goals

محرك احتساب **حتمي · ذرّي · قابل للتدقيق** ينفّذ على `payroll_runs`:

1. Validate Period + Run  
2. `DRAFT → CALCULATING`  
3. Resolve Scope → أشخاص مؤهلون  
4. Resolve عقد فعّال / Assignments / Component Assignments  
5. بناء Snapshot حتمي + Hash  
6. حساب Lines (Earnings / Deductions / Employer Contributions) للطرق المنفّذة فقط  
7. Issues + Person totals + Run totals  
8. `CALCULATING → CALCULATED` عند اكتمال العملية **تقنيًا** مع Persist ذرّي (قد يكون `error_count > 0`)  

**لا ترحيل محاسبي · لا دفع · لا Approval · لا Attendance.**

---

## 3. Non-Goals (خارج 9.A.2.3)

- Recalculate API / UI نشط (حدود واضحة → **9.A.2.4** وفق D25)  
- `CUSTOM_FORMULA` execution  
- `QUANTITY_X_RATE` / `DAYS_*` / `HOURS_*` / `LECTURES_*` / `MANUAL_AMOUNT` كتنفيذ كامل (تُرفض بـ Issue)  
- `GROSS_EARNINGS` / `SELECTED_COMPONENTS` / `COMPONENT_REFERENCE`  
- Dependency Graph / Circular detection  
- Posting / Journal / Payments  
- تعديل 094/095/096  
- Migration 097 أو أي عمود جديد على `payroll_runs`  
- Preview API يكتب نتائج  

---

## 4. Frozen Decisions (موروثة — لا تُعاد مناقشتها)

| ID | القرار |
|----|--------|
| D3 | صافٍ سالب مسموح في `CALCULATED` + **Warning** |
| D14 | لا Formula Engine؛ `CUSTOM_FORMULA` → Blocking Error |
| D16 | حارس شخص حيّ لكل Period عبر `superseded` |
| D18 | أساس: `NONE` / `CONTRACT_BASIC` فقط؛ لا hardcode لكود مكوّن |
| D19 | كمية: `MANUAL`/`ASSIGNMENT` فقط؛ المحجوز → Blocking |
| D20 | تقريب **على مستوى السطر** بمقياس العملة (IQD = 0) — سياسة التقريب النهائية: **ROUND_HALF_UP** (انظر §10) |
| D21 | Issues في جدول مستقل |
| D22 | Transaction واحدة لكل Run؛ فشل تقني ⇒ Rollback كامل؛ لا `CALCULATING` عالق |
| D23 | Idempotency key على Calculate |
| D24 | SHA-256 + canonicalize |
| D25 | Recalculate لاحقًا على نفس Run (حذف/إعادة بناء) — **تأجيل التنفيذ إلى 9.A.2.4** |
| D26 | لا VOID في 9.A.2 |
| Capability | `payroll_calculate` = **admin فقط** |

---

## 5. Scope Resolution

**`calculation_date` = `payroll_runs.calculation_date`** (منسوخ من Period عند الإنشاء) — **لا** تاريخ الخادم.

الحل تحت **قفل Period + Run** ثم استعلام Snapshot (قراءة متسقة داخل نفس Transaction). تغيّر Scope أثناء الاحتساب مستحيل لأن Run مقفول وScope لا يُعدَّل إلا في `DRAFT` (موجود).

| Scope | مصدر الأشخاص | شرط النشاط | عقد؟ | ترتيب حتمي | قائمة فارغة |
|-------|--------------|------------|------|------------|-------------|
| **ALL** | كل `payroll_people` السارية عند `calculation_date` | `status=ACTIVE` و`effective_from ≤ calc_date` و(`effective_to` NULL أو ≥) | يُحل لاحقًا لكل شخص | `person_code ASC, id ASC` | Warning `RUN_EMPTY_SCOPE` → Run `CALCULATED` بـ 0 أشخاص |
| **DEPARTMENT** | `department_id = scope_ref_id` + نفس شروط النشاط | كما أعلاه | كما أعلاه | كما أعلاه | Warning فارغ |
| **COLLEGE** | عبر مسار الكلية الحقيقي (أدناه) — **ليس** DEPARTMENT | كما أعلاه | كما أعلاه | كما أعلاه | Warning فارغ |
| **COST_CENTER** | تكليف فعّال `payroll_assignments.cost_center_id = scope_ref_id` فقط — **ليس** `default_cost_center_id` | كما أعلاه + تكليف يغطي التاريخ | كما أعلاه | كما أعلاه | Warning فارغ |
| **PERSON_LIST** | أعضاء `payroll_run_scope_members` فقط | عضو موجود؛ الأهلية تُقيَّم لاحقًا | كما أعلاه | ترتيب الإدراج ثم `person_code, id` | **422 قبل أي تغيير حالة** — انظر §30 O2 |

> **توضيح إصداري (9.A.2.3.1):** احتساب الرواتب الحالي يدعم **IQD فقط**.
> أهلية COST_CENTER = `assignment.cost_center_id` فقط؛ `default_cost_center_id` إداري ولا يُدخل الشخص في نطاق COST_CENTER.

### COLLEGE — مسار الحل المعتمد (O1)

**لا يُعامل COLLEGE كـ DEPARTMENT أبدًا.**

مسار الاستعلام الموثّق:

```text
colleges
  ← departments.college_id
    ← payroll_assignments.department_id
      ← payroll_people
```

القواعد:

1. `scope_ref_id` = معرّف كلية في `colleges`.  
2. أقسام النطاق: كل `departments` حيث `college_id = scope_ref_id`.  
3. تكليفات نشطة: `payroll_assignments` حيث `department_id` ضمن تلك الأقسام، و`status=ACTIVE`، وفعّالة على `calculation_date` (`effective_from ≤ calculation_date` و (`effective_to` IS NULL أو `≥ calculation_date`)).  
4. الأشخاص: `payroll_people` المرتبطة بتلك التكليفات، مع شروط نشاط الشخص على `calculation_date`.  
5. **إزالة التكرار:** شخص واحد مرة واحدة حتى لو تعددت تكليفاته (`DISTINCT` / `DISTINCT ON (person.id)` بعد الترتيب الحتمي).

---

**تكرار شخص داخل نتيجة Resolve (كل النطاقات):** يُزال بـ `DISTINCT ON (id)` بعد الترتيب — مصدر واحد لكل شخص.

**PERSON_LIST + شخص غير مؤهل:** يُنشأ `run_person` بحالة `ERROR` أو `EXCLUDED` + Issue — لا يُحذف من الأثر.

---

## 6. Eligibility Rules

تُقيَّم بعد إدراج مرشّح Scope، على `calculation_date`.

| قاعدة | نتيجة |
|-------|--------|
| Person ليس `ACTIVE` أو خارج فترة فعاليته | **Exclude** (`EXCLUDED`) + Issue غير حاجب `PERSON_INACTIVE` إن جاء من PERSON_LIST؛ من Scope هيكلي يُسقَط قبل الإدراج |
| لا عقد `ACTIVE` يغطي `calculation_date` | **Include** كصف + `ERROR` + Blocking `NO_ACTIVE_CONTRACT` |
| أكثر من عقد `ACTIVE` يغطي التاريخ | **Include** + Blocking `MULTIPLE_ACTIVE_CONTRACTS` (لا اختيار تلقائي) |
| عقد موقوف/منتهٍ فقط | نفس `NO_ACTIVE_CONTRACT` |
| `contract.currency_code ≠ run.currency_code` | Blocking `CURRENCY_MISMATCH` |
| عملة الشخص الافتراضية تخالف Run والعقد صالح | Warning `PERSON_CURRENCY_DIFFERS` (العقد يحكم) |
| PERSON_LIST يشير لشخص غير موجود | يُرفض أصلًا عند add member (موجود) |
| لا استحقاقات بعد Resolve المكوّنات | Warning `NO_EARNINGS`؛ الشخص قد يبقى `CALCULATED` بصافي 0 |

**تصنيف مختصر**

- **Include:** مؤهل أو يحتاج Issues مع صف لقطة  
- **Exclude:** خارج Scope الفعلي / غير نشط هيكليًا  
- **Blocking Error:** يمنع `calculation_status=CALCULATED` للشخص → `ERROR`  
- **Non-blocking Warning:** يسمح `CALCULATED` مع عدّاد تحذيرات  

عند اكتمال Run بنجاح تقني: حالات الأشخاص = `CALCULATED` | `ERROR` | `EXCLUDED` فقط — **لا** يبقى أي شخص `PENDING`.

---

## 7. Contract Resolution

لكل شخص مدرج:

1. ابحث عقود `payroll_person_id` بحالة `ACTIVE` حيث  
   `effective_from ≤ calculation_date` و (`effective_to` IS NULL أو `≥ calculation_date`).  
2. إن 0 → `NO_ACTIVE_CONTRACT`.  
3. إن >1 → `MULTIPLE_ACTIVE_CONTRACTS`.  
4. إن 1 → اعتمده؛ خزّن `payroll_contract_id` + لقطة في Snapshot.  
5. `basic_amount` (حقل الشخص) = `contract.base_amount` المطبّع (للعرض ولأساس `CONTRACT_BASIC`) — **لا يُضاف تلقائيًا إلى Gross** (انظر §11 سياسة B).

لا تُستخدم عقود `DRAFT`/`SUSPENDED`/`TERMINATED`/`EXPIRED`/`CANCELLED`.

---

## 8. Component Resolution

### 8.1 مصادر الأسطر

لكل شخص بعقد صالح (وإلا لا Lines إلا Issues):

1. حمّل `payroll_component_assignments` حيث:  
   - `payroll_person_id` = الشخص  
   - `is_active = TRUE`  
   - يغطي `calculation_date`  
   - المصدر: `payroll_contract_id = العقد` **أو** `payroll_assignment_id` لتكليف نشط يغطي التاريخ **أو** (شخص فقط: كلاهما NULL)  
2. المكوّن الأم `payroll_components.is_active = TRUE` ويغطي التاريخ؛ وإلا Issue `INACTIVE_COMPONENT` (Blocking للسطر/الشخص حسب الكيان).  
3. الطريقة الفعلية = `COALESCE(override_calculation_method, component.calculation_method)`.  
4. الأساس = `component.calculation_base_type`.

### 8.2 Source Identity (متوافق 096)

```
(person_run_id, component_id,
 COALESCE(assignment_id, 0),
 COALESCE(component_assignment_id, 0))
```

- **سطر واحد لكل Source Identity.**  
- لا يُسمح بسطرين لنفس الهوية.  
- **Manual Override:** في 9.A.2.3 **غير مُنفَّذ كمسار مستخدم**؛ إن وُجد لاحقًا يستبدل Generated لنفس الهوية (صف واحد، `line_source=MANUAL_OVERRIDE`).  

### 8.3 ترتيب الأسطر (حتمي)

1. نوع المكوّن: `EARNING` → `DEDUCTION` → `EMPLOYER_CONTRIBUTION`  
2. داخل النوع: مستقل (`NONE`) قبل `CONTRACT_BASIC`  
3. `priority ASC` (من PCA؛ افتراضي 100)  
4. `component_code ASC`  
5. `payroll_component_assignment_id ASC`  

`sequence` = 1..n بهذا الترتيب (لا فجوات).

### 8.4 Double counting

- لا دمج تلقائي لمكوّنات متشابهة الأكواد من مصادر مختلفة — أسطر متعددة مسموحة بهويات مختلفة؛ الإجمالي = المجموع.  
- منع التكرار لنفس الهوية على مستوى DB + محرك.

### 8.5 Assignment منتهٍ / غير نشط

يُستبعد من المرشّحين؛ لا Issue إلا إذا PERSON_LIST توقّع وجوده (اختياري لاحقًا).

---

## 9. Calculation Formulas (المنفَّذ في 9.A.2.3)

الحساب الداخلي بـ **`NUMERIC` / `Decimal` بدقة ≥ 6 منازل عشرية**.  
**ممنوع** استخدام `Number` في JavaScript للمبالغ المالية.

### 9.1 FIXED_AMOUNT

- يتطلب `calculation_base_type = NONE`؛ وإلا Blocking `UNSUPPORTED_BASE`.  
- المبلغ = `COALESCE(pca.amount, component.default_amount)` كـ Decimal.  
- غياب المبلغ → Blocking `INVALID_AMOUNT`.  
- بعد التقريب لمقياس العملة: `calculated_amount` المخزّن.

### 9.2 PERCENTAGE_OF_BASIC

- يتطلب `calculation_base_type = CONTRACT_BASIC`؛ وإلا Blocking `UNSUPPORTED_BASE`.  
- الأساس = `contract.base_amount` كـ Decimal.  
- `percentage` من PCA (إلزامي) — DB يقيّد `0..100`.  
- `raw = base × percentage / 100` بدقة داخلية ≥ 6.  
- ثم **ROUND_HALF_UP** إلى مقياس العملة قبل التخزين (انظر §10).

### 9.3 غير المنفَّذ → Blocking Issue (لا crash)

لكل سطر/مكوّن: `UNSUPPORTED_METHOD` أو `UNSUPPORTED_BASE` أو `UNSUPPORTED_QTY_SOURCE`  
الشخص → `ERROR` إن وُجد Blocking.

**شخص ERROR (O4):** Issues حاجبة فقط؛ **لا أسطر مالية**؛ totals الشخص = 0؛ يُحسب في `people_count` و`error_count`؛ **يُستبعد من** gross/deduction/employer/net على مستوى Run.

**Blocking على مستوى الشخص لا يمنع** Commit الـ Run كـ `CALCULATED` (نجاح تقني + Persist ذرّي).

---

## 10. Rounding (قرار صريح واحد — معتمد)

**السياسة المعتمدة: ROUND_HALF_UP (ليس floor / ليس trunc).**

1. الحساب الداخلي: `NUMERIC` / `Decimal` بدقة **≥ 6** منازل.  
2. **لا** `Number` في JS للمال.  
3. كل Line يُقرَّب إلى مقياس العملة **قبل التخزين** (`ROUND_HALF_UP`).  
4. `currency_scale(IQD) = 0`.  
5. **Totals = SUM للأسطر المخزّنة المقرَّبة** — لا تقريب ثانٍ على الإجمالي.  
6. `percentage > 100`: مرفوض أصلًا بـ CHECK على PCA؛ إن ظهر عبر مسار فاسد → Blocking `INVALID_PERCENTAGE`.  
7. صفر مسموح. سالب على Line غير مسموح (CHECK موجود).

**أمثلة ملزمة (IQD, scale=0):**

| العملية | نتيجة داخلية | مخزّن |
|---------|---------------|--------|
| `1000 × 12.5%` | `125` | `125` |
| `1001 × 12.5%` | `125.125` | `125` |
| `1004 × 12.5%` | `125.5` | `126` |

---

## 11. Basic Salary Policy (سياسة B — معتمدة)

### الخيار A — مرفوض  
عقد `base_amount` يُضاف كـ Gross دون Component → خطر **double counting** ويخالف Zero Hardcoded.

### الخيار B — أساسي العقد = Base فقط (**معتمد**)

| حقل | المعنى |
|-----|--------|
| `run_people.basic_amount` | = `contract.base_amount` (مرجع + أساس نسبة) |
| `gross_amount` | **Σ calculated_amount لأسطر `EARNING` فقط** |
| `deductions_amount` | Σ أسطر `DEDUCTION` |
| `employer_contributions_amount` | Σ أسطر `EMPLOYER_CONTRIBUTION` (**لا تدخل في الصافي**) |
| `net_amount` | `gross_amount − deductions_amount` (قد يكون سالبًا → Warning `NEGATIVE_NET`) |

**لظهور الأساسي في الراتب المدفوع:** يجب وجود Component Assignment من نوع `EARNING`.  
لا يُستخدم `component_code === 'BASIC_*'`.

**تحذير سلوكي صحيح:** قد يكون `gross_amount = 0` مع `basic_amount > 0` إذا لم يُعيَّن أي مكوّن `EARNING` — هذا **سلوك صحيح** بموجب السياسة B، وليس خللًا.

**القرار النهائي: B.**

---

## 12. Ordering (ملخص)

1. Earnings بـ `NONE`  
2. Earnings بـ `CONTRACT_BASIC`  
3. Deductions  
4. Employer Contributions  

ثم priority → code → pca id. لا اعتماد على ترتيب صفوف SQL غير مفرز.

---

## 13. Issues Model

| Code | Severity | Blocking | Entity | نطاق الأثر | رسالة عربية (ملخص) |
|------|----------|----------|--------|------------|---------------------|
| `NO_ACTIVE_CONTRACT` | ERROR | نعم | PERSON | شخص | لا يوجد عقد فعّال في تاريخ الاحتساب |
| `MULTIPLE_ACTIVE_CONTRACTS` | ERROR | نعم | PERSON | شخص | أكثر من عقد فعّال في تاريخ الاحتساب |
| `CURRENCY_MISMATCH` | ERROR | نعم | CONTRACT | شخص | عملة العقد تخالف عملة التشغيل |
| `UNSUPPORTED_METHOD` | ERROR | نعم | COMPONENT/PCA | شخص | طريقة احتساب غير مدعومة في هذه المرحلة |
| `UNSUPPORTED_BASE` | ERROR | نعم | COMPONENT | شخص | أساس احتساب غير متوافق مع الطريقة |
| `UNSUPPORTED_QTY_SOURCE` | ERROR | نعم | LINE/PCA | شخص | مصدر كمية محجوز |
| `INVALID_AMOUNT` | ERROR | نعم | PCA | شخص | مبلغ ثابت مفقود/غير صالح |
| `INVALID_PERCENTAGE` | ERROR | نعم | PCA | شخص | نسبة غير صالحة |
| `INACTIVE_COMPONENT` | ERROR | نعم | COMPONENT | شخص | مكوّن غير نشط أو خارج السريان |
| `DUPLICATE_COMPONENT_SOURCE` | ERROR | نعم | LINE | شخص | تكرار هوية مصدر (يجب ألا يحدث بعد الحارس) |
| `SCOPE_PERSON_INELIGIBLE` | WARNING | لا | PERSON | شخص | عضو قائمة غير مؤهل هيكليًا |
| `NO_EARNINGS` | WARNING | لا | PERSON | شخص | لا استحقاقات محسوبة |
| `NEGATIVE_NET` | WARNING | لا | PERSON | شخص | صافي سالب |
| `RUN_EMPTY_SCOPE` | WARNING | لا | RUN | Run | لا أشخاص في النطاق |
| `RUN_EMPTY_PERSON_LIST` | ERROR | نعم | RUN | **رفض قبل البدء (422)** | قائمة أشخاص فارغة |
| `SNAPSHOT_VALIDATION_FAILED` | ERROR | نعم | PERSON | شخص | فشل تحقق اللقطة |
| `HASH_GENERATION_FAILED` | ERROR | نعم | RUN | **Rollback تقني** | فشل توليد البصمة |

- لا Stack / SQL / Request Body في `details_json`.  
- تكرار نفس Code لنفس الكيان: يُفضَّل Issue واحد لكل (code, entity).

**Blocking على مستوى Run قبل البدء:** `RUN_EMPTY_PERSON_LIST` → **422** قبل تغيير الحالة وقبل clear/snapshots/issues — **لا** Audit Started (O2).  
باقي Blocking → شخص `ERROR`؛ Run يمكن أن يصبح `CALCULATED` مع `error_count > 0` (O4).

---

## 14. Lifecycle

```
DRAFT ──calculate──► CALCULATING ──technical success + atomic persist──► CALCULATED
                         │
                         └── technical failure ──rollback──► DRAFT (كما كان)
```

| حدث | السلوك |
|-----|--------|
| Blocking business على أشخاص | تُحفظ Issues + أشخاص `ERROR` (بدون lines مالية؛ totals=0)؛ Run → `CALCULATED` مع `error_count > 0` |
| `RUN_EMPTY_PERSON_LIST` | **422** قبل `CALCULATING` وقبل clear وقبل أي snapshot/issue — لا Audit Started — يبقى `DRAFT` |
| Exception / hash failure | Rollback كامل؛ Run يبقى `DRAFT`؛ لا CALCULATING عالق |
| Cancel أثناء CALCULATING | ممنوع (موجود) |
| Calculate على CALCULATED | مرفوض 409 — استخدم Recalculate في **9.A.2.4** |
| اكتمال ناجح | لا شخص بحالة `PENDING` |
| لا حالة `FAILED` جديدة | كافية Rollback + Audit `..._FAILED` |

**لا Migration لحالة جديدة.** `CALCULATING` موجودة في 095.  
**لا** `calculation_started_at`.

**حدود لاحقة (خارج 9.A.2.3.1 — توثيق فقط):** مسارات Posting / Approval / Payment المستقبلية **يجب أن ترفض** التنفيذ إذا `error_count > 0`.

---

## 15. Atomicity — الخيار A (معتمد)

**Transaction واحدة لكل Calculate (D22).**

| البعد | تقييم |
|-------|--------|
| الاتساق | أقصى — لا partial artifacts |
| الأقفال | مدة أطول لكن لنطاق كلية متوسط مقبول |
| Rollback | بسيط وموثوق |
| Concurrent | قفل Run يمنع التوازي |
| الحجم | حدّ عملي مُقدَّر: مئات–آلاف الأشخاص/Run؛ فوق ذلك يُراجع Staging لاحقًا |

لا خيار B الآن.

**CALCULATED** = نجاح تقني + Persist ذرّي داخل نفس الـ Tx (حتى مع `error_count > 0`).

---

## 16. Locks

الترتيب المنطقي المعتمد (بدون اختراع ترتيب جديد):

```
Calendar → Period → Run → (Persons/Contracts/Components للقراءة المرتّبة عند الحاجة)
```

**استراتيجية عملية 9.A.2.3:**

1. `PAYROLL_PERIOD` + `PAYROLL_RUN` advisory (إزامي).  
2. `SELECT … FOR UPDATE` على صف الـ Run.  
3. **لا** قفل آلاف الأشخاص فرادى.  
4. قراءة المصادر داخل Tx؛ تثبيت `source_versions` + `updated_at` في Snapshot.  
5. حارس الشخص (unique live) يمنع التداخل عبر Runs.  
6. منع Calculate مزدوج: حالة `CALCULATING` + قفل Run → الثاني 409.

Mapping **لا يُقفَل** في الاحتساب (غير مستخدم حتى الترحيل).

---

## 17. Idempotency (Calculate فقط)

| عنصر | تصميم |
|------|--------|
| Request | `idempotency_key` إلزامي (UUID أو مفتاح ≤64 يُخزَّن hashed→`calculation_request_id`) |
| أول نجاح | يخزّن المفتاح في `last_calculation_request_id`؛ يزيد `calculation_attempt_number` |
| إعادة نفس المفتاح بعد `CALCULATED` | **200 replay** لنفس النتيجة دون إعادة بناء |
| نفس المفتاح أثناء CALCULATING | 409 |
| مفتاح جديد على DRAFT | احتساب جديد (يمسح fixtures السابقة داخل Tx) |
| مفتاح جديد على CALCULATED | 409 — يتطلب Recalculate (9.A.2.4) |
| Stale `version`/`updated_at` | 409 |

---

## 18. Snapshot Construction

لكل شخص بعد Resolve وقبل/مع الحساب:

بناء `PayrollPersonSnapshotJson` (schema_version=1) حتميًا:

- person identity + college/department/cost_center snapshots  
- contract (أو null مع ERROR)  
- assignments مرتبة بـ `assignment_code, id`  
- `component_assignment_ids` مرتبة  
- scope metadata (`scope_type`, `scope_ref_id`, `resolved_via`)  
- `calculation_date`, `currency_code`  
- `source_versions` + source `updated_at`  

ثم `hashPayrollSnapshot` → `snapshot_hash`.  
بعد `CALCULATED`: اللقطة غير قابلة للتعديل (H7 + Recalculate في 9.A.2.4).

Run-level `snapshot_hash` = SHA-256 لسلسلة hashes الأشخاص بالترتيب الحتمي (D24).

---

## 19. Persistence Flow (داخل Tx)

1. Lock Period + Run؛ تحميل FOR UPDATE  
2. Validate status=`DRAFT`، Period `OPEN|PROCESSING`، عملة/تقويم، version، idempotency  
3. إن replay → أعد الاستجابة واخرج  
4. **تحقق PERSON_LIST فارغة → 422 واخرج فورًا** (قبل clear، قبل تغيير الحالة، قبل snapshots/issues، بدون Audit Started)  
5. `clearRunCalculationArtifacts` (مسموح في DRAFT/CALCULATING)  
6. `status=CALCULATING`؛ `calculation_attempt_number++`؛ عيّن `calculation_request_id`  
7. Resolve Scope → مرشّحون  
8. لكل شخص: Eligibility → Contract → Components → Lines → Issues → Person totals → Snapshot/Hash → insert عبر خدمات اللقطة (مع توسيع للسماح بالكتابة أثناء `CALCULATING` فقط لمسار المحرك)  
9. Aggregate Run totals + counts + `snapshot_hash` (ERROR persons في `people_count`/`error_count` فقط؛ totals مالية من غير ERROR)  
10. Validate اتساق  
11. `status=CALCULATED`؛ `calculated_at/by` — حتى إن `error_count > 0`  
12. Audit  
13. Commit  

**تعديل خدمات 9.A.2.2 المطلوب لاحقًا في التنفيذ:** السماح لمسار المحرك الداخلي بالكتابة تحت `CALCULATING` و`clear` تحت `CALCULATING`؛ Recalculate في 9.A.2.4 يحتاج استثناءً صريحًا على `CALCULATED`.

---

## 20. Run-Level Totals

تحديث حقول **موجودة في 095 فقط** — لا أعمدة جديدة:

| حقل | المصدر |
|-----|--------|
| `people_count` | عدد كل `run_people` المدرجين (يشمل `CALCULATED` و`ERROR` و`EXCLUDED`) |
| `gross_total` | Σ `gross_amount` لأشخاص غير `ERROR` (ERROR = 0 ولا تُساهم) |
| `deduction_total` | Σ `deductions_amount` (نفس الاستبعاد) |
| `employer_contribution_total` | Σ `employer_contributions_amount` (نفس الاستبعاد) |
| `net_total` | Σ `net_amount` (قد يكون سالبًا؛ ERROR مستبعدة) |
| `warning_count` / `error_count` | من Issues / عدّادات الأشخاص |
| `snapshot_hash` | hash تجميعي |
| `calculated_at` / `calculated_by` | عند النجاح التقني |
| `calculation_attempt_number` | ++ |
| `version` | ++ كالمعتاد |

**لا** `calculation_started_at`.  
**لا** Migration لإضافة `calculated_people_count` / `error_people_count` — تُشتق عند الحاجة من COUNT حسب الحالة.

---

## 21. Migration 097 — مرفوضة (O3 APPROVED)

| بند | القرار النهائي |
|-----|----------------|
| Migration 097 | **لا** |
| `calculation_started_at` | **لا** — غير مضاف |
| أعمدة إضافية على `payroll_runs` | **لا** |
| حقول التشغيل | **095 فقط** |
| 094 / 095 / 096 | **Frozen** — لا تعديل |

تنفيذ 9.A.2.3.1 و9.A.2.3.2 **بلا أي Migration جديدة**.

---

## 22. API Design (تصميم فقط)

`POST /api/accounts/payroll/runs/[id]/calculate`

**Capability:** `payroll_calculate` (admin فقط)

**Request JSON:**

```json
{
  "version": 3,
  "updated_at": "<iso>",
  "idempotency_key": "<uuid-or-key>"
}
```

**Response 200:**

```json
{
  "run": { "...serialize run..." },
  "summary": {
    "people_count": 0,
    "calculated_people": 0,
    "error_people": 0,
    "warning_count": 0,
    "gross_total": "0.000",
    "deduction_total": "0.000",
    "employer_contribution_total": "0.000",
    "net_total": "0.000"
  },
  "issues": { "blocking": 0, "warnings": 0 },
  "idempotent_replay": false
}
```

| HTTP | متى |
|------|-----|
| 400 | validation / مفتاح ناقص |
| 403 | لا صلاحية |
| 404 | Run غير موجود |
| 409 | stale version / CALCULATING / ليس DRAFT / مفتاح قيد التنفيذ |
| 422 | PERSON_LIST فارغة (قبل CALCULATING / قبل clear / قبل artifacts) |
| 500 | خطأ تقني مُعقَّم |

لا `/recalculate` في هذه المرحلة — Calculate على **DRAFT فقط**.

---

## 23. UI Boundary (تصميم فقط)

- زر **Calculate** ظاهر فقط لـ `DRAFT` + صلاحية.  
- ConfirmDialog (لا رجوع عن اللقطة بعد النجاح إلا Recalculate في 9.A.2.4).  
- حالة processing أثناء الطلب.  
- عرض totals + ملخص Issues بعد النجاح (بما فيها `error_count > 0`).  
- تعطيل التعديل أثناء CALCULATING.  
- زر Recalculate = **placeholder معطل** → يُفعَّل في 9.A.2.4.  
- لا Posting/Payment.

---

## 24. Audit

| Event | متى |
|-------|-----|
| `PAYROLL_RUN_CALCULATION_STARTED` | بعد التحويل إلى CALCULATING (لا يُسجَّل عند 422 لقائمة فارغة) |
| `PAYROLL_RUN_CALCULATED` | بعد CALCULATED |
| `PAYROLL_RUN_CALCULATION_BLOCKED` | رفض عملّي قبل/دون commit (422/409 تجاري) — يتضمن PERSON_LIST فارغة |
| `PAYROLL_RUN_CALCULATION_FAILED` | فشل تقني بعد rollback |

يسجّل: actor, run_id, period_id, attempt, counts, totals, snapshot_hash, issue counts, idempotency fingerprint.  
**لا** Snapshot JSON كامل.

---

## 25. Verify Extension (بعد المحرك)

إضافة إلى verify snapshot/periods:

- Totals Run = Σ people (مع استبعاد ERROR من الإجماليات المالية)  
- Person totals متسقة مع Σ lines حسب النوع (ERROR بلا lines)  
- لا `PENDING` تحت Run `CALCULATED`  
- لا Blocking issues لشخص `CALCULATED`  
- كل `CALCULATED` person لديه contract  
- hashes متطابقة (إعادة حساب)  
- `sequence` بلا فجوات لكل شخص  
- لا artifacts حية تحت CANCELLED إلا `superseded=TRUE`  
- `calculation_attempt_number ≥ 1` بعد أول احتساب  
- تقريب الأسطر مطابق ROUND_HALF_UP  

---

## 26. Tests Plan (ملخص)

**Happy:** شخص واحد/عدة؛ FIXED؛ PERCENTAGE؛ E/D/EC؛ صافٍ سالب؛ صفر مكوّنات.  
**Rounding:** أمثلة 1000/1001/1004 × 12.5% → 125 / 125 / 126.  
**Basic B:** `basic>0` و`gross=0` بدون EARNING assignment = سلوك صحيح.  
**Scope:** الأنواع الخمسة + COLLEGE عبر `college_id` + قائمة فارغة → 422.  
**Contracts:** لا عقد / متعدد / منتهٍ / عملة.  
**Components:** inactive / duplicate identity / unsupported / تواريخ.  
**ERROR persons:** لا lines؛ totals 0؛ في people_count وerror_count؛ خارج gross/net.  
**Concurrency:** calculate×2؛ مع cancel؛ مع period close؛ idempotent replay؛ stale version.  
**Atomicity:** فشل منتصف الشخص/السطر؛ فشل audit/hash؛ صفر partial.  
**Determinism:** نفس المصادر → نفس hash/totals؛ ترتيب SQL لا يؤثر.  
**Cleanup:** ownership + suite×2 + صفر بقايا.  
**Regression:** foundation + periods/runs + snapshot schema.

---

## 27. Recalculate Boundary

| بند | قرار معتمد |
|-----|------------|
| Calculate | **DRAFT فقط** |
| Recalculate | **خارج التنفيذ هنا** → **9.A.2.4** |
| السياسة | **D25 على نفس Run** (reason + مفتاح جديد + حذف/إعادة بناء artifacts + `attempt++`؛ لا `revision_number++`) |
| بديل Revision Run | مرفوض لهذه المرحلة |
| لماذا لا نمسح CALCULATED في 9.A.2.3 | H7 يمنع؛ الأثر محفوظ حتى Recalculate صريح في 9.A.2.4 |

---

## 28. Implementation Split (مرحلتان فقط)

### 9.A.2.3.1 — Calculation Core

- **بلا Migration** (O3)  
- Scope (بما فيه COLLEGE عبر المسار الحقيقي) + Eligibility + Contract + Component resolution  
- Formulas FIXED / PERCENTAGE + Rounding ROUND_HALF_UP  
- Snapshot + Hash + Persistence داخل Tx  
- Lifecycle DRAFT→CALCULATING→CALCULATED (مسموح `error_count>0`)  
- PERSON_LIST فارغة → 422 قبل الحالة/clear/artifacts  
- Unit/integration tests للمحرك (بلا UI)  
- تعديل محدود لخدمات اللقطة لمسار CALCULATING  

### 9.A.2.3.2 — Integration

- `POST .../calculate` + capability + idempotency  
- Audit  
- UI زر + نتائج Issues/Totals  
- Verify extensions  
- Hardening + Acceptance  
- توثيق رفض Posting/Approval/Payment لاحقًا عند `error_count>0` (خارج نطاق التنفيذ هنا)

---

## 29. Risks

| خطر | تخفيف |
|-----|--------|
| خطأ في Resolve COLLEGE | مسار موثّق: colleges ← departments.college_id ← assignments ← people؛ لا مساواة مع DEPARTMENT |
| أقفال طويلة على Run كبير | حد حجم + مراقبة مدة Tx |
| Fixtures DRAFT تلوّث الاحتساب | clear بعد اجتياز فحوصات 422 فقط |
| تعارض H7 مع Recalculate | مسار داخلي صريح في 9.A.2.4 وفق D25 |
| PERSON_LIST uniqueness (F4) | موثّق؛ لا تغيير قيد الآن |
| Double counting الأساسي | سياسة B + تحذير gross=0 مع basic>0 |
| اعتبار CALCULATED = خالٍ من الأخطاء | CALCULATED = نجاح تقني؛ Posting/Approval/Payment ترفض إن `error_count>0` |
| تقريب خاطئ بـ floor/Number | ROUND_HALF_UP + Decimal≥6 + أمثلة ملزمة |

### تناقضات سابقة — محلولة في الاعتماد

1. خطة 9.A.2.0 تذكر أحيانًا `VOID` — **095 لا يحتوي VOID** (معتمد).  
2. D25 على نفس Run هو مسار 9.A.2.4 المعتمد — لا Revision Run.  
3. H7 يمنع mutate على CALCULATED — المحرك يكتب فقط في CALCULATING.  
4. لا أعمدة إضافية عبر 097 — الاشتقاق من COUNT عند الحاجة.  
5. COLLEGE ≠ DEPARTMENT — مسار `college_id` الحقيقي معتمد (O1).

---

## 30. Approved Decisions (كانت Open — أصبحت نهائية)

| # | الموضوع | القرار النهائي المعتمد |
|---|---------|-------------------------|
| **O1** | نطاق **COLLEGE** | مسار حقيقي: `colleges ← departments.college_id ← payroll_assignments.department_id ← payroll_people`. أشخاص بتكليف ACTIVE فعّال على `calculation_date` في قسم تابع لـ `scope_ref_id` (كلية). إزالة التكرار. **لا** معاملة COLLEGE كـ DEPARTMENT. |
| **O2** | PERSON_LIST فارغة | **422** قبل تغيير الحالة، قبل clear، قبل snapshots/issues. **لا** Audit Started. يبقى DRAFT. |
| **O3** | Migration 097 | **لا Migration 097.** لا `calculation_started_at`. حقول **095 فقط**. 094/095/096 Frozen. |
| **O4** | Run مع Blocking على أشخاص | Run قد يكون `CALCULATED` مع `error_count>0`. CALCULATED = نجاح تقني + Persist ذرّي. الأشخاص عند الاكتمال: `CALCULATED` \| `ERROR` \| `EXCLUDED` فقط (لا `PENDING`). شخص ERROR: issues حاجبة، بلا lines مالية، totals=0، في `people_count` و`error_count`، خارج gross/net. Posting/Approval/Payment لاحقًا **يجب أن ترفض** إن `error_count>0` (توثيق؛ خارج 9.A.2.3.1). |
| **O5** | Recalculate | → **9.A.2.4** وفق **D25 على نفس Run**. Calculate = **DRAFT فقط**. |

---

## ملخص القرارات النهائية

| موضوع | القرار |
|-------|--------|
| الحالة | **Architecture Approved** @ baseline `f65ee9e` |
| Basic Salary | **B** — `basic_amount=contract.base_amount`؛ gross=Σ EARNING؛ net=gross−deductions؛ employer خارج الصافي |
| Rounding | **ROUND_HALF_UP** · Decimal≥6 · لا JS Number · Line قبل التخزين · IQD=0 · Totals=Σ |
| Blocking Errors | شخص → `ERROR`؛ Run يمكن `CALCULATED` مع `error_count>0` |
| Transaction | **خيار A — Tx واحدة (D22)** |
| Recalculate | **9.A.2.4 وفق D25 نفس Run** |
| Methods | FIXED_AMOUNT + PERCENTAGE_OF_BASIC فقط |
| Migration | **لا 097**؛ 094–096 Frozen |

---

*نهاية Architecture 9.A.2.3 — Architecture Approved @ `f65ee9e`. التنفيذ يتبع التقسيم 9.A.2.3.1 / 9.A.2.3.2.*
