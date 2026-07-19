# 9.A.2.0 — Payroll Periods, Runs & Calculation Engine — Architecture Plan

> **حالة الوثيقة:** **Architecture Ready for Implementation** — تصميم نهائي معتمد (Q1–Q5 محسومة، D15–D27 مثبّتة).
> **البدء المشروط:** لا يبدأ تنفيذ 9.A.2 قبل **أمر صريح** من صاحب القرار.
> **هذه الوثيقة تصميم فقط:** لا كود · لا Migration · لا API · لا UI · لا Commit · لا Push.
>
> **Baseline المعتمد:** `6a76453` — *fix(accounts): harden payroll foundation acceptance 9A1*.
> **الحالة الرسمية:** Architecture Frozen · 9.A.1 Accepted · لا ملاحظات قبول مفتوحة.
>
> **المرجعان الملزمان:**
> - `docs/payroll-9a-architecture-plan.md` (Architecture Frozen — القرارات D1–D14).
> - `docs/payroll-9a1-implementation.md` (تفاصيل التنفيذ المعتمد).
>
> **قاعدة تعديل المخطط:** **لا يُعدَّل `db/migrations/094_payroll_foundation.sql` إطلاقًا**؛ أي تغيير على جداول 9.A.1 يكون عبر **Migration جديدة (095/096)** فقط.

---

## 0. الملخص التنفيذي والنطاق

### 0.1 هدف 9.A.2
بناء طبقة **التشغيل والاحتساب** فوق سجلّ 9.A.1، وتنتهي المرحلة تمامًا عند:

```
Payroll Run = CALCULATED
```

أي: إنشاء فترات رواتب، إنشاء تشغيلات (Runs) بنطاق محدّد، تجميد قائمة الأشخاص، احتساب الأسطر والإجماليات، توليد التنبيهات/الأخطاء، والتقاط Snapshot + Hash — دون أي اعتماد أو ترحيل أو دفع.

### 0.2 خارج النطاق صراحةً (مؤجَّل)
`REVIEWED` · `APPROVED` · `POSTED` · `PAID` · القيود المحاسبية (Journal Entries) · المدفوعات · تكامل الحضور · تكامل ساعات المحاضرين · السُّلف/القروض · Payroll Batch · تنفيذ `CUSTOM_FORMULA` · جدول الاعتمادات الكامل بين المكوّنات · محرّك كشف الدورات (Circular Dependency Engine) · التقريب الخشن + سطر التقريب المستقل · `VOID` وسلسلة الإصدارات الفعلية.

### 0.3 المبادئ الحاكمة (موروثة ومُلزِمة)
1. **Zero Hardcoded Payroll Logic** — لا سلوك مالي مبني على `person_type` أو `component_code` داخل الكود. لا `BASIC_SALARY` ثابت في الكود.
2. **حساب بالمِلّي (integer millis)** عبر `moneyToMillis`/`millisToMoney`؛ لا Float للمبالغ.
3. **Effective Dating (D13)** — الاحتساب يختار الصف الساري عند **التاريخ المرجعي للتشغيل** (`calculation_date`) لا `created_at`.
4. **Optimistic Concurrency** — `version` + `updated_at` على كل كيان قابل للتعديل، 409 عند التعارض.
5. **Advisory Resource Locks** — عبر `acquireAccountingResourceLocks` (فرز حتمي عالمي يمنع Deadlock).
6. **Audit إلزامي** لكل انتقال حسّاس، والسبب في Audit metadata (سياسة H2 المعتمدة).
7. **DB خط الدفاع الأخير** — قيود فريدة/CHECK/فهارس + فحوص خدمية مسبقة تعطي أخطاء نظيفة.

### 0.4 حالة القرارات (Q1–Q5) — محسومة
| السؤال | القرار النهائي |
|-------|----------------|
| **Q1 (D18)** | **النهج B** — إضافة `payroll_components.calculation_base_type` عبر Migration 095؛ المنفّذ الآن: `NONE`, `CONTRACT_BASIC`. المحجوز: `GROSS_EARNINGS`, `SELECTED_COMPONENTS`, `COMPONENT_REFERENCE`. |
| **Q2 (Capabilities)** | توزيع نهائي (§16)؛ **`payroll_calculate` و`payroll_cancel_runs` لـ admin فقط**؛ clerk بلا calculate. |
| **Q3 (Fiscal)** | `fiscal_year_id` إلزامي · `fiscal_period_id` اختياري في 9.A.2 (يُشترط عند الترحيل لاحقًا). |
| **Q4 (Overlap)** | **بلا `btree_gist`/`CREATE EXTENSION`** — منع التداخل عبر الخدمة + القفل + Verify؛ EXCLUDE خيار Hardening مستقبلي فقط. |
| **Q5 (Migration Split)** | **Migrationان:** `095_payroll_periods_runs.sql` + `096_payroll_run_calculation.sql`؛ لا تعديل 094. |

---

## 1. Payroll Periods — فترات الرواتب

### 1.1 الجدول المقترح `accounts.payroll_periods` (Migration 095)

```sql
-- مقترح — لا يُنشأ الآن
CREATE TABLE accounts.payroll_periods (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_code        VARCHAR(40) NOT NULL,               -- من تسلسل PAYROLL_PERIOD
  payroll_calendar_id UUID NOT NULL
    REFERENCES accounts.payroll_calendars(id) ON DELETE RESTRICT,
  name_ar            VARCHAR(200) NOT NULL,
  name_en            VARCHAR(200) NULL,
  start_date         DATE NOT NULL,
  end_date           DATE NOT NULL,
  calculation_date   DATE NOT NULL,                      -- التاريخ المرجعي لـ Effective Dating
  payment_due_date   DATE NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','PROCESSING','CLOSED','CANCELLED')),
  currency_code      VARCHAR(3) NOT NULL DEFAULT 'IQD',
  fiscal_year_id     UUID NOT NULL
    REFERENCES accounts.fiscal_years(id) ON DELETE RESTRICT,   -- إلزامي (Q3)
  fiscal_period_id   UUID NULL
    REFERENCES accounts.fiscal_periods(id) ON DELETE RESTRICT, -- اختياري في 9.A.2 (Q3)
  version            INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_periods_code UNIQUE (period_code),
  CONSTRAINT ck_payroll_periods_dates CHECK (end_date >= start_date),
  CONSTRAINT ck_payroll_periods_calcdate CHECK (calculation_date >= start_date),
  CONSTRAINT ck_payroll_periods_due CHECK (payment_due_date IS NULL OR payment_due_date >= end_date),
  CONSTRAINT ck_payroll_periods_version CHECK (version >= 1)
);

CREATE INDEX idx_payroll_periods_calendar ON accounts.payroll_periods (payroll_calendar_id);
CREATE INDEX idx_payroll_periods_status   ON accounts.payroll_periods (status);
CREATE INDEX idx_payroll_periods_range    ON accounts.payroll_periods (payroll_calendar_id, start_date, end_date, status);
```

### 1.2 منع تداخل الفترات لنفس Calendar (Q4 — بلا btree_gist)
- **الآلية المعتمدة في 9.A.2:** **حارس على مستوى الخدمة** داخل معاملة، محميّ بأقفال `PAYROLL_CALENDAR` (+ `PAYROLL_PERIOD` عند التعديل)، معتمدًا على فهرس `idx_payroll_periods_range`.
- **القاعدة:** CHECK للتواريخ والقيود البسيطة فقط؛ **منع التداخل يعتمد على الخدمة + القفل + Verify** (لا EXCLUDE، لا امتداد).
- **Verify** يكشف أي تداخل فعلي (§20)، واختبارات **إنشاء فترات متزامن** تُثبت أن السباق لا يُنتج تداخلًا.
- **خيار Hardening مستقبلي فقط (غير مُنفّذ):** قيد `EXCLUDE USING gist` باستخدام `btree_gist` — يُقيَّم في مرحلة لاحقة إن لزم.

### 1.3 قرارات الفترات
- **READY / LOCKED؟** غير مطلوبين في 9.A.2 (`PROCESSING` قفل ناعم، `CLOSED` يمنع تشغيلات جديدة). `LOCKED` مؤجَّل لمرحلة الترحيل.
- **تعدّد OPEN:** مسموح **فقط** إن لم تتداخل التواريخ؛ تشغيليًا يُظهَر **Warning** عند وجود أكثر من `OPEN` لنفس Calendar (D15).
- **Fiscal (Q3):** `fiscal_year_id` إلزامي، `fiscal_period_id` اختياري في 9.A.2. **شرط مؤجَّل للترحيل المحاسبي:** عند إضافة `POSTED` لاحقًا يجب إمّا جعل `fiscal_period_id` مطلوبًا، أو حلّه تلقائيًا من `calculation_date` مع تحقق أن الفترة المالية **مفتوحة**.
- **الإغلاق/إعادة الفتح:** انظر D27.
- **أثر Effective Dating على `calculation_date`:** يُنسَخ إلى `payroll_runs.calculation_date` عند بدء الاحتساب ويُجمَّد في Snapshot؛ تغييره لاحقًا لا يؤثر على تشغيل محسوب.

---

## 2. Payroll Runs — تشغيلات الرواتب

### 2.1 الجدول المقترح `accounts.payroll_runs` (Migration 095)

```sql
-- مقترح — لا يُنشأ الآن
CREATE TABLE accounts.payroll_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number          VARCHAR(40) NOT NULL,              -- من تسلسل PAYROLL_RUN
  payroll_period_id   UUID NOT NULL
    REFERENCES accounts.payroll_periods(id) ON DELETE RESTRICT,
  payroll_calendar_id UUID NOT NULL
    REFERENCES accounts.payroll_calendars(id) ON DELETE RESTRICT,
  run_type            VARCHAR(20) NOT NULL DEFAULT 'REGULAR'
    CHECK (run_type IN ('REGULAR','CORRECTION','SUPPLEMENTAL','TERMINATION','MANUAL')),
  scope_type          VARCHAR(20) NOT NULL DEFAULT 'ALL'
    CHECK (scope_type IN ('ALL','COLLEGE','DEPARTMENT','COST_CENTER','PERSON_LIST')),
  scope_ref_id        UUID NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','CALCULATING','CALCULATED','CANCELLED','VOID')),
  currency_code       VARCHAR(3) NOT NULL DEFAULT 'IQD',
  calculation_date    DATE NOT NULL,
  -- سلسلة الإصدارات (D11 — محجوزة/غير مُفعّلة في 9.A.2)
  revision_number     INTEGER NOT NULL DEFAULT 1,
  root_run_id         UUID NULL REFERENCES accounts.payroll_runs(id) ON DELETE RESTRICT,
  supersedes_run_id   UUID NULL REFERENCES accounts.payroll_runs(id) ON DELETE RESTRICT,
  superseded_by_run_id UUID NULL REFERENCES accounts.payroll_runs(id) ON DELETE RESTRICT,
  revision_reason     TEXT NULL,
  -- إجماليات (بالعملة، مصدرها مجموع الأسطر بالمِلّي)
  people_count                INTEGER NOT NULL DEFAULT 0,
  gross_total                 NUMERIC(18,3) NOT NULL DEFAULT 0,
  deduction_total             NUMERIC(18,3) NOT NULL DEFAULT 0,
  employer_contribution_total NUMERIC(18,3) NOT NULL DEFAULT 0,
  net_total                   NUMERIC(18,3) NOT NULL DEFAULT 0,   -- قد يكون سالبًا (D3)
  warning_count       INTEGER NOT NULL DEFAULT 0,
  error_count         INTEGER NOT NULL DEFAULT 0,
  snapshot_hash       VARCHAR(64) NULL,                  -- SHA-256 على مستوى Run
  -- Idempotency (D23)
  calculation_request_id      UUID NULL,                 -- المفتاح المرتبط بالطلب الجاري/الأخير
  last_calculation_request_id UUID NULL,                 -- آخر مفتاح ناجح
  calculation_attempt_number  INTEGER NOT NULL DEFAULT 0,
  calculated_at       TIMESTAMPTZ NULL,
  calculated_by       UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  version             INTEGER NOT NULL DEFAULT 1,         -- تزامن متفائل (row-level)
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payroll_runs_number UNIQUE (run_number),
  CONSTRAINT ck_payroll_runs_totals_nonneg
    CHECK (gross_total >= 0 AND deduction_total >= 0 AND employer_contribution_total >= 0),
  CONSTRAINT ck_payroll_runs_version CHECK (version >= 1)
);

-- Run واحد حيّ من نوع REGULAR لكل (فترة + توقيع نطاق)
CREATE UNIQUE INDEX uq_payroll_runs_one_live_regular
  ON accounts.payroll_runs (
    payroll_period_id, scope_type,
    COALESCE(scope_ref_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE run_type = 'REGULAR' AND status IN ('DRAFT','CALCULATING','CALCULATED');

CREATE INDEX idx_payroll_runs_period ON accounts.payroll_runs (payroll_period_id);
CREATE INDEX idx_payroll_runs_status ON accounts.payroll_runs (status);
```
> `net_total` قد يكون سالبًا (D3) ⇒ لا CHECK غير سالب عليه.
> **تمييز `version` عن `revision_number`:** `version` = تزامن متفائل على مستوى الصف (يزيد مع أي UPDATE). `revision_number` = إصدار الكشف بالمعنى العملي (D11) — **لا يزيد في 9.A.2**.

### 2.2 `run_type` في 9.A.2
enum يحوي القيم الخمس (محجوزة لتجنّب هجرة قيد لاحقة)، لكن **الخدمة تسمح بـ `REGULAR` فقط**؛ الباقي مرفوض برسالة «نوع التشغيل غير مُفعّل في هذه المرحلة».

### 2.3 CANCELLED مقابل VOID — انظر D26. (9.A.2: **CANCELLED فقط**؛ `VOID` محجوزة ومرفوضة خدميًا.)

### 2.4 Versioning — انظر D25/D11. (محجوز؛ لا إصدارات فعلية في 9.A.2.)

---

## 3. Payroll Scope — نطاق التشغيل

### 3.1 الأنواع المجمّدة (D6)
`ALL` · `COLLEGE` · `DEPARTMENT` · `COST_CENTER` · `PERSON_LIST`. **لا يُستخدم `person_type` كبديل عن النطاق** (تضييق اختياري فقط، ولا يُعتمد كمنطق حساب).

### 3.2 حل النطاق إلى قائمة أشخاص
مصدر الأشخاص = `payroll_people` بحالة `ACTIVE` **ولديهم عقد أساسي فعّال ساري عند `calculation_date`**، مصفّى حسب النطاق:

| scope_type | قاعدة التصفية |
|-----------|---------------|
| `ALL` | كل شخص نشط ضمن التقويم/العملة المطابقين. |
| `COLLEGE` | أشخاص الكلية (عبر `department_id` ← شجرة الأقسام). |
| `DEPARTMENT` | `payroll_people.department_id = scope_ref_id`. |
| `COST_CENTER` | `payroll_people.default_cost_center_id = scope_ref_id` (أو المشتق من العقد/التكليف). |
| `PERSON_LIST` | الأشخاص في `payroll_run_scope_members` فقط. |

### 3.3 `accounts.payroll_run_scope_members` (Migration 095 — لـ PERSON_LIST فقط)

```sql
CREATE TABLE accounts.payroll_run_scope_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id UUID NOT NULL
    REFERENCES accounts.payroll_runs(id) ON DELETE CASCADE,   -- سجلّ تابع للـ Run
  payroll_person_id UUID NOT NULL
    REFERENCES accounts.payroll_people(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_run_scope_member UNIQUE (payroll_run_id, payroll_person_id)
);
```
> `ON DELETE CASCADE` مقبول (سجلّ فرعي تابع تمامًا للـ Run).

### 3.4 توقيت التجميد — انظر D17.

---

## 4. Payroll Run People — لقطة الشخص داخل التشغيل

### 4.1 الجدول المقترح `accounts.payroll_run_people` (Migration 096)

```sql
CREATE TABLE accounts.payroll_run_people (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id     UUID NOT NULL
    REFERENCES accounts.payroll_runs(id) ON DELETE CASCADE,
  payroll_person_id  UUID NOT NULL
    REFERENCES accounts.payroll_people(id) ON DELETE RESTRICT,
  payroll_contract_id UUID NULL
    REFERENCES accounts.payroll_contracts(id) ON DELETE RESTRICT,
  payroll_period_id  UUID NOT NULL                       -- مُنزَّل من الـ Run لحارس الشخص
    REFERENCES accounts.payroll_periods(id) ON DELETE RESTRICT,
  -- لقطات ثابتة
  person_code_snapshot   VARCHAR(40)  NOT NULL,
  full_name_snapshot     VARCHAR(200) NOT NULL,
  person_type_snapshot   VARCHAR(20)  NOT NULL,
  department_id_snapshot  UUID NULL,
  cost_center_id_snapshot UUID NULL,
  currency_code          VARCHAR(3) NOT NULL,
  -- إجماليات الشخص (بالعملة؛ المصدر مِلّي، بعد تقريب الأسطر)
  basic_amount                NUMERIC(18,3) NOT NULL DEFAULT 0,
  gross_amount                NUMERIC(18,3) NOT NULL DEFAULT 0,
  deductions_amount           NUMERIC(18,3) NOT NULL DEFAULT 0,
  employer_contributions_amount NUMERIC(18,3) NOT NULL DEFAULT 0,
  net_amount                  NUMERIC(18,3) NOT NULL DEFAULT 0,   -- قد يكون سالبًا (D3)
  calculation_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (calculation_status IN ('PENDING','CALCULATED','ERROR','EXCLUDED')),
  warning_count      INTEGER NOT NULL DEFAULT 0,          -- (D21: العدّادات فقط هنا)
  error_count        INTEGER NOT NULL DEFAULT 0,
  snapshot_json      JSONB NOT NULL,
  snapshot_hash      VARCHAR(64) NOT NULL,               -- SHA-256 على مستوى الشخص
  superseded         BOOLEAN NOT NULL DEFAULT FALSE,     -- يُضبط عند إلغاء الـ Run (حارس الشخص)
  version            INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
  updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_run_person UNIQUE (payroll_run_id, payroll_person_id),
  CONSTRAINT ck_run_person_version CHECK (version >= 1)
);

CREATE INDEX idx_run_people_run    ON accounts.payroll_run_people (payroll_run_id);
CREATE INDEX idx_run_people_person ON accounts.payroll_run_people (payroll_person_id);
```

### 4.2 حارس الشخص عبر الفترة (D16)

```sql
-- شخص واحد فقط في عضوية حيّة واحدة لكل فترة (بين كل التشغيلات غير الملغاة)
CREATE UNIQUE INDEX uq_run_person_one_live_per_period
  ON accounts.payroll_run_people (payroll_period_id, payroll_person_id)
  WHERE superseded = FALSE;
```
- صفوف `payroll_run_people` تُنشأ عند تجميد النطاق (بدء Calculate)؛ وجودها بحالة `superseded=FALSE` **يحجز** الشخص لتلك الفترة.
- عند `CANCELLED` تُضبط كل صفوف أشخاص الـ Run `superseded=TRUE`، فيتحرر الشخص لتشغيل آخر.
- بما أن **`REGULAR` هو النوع الوحيد الفعّال في 9.A.2**، فالحارس على مستوى (فترة+شخص) كافٍ ومكافئ لقاعدة «نفس الغرض» (Run Purpose). عند تفعيل أنواع/أغراض أخرى لاحقًا يُوسَّع الحارس ليشمل الغرض.

### 4.3 قرارات — انظر D3/D17/D24/D25.

---

## 5. Payroll Run Lines — أسطر الاحتساب

### 5.1 الجدول المقترح `accounts.payroll_run_lines` (Migration 096)

```sql
CREATE TABLE accounts.payroll_run_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id        UUID NOT NULL
    REFERENCES accounts.payroll_runs(id) ON DELETE CASCADE,
  payroll_run_person_id UUID NOT NULL
    REFERENCES accounts.payroll_run_people(id) ON DELETE CASCADE,
  payroll_component_id  UUID NOT NULL
    REFERENCES accounts.payroll_components(id) ON DELETE RESTRICT,
  payroll_assignment_id UUID NULL
    REFERENCES accounts.payroll_assignments(id) ON DELETE RESTRICT,
  payroll_component_assignment_id UUID NULL
    REFERENCES accounts.payroll_component_assignments(id) ON DELETE RESTRICT,
  component_code_snapshot VARCHAR(40)  NOT NULL,
  component_name_snapshot VARCHAR(200) NOT NULL,
  component_type          VARCHAR(25)  NOT NULL,
  calculation_method      VARCHAR(25)  NOT NULL,
  calculation_base_type   VARCHAR(25)  NULL,       -- الأساس المستخدم (NONE/CONTRACT_BASIC) — D18
  quantity_source         VARCHAR(20)  NULL        -- D19
    CHECK (quantity_source IS NULL OR quantity_source IN
      ('MANUAL','ASSIGNMENT','IMPORTED','ATTENDANCE','LECTURE_HOURS')),
  quantity          NUMERIC(18,3) NULL,
  rate              NUMERIC(18,3) NULL,
  percentage        NUMERIC(9,4)  NULL,
  base_amount       NUMERIC(18,3) NULL,            -- قيمة الأساس (مثلًا أساسي العقد للنِّسبة)
  calculated_amount NUMERIC(18,3) NOT NULL,        -- الناتج بعد الحدود والتقريب على مستوى السطر
  manual_override_amount NUMERIC(18,3) NULL,       -- محجوز (تجاوز يدوي داخل الـ Run)
  is_manual         BOOLEAN NOT NULL DEFAULT FALSE,
  source_effective_from DATE NOT NULL,
  source_effective_to   DATE NULL,
  calculation_details_json JSONB NULL,             -- مدخلات وسيطة للتتبّع
  sequence          INTEGER NOT NULL DEFAULT 0,
  version           INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_run_line_version CHECK (version >= 1)
);

CREATE INDEX idx_run_lines_run    ON accounts.payroll_run_lines (payroll_run_id);
CREATE INDEX idx_run_lines_person ON accounts.payroll_run_lines (payroll_run_person_id);
CREATE INDEX idx_run_lines_component ON accounts.payroll_run_lines (payroll_component_id);
```

### 5.2 قرارات الأسطر
- كل تخصيص مكوّن فعّال ساري ⇒ **سطر واحد** (تتبّع كامل). تعدّد تخصيصات نفس المكوّن ⇒ أسطر متعددة، وإجمالي الشخص = مجموع الأسطر.
- **min/max** على مستوى السطر (تجميع الحد على مستوى المكوّن مؤجَّل).
- **Rounding** على مستوى السطر وفق مقياس عملة (IQD scale=0) — انظر D20.
- `MANUAL_AMOUNT` يأخذ المبلغ من `payroll_component_assignments.amount` (إلزامي، وإلا Error).
- immutable بعد `CALCULATED`؛ التغيير عبر Recalculate (يحذف ويعيد البناء).
- `calculation_details_json` يحفظ المدخلات الوسيطة (مثل `{ base_type, base_millis, percentage, quantity, rate }`) للتتبّع والتحقق.

---

## 6. Calculation Engine — محرك الاحتساب

### 6.1 Pipeline (D22)
1. **Validate Period** (OPEN/PROCESSING، عملة/تقويم متسقان، سنة مالية نشطة).
2. **Validate Run** (DRAFT أو CALCULATED للإعادة، نوع REGULAR، نطاق صالح).
3. **Lock Period** ثم **Lock Run** (+ أقفال الكيانات عند القراءة؛ الفرز الحتمي يمنع Deadlock).
4. **Transition** `DRAFT/CALCULATED → CALCULATING` وفق سياسة Recalculate.
5. **حذف Staging السابق** (people/lines/issues) إذا كانت إعادة احتساب مسموحة.
6. **Resolve Scope**.
7. **Freeze People List** (إنشاء `payroll_run_people` تحت حارس الشخص).
8. **Resolve Active Contract** (عقد أساسي فعّال واحد ساري عند `calculation_date`).
9. **Resolve Effective Assignments / Components / Component Assignments**.
10. **Calculate Lines** (تطبيق الطريقة + الأساس + مصدر الكمية).
11. **Apply Limits** (min/max لكل سطر).
12. **Apply Rounding** (مستوى السطر، مقياس العملة — D20).
13. **Aggregate Totals** (الأسطر ← الشخص ← الـ Run).
14. **Generate Warnings/Errors** (ملء `payroll_run_issues`).
15. **Save Snapshots** (`snapshot_json` + `snapshot_hash` لكل شخص وللـ Run).
16. **Mark Run CALCULATED** ثم **Commit**.

**أي فشل ⇒ Rollback كامل؛ لا أسطر جزئية؛ لا Run يبقى `CALCULATING` بعد rollback.**

### 6.2 طرق الاحتساب المدعومة (بالمِلّي)
| الطريقة | الخوارزمية (millis) ثم تقريب السطر | المدخلات |
|--------|-------------------------------------|----------|
| `FIXED_AMOUNT` | `amount_millis = coalesce(assignment.amount, component.default_amount)` | مبلغ. |
| `PERCENTAGE_OF_BASIC` | `floor(base_millis × percentage / 100)`؛ **`base_type` يجب أن يكون `CONTRACT_BASIC`** | base = أساسي العقد. |
| `QUANTITY_X_RATE` | `floor(quantity × rate_millis)` | quantity + rate. |
| `DAYS_X_DAILY_RATE` | `floor(days × daily_rate_millis)` | days + daily_rate. |
| `HOURS_X_HOURLY_RATE` | `floor(hours × hourly_rate_millis)` | hours + hourly_rate. |
| `LECTURES_X_RATE` | `floor(lectures × rate_millis)` | lectures + rate. |
| `MANUAL_AMOUNT` | `amount_millis = assignment.amount` (إلزامي) | إن غاب ⇒ Error. |
| `CUSTOM_FORMULA` | **Blocking Error دائمًا** — لا eval/parser/expression engine (D14) | — |

- بعد حساب `amount_millis` الخام، يُطبَّق **تقريب السطر** إلى مقياس عملة (IQD=0 منازل) ثم تُخزَّن `calculated_amount`.
- إن نقصت مدخلات الطريقة (rate/quantity/base) ⇒ **Blocking Error**.

### 6.3 تعريف BASIC دون Hardcoding (D18 — النهج B)
- يُضاف `payroll_components.calculation_base_type` (Migration 095) بقيم **مُنفّذة**: `NONE`, `CONTRACT_BASIC`.
- **`PERCENTAGE_OF_BASIC` لا يعمل إلا مع `CONTRACT_BASIC`**؛ حيث `base = payroll_contracts.base_amount` للعقد الأساسي الفعّال.
- **ممنوع** أي `if (component_code === 'BASIC_SALARY')` أو أي كود ثابت لأكواد المكوّنات.
- **إن احتاجت الطريقة أساسًا ولم يُحدَّد أساس صالح ⇒ Blocking Error.**
- **محجوز دون تنفيذ:** `GROSS_EARNINGS`, `SELECTED_COMPONENTS`, `COMPONENT_REFERENCE`.
- **مؤجَّل:** جدول الاعتمادات الكامل + محرّك كشف الدورات (Circular Dependency Engine) — لمرحلة لاحقة.

---

## 7. Dependencies Between Components — اعتماد المكوّنات

### 7.1 القرار (D18)
- 9.A.2 يدعم **أساسًا بسيطًا فقط** عبر `calculation_base_type ∈ {NONE, CONTRACT_BASIC}`.
- **لا جدول `payroll_component_dependencies` الآن، ولا `base_component_id`، ولا ترتيب طوبولوجي، ولا كشف دورات.**
- الأمثلة المتقدمة (نسبة من الإجمالي، تقاعد = أساسي + مخصصات محددة) تُغطَّى مستقبلًا عبر القيم المحجوزة (`GROSS_EARNINGS`/`SELECTED_COMPONENTS`/`COMPONENT_REFERENCE`) + محرّك ترتيب/دورات في **9.A.2.1/9.A.3**.
- **Dependency مفقودة/أساس غير صالح ⇒ Blocking Error.**
- **الحفاظ على Zero Hardcoded:** الأساس مُشتق من بيانات (إعداد المكوّن + العقد)، لا من كود.

---

## 8. Quantity Sources — مصادر الكمية (D19)
Enum: `MANUAL` · `ASSIGNMENT` · `IMPORTED` · `ATTENDANCE` · `LECTURE_HOURS`.

| المصدر | الحالة في 9.A.2 |
|-------|------------------|
| `MANUAL` | **مُنفَّذ** (كمية مُدخَلة على التخصيص). |
| `ASSIGNMENT` | **مُنفَّذ** (من `payroll_component_assignments.quantity`). |
| `IMPORTED` | **محجوز** — استخدامه يُفشل الاحتساب بـ Blocking Error. |
| `ATTENDANCE` | **محجوز** — لا ربط حضور الآن؛ استخدامه Blocking Error. |
| `LECTURE_HOURS` | **محجوز** — لا ربط ساعات محاضرين الآن؛ استخدامه Blocking Error. |

الطرق `HOURS/DAYS/LECTURES_X_RATE` تعتمد كمية من `ASSIGNMENT`/`MANUAL` فقط؛ غياب المصدر ⇒ Blocking Error.

---

## 9. Warnings and Errors — انظر D21 للتخزين

### 9.1 التصنيف
- **Blocking Errors** (`is_blocking=TRUE`) — تمنع اعتبار الشخص `CALCULATED` (calculation_status=ERROR).
- **Non-blocking Warnings** — لا تمنع `CALCULATED`.

| Errors (أمثلة) | Warnings (أمثلة) |
|----------------|------------------|
| لا عقد فعّال · أكثر من عقد فعّال | صافٍ سالب (D3) · لا استحقاقات |
| `CUSTOM_FORMULA` · مصدر كمية محجوز | استقطاعات > الإجمالي |
| عملة غير متطابقة · مكوّن بمدخلات ناقصة | تجاوز يدوي (لاحقًا) |
| أساس غير صالح/Dependency مفقودة | شخص بلا قسم · عقد ينتهي خلال الفترة |

> **Mapping المحاسبي غير مطلوب في `CALCULATED`** (شأن الترحيل، 9.A.3).

---

## 10. Rounding — التقريب (D20)
- **مستوى:** **السطر (Line)**.
- **الآلية:** تقريب `calculated_amount` إلى **مقياس عملة (Decimal Scale)**؛ **IQD افتراضيًا scale = 0** (بلا كسور).
- **لا** تقريب إلى 10/100 دينار الآن، و**لا** سطر تقريب مستقل.
- **الثبات المحاسبي:** `Person totals = Σ Lines` (بعد التقريب)، و`Run totals = Σ Person totals` — بلا فرق (لأن التجميع يقع بعد تقريب الأسطر).
- **مصدر المقياس:** إعداد العملة (data-driven)؛ يبقى التخزين `NUMERIC(18,3)` مع قيمة مقرّبة إلى مقياس العملة.
- **مؤجَّل:** التقريب الخشن (10/100) + Rounding Adjustment Line + ربط `ROUNDING` Mapping (9.A.3).

---

## 11. Locks and Concurrency

### 11.1 نطاقات القفل الجديدة
`PAYROLL_PERIOD` · `PAYROLL_RUN` · `PAYROLL_RUN_PERSON` (تُضاف إلى `AccountingLockDomain`).

### 11.2 الترتيب المنطقي (توثيقي)
```
Period → Run → Person → Contract → Assignment → Component → Component Assignment → Mapping → Calendar
```
> منع الـ Deadlock فعليًا يعتمد على **الفرز الحتمي العالمي** في `acquireAccountingResourceLocks`؛ الترتيب أعلاه توثيقي فقط.

### 11.3 سيناريوهات
| السيناريو | السلوك |
|----------|--------|
| Calculate نفس Run مرتين متزامنًا | قفل `PAYROLL_RUN` + حارس حالة `CALCULATING` ⇒ الثاني 409، لا تكرار (D23). |
| Calculate Runين متداخلين (نفس الأشخاص) | حارس الشخص (§4.2) ⇒ واحد ينجح والآخر 409 نظيف. |
| تعديل Contract/Component أثناء Calculation | الاحتساب ذرّي بلقطة معاملة + أقفال؛ التعديل يُرفض/ينتظر؛ النتيجة متسقة عند `calculation_date`. |
| Cancel أثناء Calculation | ممنوع أثناء `CALCULATING` (D26)؛ يتطلب قفل الـ Run. |
| Retry بعد فشل جزئي | Rollback كامل؛ لا صفوف جزئية؛ Retry آمن (D23). |
| إنشاء فترتين متداخلتين متزامنًا | قفل `PAYROLL_CALENDAR` + حارس خدمي ⇒ واحدة تنجح والأخرى 409 (Q4/D15). |

---

## 12. Idempotency — انظر D23.

## 13. Snapshot and Hashing — انظر D24.

---

## 14. APIs المقترحة (تصميم فقط)

### 14.1 Periods
| Route | Method | الصلاحية |
|------|--------|----------|
| `/api/accounts/payroll/periods` | GET | `payroll_view_runs` |
| `/api/accounts/payroll/periods` | POST | `payroll_manage_periods` |
| `/api/accounts/payroll/periods/[id]` | GET | `payroll_view_runs` |
| `/api/accounts/payroll/periods/[id]` | PATCH | `payroll_manage_periods` |
| `/api/accounts/payroll/periods/[id]/open` | POST | `payroll_manage_periods` *(إعادة الفتح: admin فقط — D27)* |
| `/api/accounts/payroll/periods/[id]/close` | POST | `payroll_manage_periods` |
| `/api/accounts/payroll/periods/[id]/cancel` | POST | `payroll_manage_periods` (سبب إلزامي) |

> **ملاحظة D27:** *إعادة فتح* فترة مغلقة مقصورة على `accounts_admin` (تُفرَض في الخدمة داخل مسار `/open` بتحقّق إضافي على الدور)، رغم أن إنشاء/إغلاق الفترات متاح لـ clerk.

### 14.2 Runs
| Route | Method | الصلاحية |
|------|--------|----------|
| `/api/accounts/payroll/runs` | GET | `payroll_view_runs` |
| `/api/accounts/payroll/runs` | POST | `payroll_create_runs` |
| `/api/accounts/payroll/runs/[id]` | GET | `payroll_view_runs` |
| `/api/accounts/payroll/runs/[id]` | PATCH | `payroll_create_runs` (DRAFT فقط) |
| `/api/accounts/payroll/runs/[id]/calculate` | POST | `payroll_calculate` (admin فقط) + idempotency_key |
| `/api/accounts/payroll/runs/[id]/recalculate` | POST | `payroll_calculate` (admin فقط) + idempotency_key + reason |
| `/api/accounts/payroll/runs/[id]/cancel` | POST | `payroll_cancel_runs` (admin فقط) + سبب إلزامي |
| `/api/accounts/payroll/runs/[id]/people` | GET | `payroll_view_runs` |
| `/api/accounts/payroll/runs/[id]/lines` | GET | `payroll_view_runs` |
| `/api/accounts/payroll/runs/[id]/issues` | GET | `payroll_view_runs` |
| `/api/accounts/payroll/runs/[id]/preview` | POST/GET | `payroll_view_runs` — **قراءة فقط، لا كتابة DB** |

### 14.3 قواعد عامة
- كل PATCH/انتقال حالة يتطلب `version` + `updated_at` (409 عند التعارض).
- `idempotency_key` إلزامي على `calculate`/`recalculate`؛ `recalculate` يتطلب `reason`.
- **preview لا يكتب في DB** ولا يضمن التطابق مع Calculate إذا تغيّرت البيانات (المرجع هو Calculate).
- لا Review/Approve/Post routes الآن.

---

## 15. UI المقترحة (تصميم فقط)
- `/accounts/payroll/periods` · `/accounts/payroll/periods/[id]`
- `/accounts/payroll/runs` · `/accounts/payroll/runs/new` · `/accounts/payroll/runs/[id]`
- صفحة الـ Run تعرض: Header · Scope · Status · Version · People count · Totals (مع تمييز الصافي السالب) · Warnings/Errors · جدول الأشخاص + Drill-down للـ Lines · Snapshot info · أزرار **Calculate/Recalculate/Cancel** (حسب الحالة والصلاحية).
- **لا أزرار Review/Approve/Post الآن.**

---

## 16. Capabilities (Q2 — نهائي)

### 16.1 القدرات الجديدة (9.A.2)
`payroll_view_runs` · `payroll_manage_periods` · `payroll_create_runs` · `payroll_calculate` · `payroll_cancel_runs` (+ `payroll_admin` الموجودة).

### 16.2 التوزيع النهائي على الأدوار
| الدور | القدرات |
|------|---------|
| `accounts_viewer` | `payroll_view_runs` |
| `accounts_clerk` | `payroll_view_runs` · `payroll_manage_periods` · `payroll_create_runs` |
| `accounts_approver` | `payroll_view_runs` |
| `accounts_admin` | `payroll_view_runs` · `payroll_manage_periods` · `payroll_create_runs` · `payroll_calculate` · `payroll_cancel_runs` · `payroll_admin` |
| العضوية ACCOUNTS المجرّدة | **VIEW_ONLY** (لا ترقية ضمنية) |

- **`payroll_calculate` غير ممنوح لـ `accounts_clerk` في 9.A.2.**
- **`payroll_cancel_runs` لـ `accounts_admin` فقط.**
- **ملاحظة توافق:** هذا التوزيع **أكثر تشدّدًا** من التوجيه العام في D10 (الذي أتاح الحساب للـ clerk)؛ وهو **سياسة معتمدة لمرحلة 9.A.2** لتعزيز فصل المهام أثناء الاحتساب، ولا يمثّل تغييرًا في المعمارية المجمّدة.

---

## 17. Document Sequences
| النوع | البادئة | القرار |
|------|--------|--------|
| `PAYROLL_PERIOD` | `PYPR` | **يُضاف في Migration 095**. |
| `PAYROLL_RUN` | `PYR` | **يُضاف في Migration 095**. |
| `PAYROLL_ADJUSTMENT` | `PYADJ` | **مؤجَّل** (9.A.3). |

> `094` أضافت فقط PERSON/CONTRACT/ASSIGNMENT؛ أنواع PERIOD/RUN تُضاف عبر Migration جديدة (لا تعديل 094).

---

## 18. Migration Plan (Q5 — نهائي)
- **البدء من 095. لا تُعدَّل 094 إطلاقًا. لا تُنشأ الملفات الآن.**

### `095_payroll_periods_runs.sql`
- **ALTER `payroll_components` ADD `calculation_base_type`** (Enum عبر CHECK، DEFAULT `NONE`؛ القيم: `NONE`,`CONTRACT_BASIC`,`GROSS_EARNINGS`,`SELECTED_COMPONENTS`,`COMPONENT_REFERENCE`).
- `payroll_periods`.
- `payroll_runs`.
- `payroll_run_scope_members`.
- Document Sequence types للفترات والتشغيلات (+ تسلسلات السنة).
- **Capabilities الأساسية** (تسجيل القدرات الجديدة حيثما يلزم على مستوى البيانات).
- Indexes + CHECKs + FKs لهذه الطبقة (بما فيها الفهرس الفريد الجزئي لـ REGULAR الحيّ).

### `096_payroll_run_calculation.sql`
- `payroll_run_people`.
- `payroll_run_lines`.
- `payroll_run_issues`.
- حقول Snapshot/Hash التفصيلية.
- حقول Idempotency (على `payroll_runs` — تُضاف ضمن 095 مع الجدول؛ وأي حقول احتساب تفصيلية هنا).
- Indexes + constraints الخاصة بالاحتساب (بما فيها حارس الشخص الفريد الجزئي).

> **ترتيب إلزامي:** 096 يعتمد على 095 (FKs). **تقييم المخاطر:** الفصل يقلّل مخاطر المراجعة/التراجع؛ `ALTER` على `payroll_components` آمن (عمود بـ DEFAULT ثابت، بلا إعادة كتابة مؤلمة). **لا `btree_gist`/`CREATE EXTENSION`** (Q4).

---

## 19. Testing Plan
Period overlap (خدمي+قفل) · Run uniqueness (REGULAR حيّ) · Scope resolution لكل نوع + PERSON_LIST · concurrent period creation · concurrent calculation (نفس Run) · person overlap guard عبر Runين · كل طرق الاحتساب السبع (قيم دقيقة بالمِلّي) · `PERCENTAGE_OF_BASIC` مع/بدون `CONTRACT_BASIC` (بدون ⇒ Blocking Error) · مصدر كمية محجوز ⇒ Blocking Error · missing contract / multiple active contract ⇒ Error · negative net ⇒ Warning · CUSTOM_FORMULA ⇒ Error + كشف Verify · rounding (ثبات المجاميع، IQD scale=0) · idempotency (لا تكرار Lines) · snapshot deterministic hash · version conflicts (409) · cancel أثناء CALCULATING ممنوع · recalc يتطلب reason + مفتاح جديد · data change أثناء calculate (ذرّية) · Verify normal/strict · Seed idempotent · **Regression لـ `test:payroll-foundation` (9.A.1) دون كسر**.

## 20. Verify Plan
سكربتان: `accounts:verify-payroll-calculation` و`:strict`. يكشف:
Run totals mismatch · Person totals mismatch · Line totals mismatch · duplicate people · duplicate lines · invalid statuses · missing snapshot · invalid hash · effective dating violation · **period overlap** (خدمي/قاعدي) · negative net not marked warning · CUSTOM_FORMULA usage · missing contract · overlapping runs (حارس الشخص) · orphan lines/issues · calculation_request duplication · revision chain consistency (فحص اتساق الأعمدة المحجوزة فقط). بلا فشل كاذب على بيانات 9.A.1 التاريخية.

## 21. Seed Plan (DEMO فقط — لا يُنفّذ الآن)
فترة واحدة (MONTHLY، فترة مالية مفتوحة) · Run `REGULAR` بنطاق `ALL` (+ مثال PERSON_LIST) · مكوّنات تغطّي كل الطرق المدعومة · صافٍ موجب + صافٍ سالب (Warning) · كمية يدوية (MANUAL) · تعدّد تخصيصات لنفس المكوّن · مثال `PERCENTAGE_OF_BASIC` مع `CONTRACT_BASIC`.

---

## القرارات النهائية D15–D27

### D15 — Period Overlap
- **القاعدة:** لا تداخل بين فترات فعّالة لنفس Payroll Calendar.
- **الحالات الداخلة في فحص التداخل:** `OPEN`, `PROCESSING`, `CLOSED`. **`CANCELLED` لا تمنع** إنشاء فترة جديدة.
- **تعدّد `OPEN`:** مسموح فقط دون تداخل تواريخ، مع **Warning تشغيلي** عند وجود أكثر من `OPEN` لنفس Calendar.
- **الإنفاذ (Q4):** خدمي + قفل `PAYROLL_CALENDAR`/`PAYROLL_PERIOD` + فهارس + Verify (لا btree_gist).
- **DB:** CHECK للتواريخ + فهرس `(calendar_id,start_date,end_date,status)`. **API:** 409 نظيف عند التداخل. **Tests:** رفض تداخل/سماح تجاور + concurrent. **9.A.2:** مُنفَّذ.

### D16 — Run Uniqueness
- **القاعدة:** لا يظهر الشخص في أكثر من Run فعّال لنفس Period ونفس Run Purpose، إلا إذا كان Run جديد **supersedes** سابقًا (محجوز، غير مُفعّل في 9.A.2).
- **الحالات الفعّالة في المنع:** `DRAFT` بعد تجميد Scope · `CALCULATING` · `CALCULATED`. **`CANCELLED` لا تمنع.** **`VOID` غير مستخدمة في 9.A.2.**
- **الإنفاذ:** فهرس فريد جزئي على `payroll_run_people (period, person) WHERE superseded=FALSE` + فهرس REGULAR الحيّ لكل (فترة+نطاق). بما أن REGULAR هو الغرض الوحيد الآن، الحارس مكافئ لقاعدة «نفس الغرض».
- **DB:** فهرسان جزئيان + عمود `superseded`. **API:** 409 نظيف. **Tests:** تكرار Run/شخص. **9.A.2:** مُنفَّذ.

### D17 — Scope Freeze
- Scope Resolution عند **Calculate** لا عند الإنشاء. الخطوات: (1) حلّ النطاق (2) تجميد الأشخاص (3) إنشاء `payroll_run_people` (4) عدم تغيّر القائمة حتى انتهاء العملية.
- **Preview ليس ضمانًا نهائيًا**؛ أي انتقال قسم/Cost Center بعد Preview وقبل Calculate يُحسم وفق الحالة الفعلية **عند Calculate**. بعد `CALCULATED` يعتمد النظام على **Snapshot فقط**.
- **DB:** `run_people` تُنشأ عند Calculate. **API:** preview لا يكتب. **Tests:** تغيّر البيانات لا يكسر Calculate. **9.A.2:** مُنفَّذ.

### D18 — Component Base
- `calculation_base_type` (Migration 095). **المنفّذ:** `NONE`, `CONTRACT_BASIC`. **المحجوز:** `GROSS_EARNINGS`, `SELECTED_COMPONENTS`, `COMPONENT_REFERENCE`.
- `PERCENTAGE_OF_BASIC` **لا يعمل إلا مع `CONTRACT_BASIC`** (base = أساسي العقد الفعّال). **لا Component Code Hardcoding.**
- أساس مطلوب وغير صالح ⇒ **Blocking Error**. **جدول Dependencies الكامل ومحرّك الدورات مؤجّلان.**
- **DB:** ALTER `payroll_components` ADD عمود (DEFAULT `NONE`). **API:** حقل في إعداد المكوّن. **Tests:** نسبة صحيحة + أساس مفقود ⇒ Error. **9.A.2:** `NONE`/`CONTRACT_BASIC` مُنفَّذان.

### D19 — Quantity Sources
- Enum: `MANUAL`,`ASSIGNMENT`,`IMPORTED`,`ATTENDANCE`,`LECTURE_HOURS`. **المنفّذ:** `MANUAL`,`ASSIGNMENT`. **المحجوز:** `IMPORTED`,`ATTENDANCE`,`LECTURE_HOURS` — استخدامه ⇒ **Blocking Error**.
- **DB:** `quantity_source` على `run_lines`. **API:** لا شيء إضافي. **Tests:** طرق الكمية + مصدر محجوز ⇒ Error. **9.A.2:** مُنفَّذ جزئيًا.

### D20 — Rounding
- تقريب **على مستوى Line** بمقياس عملة (IQD scale=0). **لا** تقريب 10/100، **لا** سطر تقريب مستقل. `Run totals = Σ Person = Σ Lines` بعد التقريب.
- **DB:** لا الآن (خارج مقياس العملة المخزَّن). **API:** لا. **Tests:** ثبات المجاميع. **9.A.2:** مُنفَّذ (التقريب الخشن + Adjustment Line مؤجّلان).

### D21 — Issues
- **جدول مستقل `payroll_run_issues`** (لا JSON فقط). الحقول: `run_id`, `run_person_id` (nullable), `severity`, `issue_code`, `message_ar`, `message_en` (nullable), `entity_type` (nullable), `entity_id` (nullable), `details_json` (nullable), `is_blocking`, `created_at`. `run_person` يحتفظ فقط بـ `warning_count`/`error_count`.

```sql
CREATE TABLE accounts.payroll_run_issues (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id        UUID NOT NULL REFERENCES accounts.payroll_runs(id) ON DELETE CASCADE,
  payroll_run_person_id UUID NULL REFERENCES accounts.payroll_run_people(id) ON DELETE CASCADE,
  severity    VARCHAR(10) NOT NULL CHECK (severity IN ('ERROR','WARNING')),
  issue_code  VARCHAR(60) NOT NULL,
  message_ar  TEXT NOT NULL,
  message_en  TEXT NULL,
  entity_type VARCHAR(40) NULL,
  entity_id   UUID NULL,
  details_json JSONB NULL,
  is_blocking BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
- **9.A.2:** مُنفَّذ.

### D22 — Transaction Strategy
- Calculation داخل **Transaction واحدة لكل Run**. الخطوات: قفل الفترة ← قفل الـ Run ← `DRAFT/CALCULATED → CALCULATING` (وفق سياسة Recalculate) ← حذف Staging السابق إن كانت Recalculate مسموحة ← Resolve scope ← Freeze people ← Calculate ← حفظ people/lines/issues ← تحديث totals/hash ← `CALCULATED` ← Commit.
- **الفشل ⇒ Rollback كامل** (لا Partial Lines، لا Run يبقى `CALCULATING`).
- Staging Architecture لمرحلة مستقلة إن ظهر أن الحجم لا يسمح — **ليس الآن**. **9.A.2:** مُنفَّذ.

### D23 — Idempotency
- حقول على `payroll_runs`: `calculation_request_id`, `last_calculation_request_id`, `calculation_attempt_number`, `calculated_at`.
- **السياسة:** `POST /calculate` يتطلب idempotency key؛ تكرار نفس المفتاح لنفس Run بعد نجاح ⇒ **يعيد نفس النتيجة دون إعادة إنشاء Lines**؛ مفتاح مرتبط بطلب قيد التنفيذ ⇒ **409**؛ مفتاح جديد بعد `CALCULATED` يُستخدم فقط عبر `/recalculate`؛ **لا Lines مكررة**.
- **أبسط نموذج DB موثوق:** الحقول على `payroll_runs` + ذرّية delete-then-insert (لا جدول محاولات منفصل الآن).
- **9.A.2:** مُنفَّذ.

### D24 — Snapshot Hash
- **SHA-256**. Canonical JSON: ترتيب مفاتيح Objects · الحفاظ على ترتيب Arrays (حسب sequence/IDs) · تحويل Decimal إلى String ثابت · تحويل Dates إلى ISO · استبعاد timestamps التشغيلية (مثل `created_at`) غير الجزء من المعنى المالي.
- **مستويان:** `person snapshot_hash` ثم `run snapshot_hash` مبني على hashes الأشخاص بترتيب حتمي.
- التقاط عند `CALCULATE` (ليس تجميدًا نهائيًا — D4). **9.A.2:** مُنفَّذ.

### D25 — Recalculation
- مسموح **فقط** عندما `Run = CALCULATED` ولم يدخل `REVIEWED`/`APPROVED`.
- يتطلب **reason** + **idempotency key جديد**؛ يزيد `calculation_attempt_number`؛ يحذف ويعيد بناء `run_people/lines/issues` داخل نفس Transaction؛ **لا يزيد `revision_number`** ولا ينشئ Version جديدة بالمعنى العملي (تزامن الصف `version` يزيد كالمعتاد).
- Version/Revision الجديدة تُستخدم لاحقًا بعد `VOID`/مراحل الاعتماد، لا في 9.A.2. **9.A.2:** مُنفَّذ.

### D26 — Cancel vs Void
- **`CANCELLED` فقط**؛ **لا `VOID`** في 9.A.2. `CANCELLED` مسموح قبل أي `POSTED` (وهو غير موجود أصلًا).
- يمكن إلغاء `DRAFT` و`CALCULATED`؛ **لا يمكن الإلغاء أثناء `CALCULATING`**. الإلغاء يتطلب **reason** + Audit.
- `VOID` مؤجَّل لما بعد الترحيل المحاسبي. **9.A.2:** مُنفَّذ.

### D27 — Period Close/Reopen
- **الإغلاق مسموح إذا:** لا Run `CALCULATING` · لا Run `DRAFT` غير ملغى · كل Runs المطلوبة `CALCULATED` أو `CANCELLED` · لا Blocking Errors غير معالجة في Runs `CALCULATED`.
- **إعادة الفتح:** `accounts_admin` فقط · reason إلزامي · Audit إلزامي.
- **شرط مؤجَّل:** لا يُسمح بإعادة الفتح لاحقًا إن وُجد Run `POSTED` (محجوز للمرحلة اللاحقة). **9.A.2:** مُنفَّذ.

---

## ملخص الأثر المعماري

### الجداول الجديدة
`payroll_periods` · `payroll_runs` · `payroll_run_scope_members` (095) · `payroll_run_people` · `payroll_run_lines` · `payroll_run_issues` (096).

### أعمدة جديدة على جداول 9.A.1
`payroll_components.calculation_base_type` (عبر Migration 095 — **لا تعديل 094**).

### التوافق مع Architecture Frozen
لا تعارض — التصميم مجموعة جزئية من الخطة المجمّدة؛ كل الفروق تضييق نطاق أو حجز بنية (على نهج D12/D14). توزيع القدرات في 9.A.2 أكثر تشدّدًا من D10 كسياسة مرحلة معتمدة، دون تغيير معماري.

---

*نهاية خطة 9.A.2.0 — **Architecture Ready for Implementation**. تصميم فقط: لا كود · لا Migration · لا API · لا UI · لا Commit · لا Push. لا يبدأ التنفيذ إلا بأمر صريح.*
