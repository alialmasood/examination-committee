# المرحلة 9.A — أساس الرواتب والتعويضات (Payroll & Compensation Foundation)

## خطة معمارية — تحليل وتصميم فقط (9.A.0 Discovery & Architecture Review)

> **نقطة الانطلاق الرسمية:** `f8ac935` — `docs(accounts): finalize fixed assets 8A documentation`
> **طبيعة هذه الوثيقة:** تصميم فقط. **لا كود، ولا Migration** في هذه الخطوة. لا تبدأ أي تنفيذ حتى اعتماد التصميم.
> **المبدأ الحاكم:** سجل رواتب (Payroll Registry) **مستقل** داخل مخطط `accounts`، متوافق مع المحرك المحاسبي الحالي، **بلا اعتماد إلزامي أو FK صلب على وحدة HR غير المستقرة**.

---

## 1) اكتشاف الحالة الراهنة (Current-state discovery)

### 1.1 بنية المحاسبة المستقرة (schema `accounts`، هجرات 058–093، متتبَّعة في git)

| المجال | الجدول/الملف | ملاحظات مفتاحية |
|---|---|---|
| دليل الحسابات | `accounts.chart_of_accounts` + `accounts.account_types` | الأنواع: `ASSET(DEBIT)`, `LIABILITY(CREDIT)`, `EQUITY(CREDIT)`, `REVENUE(CREDIT)`, `EXPENSE(DEBIT)`. قاعدة DB: `is_group ⇔ NOT allow_posting`. عمود `requires_cost_center`. |
| القيود | `accounts.journal_entries` + `accounts.journal_entry_lines` | `entry_type` يشمل **`SALARY`** أصلاً. `source_type/source_id` مع فهرس فريد `uq_journal_entries_source (source_type, source_id)`. قيد DB يفرض توازن القيد المُرحَّل. سطر واحد = مدين **أو** دائن حصراً. |
| الفترات المالية | `accounts.fiscal_years` (DRAFT/ACTIVE/CLOSED) + `accounts.fiscal_periods` (OPEN/CLOSED/LOCKED) | `assertFiscalContextForEntry` يمنع الترحيل خارج فترة `OPEN`. |
| العملة والمبالغ | `src/lib/accounts/money.ts` | مِلّي (3 منازل)، `NUMERIC(18,3)`. **اقتطاع (truncation) لا تقريب**، ورفض أي إدخال بأكثر من 3 منازل (`INVALID_MONEY`). كل الحساب على `bigint`. |
| مراكز الكلفة | `accounts.cost_centers` | شجرة، قابلة للربط بـ `department_id`. الإلزام يأتي من `chart_of_accounts.requires_cost_center`. |
| تسلسل المستندات | `accounts.document_sequence_types` + `accounts.document_sequences` + `document-sequences.ts` | `nextDocumentNumber` يستخدم `FOR UPDATE` (لا COUNT+1). آخر الأنواع المضافة في 093: `FIXED_ASSET(AST)`, `ASSET_MOVEMENT(AMV)`, `DEPRECIATION_RUN(DPR)`, `ASSET_DISPOSAL(ADS)`. |
| الأقفال | `src/lib/accounts/accounting-locks.ts` | `acquireAccountingResourceLocks` (normalize → dedupe → sort → `pg_advisory_xact_lock`) لتفادي الـ deadlock. لا يوجد أي domain للرواتب حالياً. |
| التزامن المتفائل | `src/lib/accounts/cash-session-concurrency.ts` | `assertCashSessionOptimisticConcurrency` يفحص `version` **و** `updated_at`. |
| التدقيق | `accounts.financial_audit_log` + `writeFinancialAudit` + `AuditAction` | نمط `domain.verb`. `action` يقبل `string` فيمكن إضافة أفعال جديدة. |
| الصلاحيات | `accounts-access.ts`, `*-access.ts` | نمط `X_CAPABILITIES` (const→union) + مجموعات تراكمية VIEW_ONLY⊂CLERK/APPROVER، ADMIN=الكل. الأدوار: `accounts_viewer/clerk/approver/admin`. Least privilege: عضوية `ACCOUNTS` وحدها = VIEW_ONLY. |
| Verify | `verify-*.ts` (lib + script) | نتيجة موحّدة `{ok, strict, mismatches[], warnings[], unexplained[], summary}`. normal يفشل على mismatch؛ strict يفشل أيضاً على warnings/unexplained. |
| المعاملات | `src/lib/accounts/with-transaction.ts` | `withTransaction`, `txQuery`, `TxClient`, `acquireJournalEntriesLock`. |
| نمط POST/VOID | `cash-vouchers.ts`, `bank-vouchers.ts`, `supplier-payments.ts` | POST يُنشئ قيد `POSTED` مباشرة (`source_type/source_id`)، VOID يُنشئ قيداً عكسياً عبر `createReversalEntry` (لا حذف). idempotency عبر حارس الحالة + الفهرس الفريد. |
| API/UI | `app/api/accounts/**`, `app/accounts/**` | `requireAccountsAccess` → `assert*Capability` → `withTransaction` + أقفال + `writeFinancialAudit` → `jsonSuccess/jsonError` + `mapPgError`. UI عربي RTL، `_lib.tsx`، `ConfirmDialog`، صفحات طباعة منفصلة. |

### 1.2 وضع الرواتب/الأشخاص الحالي

- **لا يوجد أي جدول** للرواتب أو العقود أو السلف أو القروض أو المحاضرين الخارجيين في المشروع كله.
- توجد صفحتان **فارغتان (placeholder)** ومربوطتان في شريط تنقّل الحسابات: `/accounts/payroll` و`/accounts/staff` — أي أن مكان الوحدة مُهيّأ سلفاً.
- الجدول الوحيد القريب من «الكادر» هو `hr.teachers` (هجرة 032–034)، لكنه في مخطط `hr` **غير المتتبَّع في git وغير المستقر**، ونمط HR القديم بلا مصادقة/صلاحيات/معاملات. **لا نعتمد عليه إلزامياً**.
- الجدول المستقر الوحيد الآمن للربط الصلب هو `student_affairs.users(id)`.

---

## 2) البنية التحتية المحاسبية القابلة لإعادة الاستخدام

سنعيد استخدام (دون إعادة اختراع):

1. **محرك القيود:** `normalizeAndValidateLines(...,'strict')` + `allocateJournalEntryNumber` + `replaceJournalLines` + `createReversalEntry` + `assertFiscalContextForEntry`. القالب الأنظف للترحيل المباشر: `postFixedAssetJournalEntry` (`fixed-assets-gl.ts`) و`postCashVoucher`/`postBankVoucher`.
2. **التحقق من الحسابات:** `assertPostingAccount` / `assertPostingAccountWithType`، مع موثّقات نوعية جديدة للرواتب (مصروف=EXPENSE، مستحقات=LIABILITY، نقدية/بنك=ASSET) على غرار `fixed-assets-gl.ts`.
3. **المبالغ:** `money.ts` بالكامل (`moneyToMillis`, `millisToMoney`, `moneyToMillisSigned`, `normalizeMoneyInput`, `moneyEquals`, `sumMoney`, `moneyIsZero/Positive`).
4. **الأقفال:** `acquireAccountingResourceLocks` + إضافة domains ومساعدات factory للرواتب + `acquireJournalEntriesLock` عند لمس القيود.
5. **التزامن المتفائل:** `assertCashSessionOptimisticConcurrency` (نغلّفه كـ `assertOptimistic` محلي للرواتب).
6. **التدقيق:** `writeFinancialAudit` → `accounts.financial_audit_log` + إضافة أفعال `payroll_*`.
7. **الصلاحيات:** ملف `payroll-access.ts` بنمط `fixed-assets-access.ts` مع إعادة استخدام الأدوار الأربعة الموجودة.
8. **التسلسل:** `nextDocumentNumber` + إضافة أنواع `PAYROLL_*` إلى `document_sequence_types` و`DOCUMENT_SEQUENCE_DEFAULTS`.
9. **Verify:** نمط `verify-fixed-assets.ts` (lib + script + strict).
10. **API/UI:** نفس نمط `requireAccountsAccess` + `jsonSuccess/jsonError` + `mapPgError` + `_lib.tsx` + `ConfirmDialog` + صفحات الطباعة.

---

## 3) المخاطر والتعارضات (Risks & conflicts)

| # | الخطر/التعارض | الأثر | التخفيف المقترح |
|---|---|---|---|
| R1 | الاعتماد على `hr.teachers`/مخطط `hr` غير المستقر (untracked) | كسر عند تغيّر HR أو غيابه | **لا FK إلى `hr`**. عمود `hr_person_id UUID NULL` (ربط منطقي فقط) + تخزين snapshot لاسم/نوع الشخص داخل سجل الرواتب. FK صلب فقط إلى `student_affairs.users` عند اللزوم. |
| R2 | ازدواج الترحيل (Double Posting) لنفس الـ Run | قيود مكرّرة/أرصدة خاطئة | `source_type='PAYROLL_RUN' + source_id=run.id` مع الفهرس الفريد `uq_journal_entries_source` + حارس الحالة idempotent. |
| R3 | تعديل عقد/تخصيص مكوّن أثناء وجود Run قيد المعالجة | فقدان الذرّية/نتائج غير متسقة | Snapshot عند CALCULATE + أقفال موارد على العقد/التخصيص أثناء التشغيل + منع تعديل العقد إن وُجد Run غير نهائي يشير إليه. |
| R4 | حساسية بيانات الرواتب (خصوصية) | تسريب رواتب/حسابات مصرفية | فصل صلاحيات العرض، تقليل الحقول في list APIs، عدم تسجيل مبالغ/حسابات في logs، تدقيق العرض الحساس، حماية exports/الطباعة، منع IDOR. |
| R5 | التقريب/الاقتطاع في النِّسَب (PERCENTAGE) | فروق فلسية تكسر التوازن | كل الحساب بالمِلّي؛ فرق التقريب يُرحَّل إلى «حساب فروقات تقريب الرواتب» أو يُضاف لآخر سطر، لضمان تطابق مجموع الأسطر = صافي المستحق = مبلغ القيد. |
| R6 | صافي راتب سالب | التزام غير منطقي/قيد مشوّه | سياسة متدرّجة (D3): يُسمح في CALCULATED، Warning في REVIEWED، **يُمنع في APPROVED/POSTED** (409)؛ السلف/الأقساط تؤجَّل إلى 9.B. |
| R7 | تعدد Runs لنفس الفترة/النطاق (D6) | ازدواج استحقاق للشخص نفسه | مفتاح فريد على (فترة + `scope_type` + `scope_ref_id` + نوع REGULAR) + **حارس على مستوى الشخص** يمنع التداخل الجزئي بين النطاقات + منع تكرار الشخص داخل Run + فحص Verify «شخص في أكثر من REGULAR لنفس الفترة». |
| R8 | تعارض أرقام المستندات تحت التزامن | أرقام مكرّرة | `nextDocumentNumber` بـ `FOR UPDATE` حصراً (لا COUNT+1). |
| R9 | تعطّل نمط HR القديم (بلا مصادقة) لو استُخدم | ثغرات أمنية | عدم استدعاء أي API من `app/api/hr/**`؛ الوحدة الجديدة كلها ضمن `app/api/accounts/**` بالمصادقة الكاملة. |
| R10 | الفترة المحاسبية تُغلق بعد الاعتماد وقبل الترحيل | فشل الترحيل | التحقق من `OPEN` عند POST؛ منع الترحيل لفترة CLOSED/LOCKED؛ Verify يكشف Run POSTED مرتبط بفترة مغلقة بطريقة غير صحيحة. |

---

## 4) نموذج البيانات المقترح (Proposed data model)

جميع الجداول في مخطط `accounts` بادئة `payroll_`. الحقول العامة في كل جدول رئيسي: `version INTEGER NOT NULL DEFAULT 1`, `created_by/updated_by UUID REFERENCES student_affairs.users`, `created_at/updated_at TIMESTAMPTZ`. كل المبالغ `NUMERIC(18,3)`.

> ملاحظة تسمية: أبقيت الأسماء المقترحة كما طلبت مع استثناء واحد مبرَّر: أستخدم **`payroll_run_people`** بدل `payroll_run_employees` لأن النطاق يشمل تدريسيين ومحاضرين وعمّالاً لا موظفين فقط (اتساق مع مصطلح «person» عبر الوحدة).

### 4.1 `payroll_people` — سجل الأشخاص المستقل
- **الهدف:** مرجع مستقل لكل شخص يُصرف له (تدريسي/محاضر/موظف/عامل)، بلا اعتماد صلب على HR.
- **المفاتيح:** `id UUID PK`. `person_code VARCHAR(40)` (كود بشري فريد).
- **الحالات:** `status IN ('ACTIVE','SUSPENDED','TERMINATED')`.
- **حقول:** `person_type IN ('TEACHING_STAFF','EXTERNAL_LECTURER','EMPLOYEE','DAILY_WORKER','SERVICE_WORKER')`, `full_name_ar`, `full_name_en NULL`, `national_id VARCHAR(20) NULL`, `department_id UUID NULL REFERENCES student_affairs.departments ON DELETE SET NULL`, `default_cost_center_id UUID NULL REFERENCES accounts.cost_centers ON DELETE SET NULL`, `hr_person_id UUID NULL` (**بلا FK** — ربط منطقي بـ `hr.teachers`), `user_id UUID NULL REFERENCES student_affairs.users ON DELETE SET NULL`, `bank_account_no_enc TEXT NULL` (مخزَّن مقنّعاً/مختصراً — التفاصيل في §12), `notes TEXT NULL`.
- **UNIQUE:** `uq_payroll_people_code (LOWER(person_code))`؛ `uq_payroll_people_national_id (national_id) WHERE national_id IS NOT NULL`.
- **CHECK:** `person_type`/`status` ضمن القائمة.
- **FK/ON DELETE:** كما أعلاه (كلها `SET NULL` أو بلا FK للحفاظ على الاستقلالية).
- **الفهارس:** `(person_type)`, `(status)`, `(department_id) WHERE NOT NULL`, `(hr_person_id) WHERE NOT NULL`.
- **audit/version:** نعم.

### 4.2 `payroll_contracts` — عقد التوظيف الأساسي (Primary Employment Contract) — واحد فعّال لكل شخص
- **الهدف:** الأساس المالي الوحيد للشخص (نوع الأجر الأساسي ومعدّله وفترته). **عقد أساسي فعّال واحد فقط لكل شخص** (لكل الفئات) — لا تعدد عقود. أي مهام/تكليفات/بدلات إضافية تُمثَّل كـ **Assignments** (§4.2.1) فوق هذا العقد، لا كعقود جديدة (قرار D2).
- **المفاتيح:** `id UUID PK`, `payroll_person_id UUID NOT NULL REFERENCES accounts.payroll_people ON DELETE RESTRICT`, `contract_number VARCHAR(40)`.
- **الحالات:** `status IN ('DRAFT','ACTIVE','SUSPENDED','TERMINATED')`.
- **حقول:** `contract_type IN ('MONTHLY_FIXED','HOURLY','PER_LECTURE','DAILY','SERVICE_LUMP_SUM')`, `base_rate NUMERIC(18,3) NOT NULL DEFAULT 0` (الراتب الشهري/سعر الساعة/سعر المحاضرة/الأجر اليومي/المبلغ المقطوع حسب النوع), `currency_code CHAR(3) NOT NULL DEFAULT 'IQD'`, `effective_from DATE NOT NULL` (= start_date), `effective_to DATE NULL` (= end_date؛ NULL = عقد مفتوح), `is_open_ended BOOLEAN` (عمود صريح), `department_id UUID NULL`, `default_cost_center_id UUID NULL`, `suspended_at/terminated_at`, `termination_reason TEXT NULL`.
- **UNIQUE:** `uq_payroll_contracts_number (LOWER(contract_number))`؛ **الأهم:** `uq_payroll_contracts_one_active (payroll_person_id) WHERE status='ACTIVE'` — **يفرض على مستوى قاعدة البيانات عقداً أساسياً فعّالاً واحداً فقط لكل شخص، لكل الفئات** (بديلاً عن منطق منع التداخل السابق).
- **CHECK:** `base_rate >= 0`؛ `effective_to IS NULL OR effective_to >= effective_from`؛ `currency_code='IQD'` (9.A أحادي العملة)؛ `contract_type`/`status` ضمن القائمة.
- **منع التعدد:** لم نعد نعتمد على منطق «تداخل التواريخ الحصري»؛ بدلاً منه فهرس جزئي فريد `WHERE status='ACTIVE'` يمنع وجود عقدين أساسيين فعّالين. تفعيل عقد جديد يستلزم إنهاء/إيقاف العقد السابق أولاً (Transactional تحت قفل `PAYROLL_PERSON`).
- **FK/ON DELETE:** `payroll_person_id` = `RESTRICT` (لا حذف شخص له عقود).
- **الفهارس:** `(payroll_person_id, status)`, `(status)`, `(effective_from, effective_to)`.
- **audit/version:** نعم.

### 4.2.1 `payroll_assignments` — تكليفات التعويض (Compensation Assignments) — عدد غير محدود فوق العقد
- **الهدف:** تمثيل كل **المهام والمسؤوليات ومصادر البدلات** التي **ليست عقوداً** بل تكليفات مستقلة مرتبطة بعقد التوظيف الأساسي. مثال: رئيس قسم، مقرر قسم، عضوية لجنة امتحانية، محاضرات إضافية — **كلها Assignments لا عقود**. عددها غير محدود لكل شخص.
- **المفاتيح:** `id UUID PK`, `payroll_person_id UUID NOT NULL REFERENCES accounts.payroll_people ON DELETE RESTRICT`, `payroll_contract_id UUID NOT NULL REFERENCES accounts.payroll_contracts ON DELETE RESTRICT` (كل تكليف يرتبط بالعقد الأساسي)، `assignment_number VARCHAR(40)`.
- **الحالات:** `status IN ('DRAFT','ACTIVE','SUSPENDED','ENDED')`.
- **حقول:** `assignment_type IN ('TEMPORARY_DUTY','ADDITIONAL_RESPONSIBILITY','ALLOWANCE_SOURCE','LECTURER_ASSIGNMENT','COMMITTEE_ASSIGNMENT','GENERAL_ASSIGNMENT')`, `title_ar`, `title_en NULL`, `rate NUMERIC(18,3) NULL`, `amount NUMERIC(18,3) NULL`, `quantity NUMERIC(18,3) NULL`, `department_id UUID NULL`, `cost_center_id UUID NULL` (يسمح بتوجيه كلفة التكليف لمركز/قسم مختلف عن العقد), `subject_ref VARCHAR(120) NULL` (مادة/جهة/لجنة — نصي حر في 9.A، بلا FK لجداول HR غير المستقرة), `study_shift VARCHAR(20) NULL` (`MORNING`/`EVENING` عند اللزوم), `effective_from DATE NOT NULL`, `effective_to DATE NULL`, `notes TEXT NULL`.
- **UNIQUE:** `uq_payroll_assignments_number (LOWER(assignment_number))`. **لا قيد حصري على التعدد** — التكاليف المتعددة المتزامنة **مسموحة لكل الفئات** (لأنها ليست عقوداً؛ رئيس قسم + لجنة + محاضرات إضافية تتعايش).
- **CHECK:** `assignment_type`/`status` ضمن القوائم؛ `effective_to IS NULL OR effective_to >= effective_from`؛ `rate/amount/quantity >= 0` عند وجودها.
- **FK/ON DELETE:** `payroll_person_id` = `RESTRICT`؛ `payroll_contract_id` = `RESTRICT` (لا حذف عقد له تكاليف؛ يُنهى بدلاً من الحذف).
- **الفهارس:** `(payroll_person_id, status)`, `(payroll_contract_id)`, `(assignment_type)`, `(cost_center_id) WHERE NOT NULL`, `(effective_from, effective_to)`.
- **audit/version:** نعم.
- **العلاقة بالمكونات:** المكونات (البدلات/الأجور) تُخصَّص عبر `payroll_component_assignments` (§4.4) التي تشير اختيارياً إلى `payroll_assignment_id` — أي أن بدل رئاسة القسم = مكوّن مرتبط بتكليف `ADDITIONAL_RESPONSIBILITY`، وأجر المحاضرات الإضافية = مكوّن مرتبط بتكليف `LECTURER_ASSIGNMENT`.

### 4.3 `payroll_components` — كتالوج مكونات الرواتب
- **الهدف:** تعريف مرن للاستحقاقات والاستقطاعات (ومساهمات صاحب العمل مستقبلاً).
- **المفاتيح:** `id UUID PK`, `component_code VARCHAR(40)` فريد ثابت.
- **الحالات:** `is_active BOOLEAN` (فعّال/موقوف) + `effective_from DATE` / `effective_to DATE NULL`.
- **حقول:** `component_type IN ('EARNING','DEDUCTION','EMPLOYER_CONTRIBUTION')`, `name_ar`, `name_en`, `calculation_method IN ('FIXED_AMOUNT','PERCENTAGE_OF_BASIC','QUANTITY_X_RATE','DAYS_X_DAILY_RATE','HOURS_X_HOURLY_RATE','LECTURES_X_RATE','MANUAL_AMOUNT','CUSTOM_FORMULA')` (قيمة `CUSTOM_FORMULA` **محجوزة، غير منفَّذة في 9.A** — D14), `default_gl_account_id UUID NULL REFERENCES accounts.chart_of_accounts ON DELETE RESTRICT` (يُحسم فعلياً عبر account mapping — §10)، `default_cost_center_id UUID NULL`, `is_taxable BOOLEAN NOT NULL DEFAULT FALSE`, `is_subject_to_deduction BOOLEAN NOT NULL DEFAULT FALSE` (يدخل في وعاء الاستقطاعات النسبية), `show_on_payslip BOOLEAN NOT NULL DEFAULT TRUE`, `is_manual_editable BOOLEAN NOT NULL DEFAULT FALSE`, `sort_order INTEGER`.
- **UNIQUE:** `uq_payroll_components_code (LOWER(component_code))`.
- **CHECK:** `component_type`/`calculation_method` ضمن القوائم؛ `effective_to IS NULL OR effective_to >= effective_from`.
- **الفهارس:** `(component_type)`, `(is_active)`.
- **audit/version:** نعم.
- **الكتالوج الأساسي المقترح (seed baseline، قابل للتوسعة):** الاستحقاقات: `BASIC_SALARY, POSITION_ALLOWANCE, CERTIFICATE_ALLOWANCE, TRANSPORT_ALLOWANCE, LECTURE_FEES, OVERTIME, BONUS, DAILY_WAGE, SERVICE_FEE, OTHER_EARNING`. الاستقطاعات: `ABSENCE, LATE_DEDUCTION, ADVANCE_INSTALLMENT, LOAN_INSTALLMENT, PENALTY, TAX, PENSION, SOCIAL_SECURITY, OTHER_DEDUCTION`.

### 4.4 `payroll_component_assignments` — تخصيص المكونات للأشخاص/العقود/التكاليف
- **الهدف:** ربط مكوّن (استحقاق/استقطاع) بشخص، ومصدره: إمّا العقد الأساسي وإمّا **تكليف** (Assignment) محدّد، مع القيمة/المعدل/الكمية الافتراضية.
- **المفاتيح:** `id UUID PK`, `payroll_person_id UUID NOT NULL REFERENCES payroll_people ON DELETE RESTRICT`, `payroll_contract_id UUID NULL REFERENCES payroll_contracts ON DELETE CASCADE`, `payroll_assignment_id UUID NULL REFERENCES payroll_assignments ON DELETE CASCADE` (مصدر التكليف الاختياري — بدل رئاسة قسم/لجنة/محاضرات إضافية), `component_id UUID NOT NULL REFERENCES payroll_components ON DELETE RESTRICT`.
- **الحالات:** `is_active BOOLEAN` + `effective_from/effective_to`.
- **حقول:** `amount NUMERIC(18,3) NULL` (لـ FIXED_AMOUNT), `percentage NUMERIC(9,4) NULL` (لـ PERCENTAGE_OF_BASIC), `rate NUMERIC(18,3) NULL`, `default_quantity NUMERIC(18,3) NULL`, `gl_account_id UUID NULL` (تجاوز اختياري), `cost_center_id UUID NULL`.
- **UNIQUE:** `uq_pca_person_component_source_period (payroll_person_id, component_id, COALESCE(payroll_assignment_id,'00000000-0000-0000-0000-000000000000'::uuid), effective_from)` لمنع تخصيصين متطابقين متزامنين لنفس المصدر (يسمح بنفس المكوّن من تكاليف مختلفة — مثل بدل من تكليفين مختلفين).
- **CHECK:** اتساق الحقل مع طريقة المكوّن (يُفرض غالباً transactional؛ CHECK بسيط: `percentage IS NULL OR (percentage>=0 AND percentage<=100)`، `amount IS NULL OR amount>=0`)؛ `NOT (payroll_contract_id IS NOT NULL AND payroll_assignment_id IS NOT NULL)` (المصدر إمّا العقد وإمّا تكليف، لا كلاهما).
- **FK/ON DELETE:** `component_id`=`RESTRICT`؛ `payroll_contract_id`=`CASCADE`؛ `payroll_assignment_id`=`CASCADE` (إنهاء/حذف التكليف يزيل تخصيصاته).
- **الفهارس:** `(payroll_person_id, is_active)`, `(component_id)`, `(payroll_contract_id) WHERE NOT NULL`, `(payroll_assignment_id) WHERE NOT NULL`.
- **audit/version:** نعم.

### 4.5 `payroll_periods` — فترات الرواتب (مع حجز مفهوم Payroll Calendar)
- **الهدف:** فترة رواتب مرتبطة بفترة مالية، ضمن **تقويم رواتب (Calendar)** يحدد إيقاعها (شهري/محاضرين/يومي/صيفي/أكاديمي) — قرار D12.
- **المفاتيح:** `id UUID PK`, `fiscal_year_id UUID NOT NULL`, `fiscal_period_id UUID NOT NULL REFERENCES accounts.fiscal_periods ON DELETE RESTRICT`, `payroll_calendar_id UUID NULL REFERENCES accounts.payroll_calendars ON DELETE RESTRICT` (**بنية محجوزة** — انظر §4.12 وD12).
- **الحالات:** `status IN ('OPEN','PROCESSING','CLOSED')`.
- **حقول:** `code VARCHAR(40)` (مثل `PR-2026-01`), `calendar_type VARCHAR(20) NOT NULL DEFAULT 'MONTHLY'` (`MONTHLY`/`LECTURER`/`DAILY`/`SUMMER`/`ACADEMIC` — قيمة محجوزة تُشتق من التقويم), `period_start DATE NOT NULL`, `period_end DATE NOT NULL`, `pay_date DATE NULL`, `notes`.
- **UNIQUE:** `uq_payroll_periods_code (LOWER(code))`؛ `uq_payroll_periods_fiscal_calendar (fiscal_period_id, calendar_type)` (فترة رواتب واحدة لكل (فترة مالية + نوع تقويم) — يسمح بتعايش «شهري» و«محاضرين» في نفس الفترة المالية).
- **CHECK:** `period_end >= period_start`؛ `status`/`calendar_type` ضمن القائمة.
- **الفهارس:** `(fiscal_period_id)`, `(status)`, `(payroll_calendar_id) WHERE NOT NULL`.
- **audit/version:** نعم.

### 4.6 `payroll_runs` — كشوف الرواتب (رأس التشغيل)
- **الهدف:** تشغيل احتساب/اعتماد/ترحيل لكشف رواتب ضمن فترة.
- **المفاتيح:** `id UUID PK`, `run_number VARCHAR(40)` (من تسلسل `PAYROLL_RUN`), `payroll_period_id UUID NOT NULL REFERENCES payroll_periods ON DELETE RESTRICT`, `fiscal_year_id`, `fiscal_period_id`.
- **الحالات:** `status IN ('DRAFT','CALCULATED','REVIEWED','APPROVED','POSTED','PAID','CANCELLED','VOID')` (PAID/الدفع فعلياً في 9.C).
- **حقول:** `run_type IN ('REGULAR','SUPPLEMENTAL','CORRECTION','FINAL_SETTLEMENT')`, **حقول النطاق (D6):** `scope_type VARCHAR(20) NOT NULL DEFAULT 'ALL'` (`ALL`/`COLLEGE`/`DEPARTMENT`/`COST_CENTER`/`PERSON_LIST`), `scope_ref_id UUID NULL` (قسم/مركز كلفة عند `DEPARTMENT`/`COST_CENTER`), `scope_person_type VARCHAR(30) NULL` (تضييق اختياري إضافي بالفئة)، **حقول الإصدار (D11):** `revision_number INTEGER NOT NULL DEFAULT 1`, `root_run_id UUID NULL REFERENCES accounts.payroll_runs ON DELETE RESTRICT` (جذر سلسلة الإصدارات), `supersedes_run_id UUID NULL REFERENCES accounts.payroll_runs ON DELETE RESTRICT` (الإصدار الذي يحلّ محلّه هذا), `superseded_by_run_id UUID NULL REFERENCES accounts.payroll_runs ON DELETE RESTRICT`, `revision_reason TEXT NULL`, `total_earnings NUMERIC(18,3) DEFAULT 0`, `total_deductions NUMERIC(18,3) DEFAULT 0`, `total_net NUMERIC(18,3) DEFAULT 0`, `people_count INTEGER DEFAULT 0`, `journal_entry_id UUID NULL REFERENCES accounts.journal_entries ON DELETE RESTRICT`, `reversal_journal_entry_id UUID NULL`, `snapshot_policy JSONB NULL` (سياسة التقريب/العملة الملتقطة), `calculated_at/reviewed_at/approved_at/posted_at/voided_at`, `posted_by/approved_by/reviewed_by/voided_by`, `void_reason TEXT NULL`, `cancellation_reason TEXT NULL`.
- **UNIQUE:** `uq_payroll_runs_number (fiscal_year_id, run_number)`؛ `uq_payroll_runs_journal (journal_entry_id) WHERE NOT NULL`؛ **قيد نطاق REGULAR:** `uq_payroll_runs_regular_scope (payroll_period_id, scope_type, COALESCE(scope_ref_id,'00000000-0000-0000-0000-000000000000'::uuid), COALESCE(scope_person_type,'ALL')) WHERE run_type='REGULAR' AND status NOT IN ('CANCELLED','VOID')` (يمنع Runين REGULAR فعّالين لنفس (الفترة+النطاق) — قرار D6)؛ `uq_payroll_runs_revision (root_run_id, revision_number) WHERE root_run_id IS NOT NULL` (تفرّد رقم الإصدار داخل السلسلة).
- **CHECK (سلامة الترحيل، على غرار السندات):** `status<>'POSTED' OR (journal_entry_id IS NOT NULL AND posted_by IS NOT NULL AND posted_at IS NOT NULL)`؛ `status<>'VOID' OR (voided_by IS NOT NULL AND void_reason IS NOT NULL)`؛ `total_net = total_earnings - total_deductions` (يُعاد حسابه من الأسطر)؛ `scope_type` ضمن القائمة؛ `scope_type IN ('DEPARTMENT','COST_CENTER') = (scope_ref_id IS NOT NULL)` (اتساق مرجع النطاق)؛ `revision_number >= 1`.
- **الفهارس:** `(payroll_period_id, status)`, `(status)`, `(run_type)`, `(scope_type)`, `(root_run_id) WHERE NOT NULL`.
- **audit/version:** نعم.
- **PERSON_LIST:** عند `scope_type='PERSON_LIST'` تُحدَّد قائمة الأشخاص عبر جدول `payroll_run_scope_members` (§4.13).

### 4.7 `payroll_run_people` — أشخاص الكشف (سطر الشخص + Snapshot)
- **الهدف:** سطر لكل شخص داخل التشغيل مع لقطة العقد والإجماليات.
- **المفاتيح:** `id UUID PK`, `run_id UUID NOT NULL REFERENCES payroll_runs ON DELETE CASCADE`, `payroll_person_id UUID NOT NULL REFERENCES payroll_people ON DELETE RESTRICT`, `payroll_contract_id UUID NULL REFERENCES payroll_contracts ON DELETE RESTRICT`.
- **حقول (Snapshot):** `person_name_snapshot`, `person_type_snapshot`, `contract_type_snapshot`, `base_rate_snapshot NUMERIC(18,3)`, `cost_center_id UUID NULL`, `department_id UUID NULL`, `gross_amount NUMERIC(18,3)`, `deductions_amount NUMERIC(18,3)`, `net_amount NUMERIC(18,3)`, `currency_code CHAR(3)`.
- **UNIQUE:** `uq_prp_run_person (run_id, payroll_person_id)` (منع تكرار الشخص داخل التشغيل).
- **CHECK:** `net_amount = gross_amount - deductions_amount`؛ `gross_amount>=0 AND deductions_amount>=0` (**`net_amount` قد يكون سالباً في `CALCULATED`/`REVIEWED`**؛ يُمنع السالب عند `APPROVED`/`POSTED` عبر منطق الانتقال لا عبر CHECK — سياسة D3).
- **FK/ON DELETE:** `run_id`=`CASCADE` (حذف Run DRAFT يحذف أسطره)؛ الأشخاص/العقود=`RESTRICT`.
- **الفهارس:** `(run_id)`, `(payroll_person_id)`, `(cost_center_id) WHERE NOT NULL`.

### 4.8 `payroll_run_lines` — سطور المكونات لكل شخص (Snapshot تفصيلي)
- **الهدف:** كل مكوّن محسوب لكل شخص (نتيجة الحساب الثابتة).
- **المفاتيح:** `id UUID PK`, `run_id UUID NOT NULL REFERENCES payroll_runs ON DELETE CASCADE`, `run_person_id UUID NOT NULL REFERENCES payroll_run_people ON DELETE CASCADE`, `component_id UUID NULL REFERENCES payroll_components ON DELETE RESTRICT`.
- **حقول (Snapshot):** `component_code_snapshot`, `component_name_snapshot`, `component_type_snapshot IN ('EARNING','DEDUCTION','EMPLOYER_CONTRIBUTION')`, `calculation_method_snapshot`, `quantity NUMERIC(18,3) NULL`, `rate NUMERIC(18,3) NULL`, `percentage NUMERIC(9,4) NULL`, `amount NUMERIC(18,3) NOT NULL`, `gl_account_id UUID NOT NULL REFERENCES accounts.chart_of_accounts ON DELETE RESTRICT`, `cost_center_id UUID NULL`, `is_manual BOOLEAN DEFAULT FALSE`, `sort_order INTEGER`.
- **UNIQUE:** `uq_prl_person_component (run_person_id, component_id) WHERE component_id IS NOT NULL` (لا تكرار لنفس المكوّن للشخص في نفس التشغيل).
- **CHECK:** `amount >= 0`؛ `component_type_snapshot` ضمن القائمة.
- **الفهارس:** `(run_id)`, `(run_person_id)`, `(component_id) WHERE NOT NULL`, `(gl_account_id)`.

### 4.9 `payroll_run_adjustments` — تعديلات التشغيل
- **الهدف:** تعديلات يدوية موثّقة (إضافة/خصم استثنائي) قبل الاعتماد، مع سبب.
- **المفاتيح:** `id UUID PK`, `adjustment_number VARCHAR(40)` (تسلسل `PAYROLL_ADJUSTMENT`), `run_id UUID NOT NULL REFERENCES payroll_runs ON DELETE CASCADE`, `run_person_id UUID NOT NULL REFERENCES payroll_run_people ON DELETE CASCADE`, `component_id UUID NULL REFERENCES payroll_components ON DELETE RESTRICT`.
- **حقول:** `adjustment_type IN ('EARNING','DEDUCTION')`, `amount NUMERIC(18,3) NOT NULL`, `reason TEXT NOT NULL`, `gl_account_id UUID NULL`, `cost_center_id UUID NULL`, `applied_run_line_id UUID NULL` (ربط بالسطر الناتج).
- **UNIQUE:** `uq_pra_number (LOWER(adjustment_number))`.
- **CHECK:** `amount > 0`؛ `length(trim(reason))>0`؛ `adjustment_type` ضمن القائمة.
- **FK/ON DELETE:** `run_id/run_person_id`=`CASCADE`.
- **الفهارس:** `(run_id)`, `(run_person_id)`.
- **audit/version:** نعم (version للتعديل قبل الاعتماد).

### 4.10 `payroll_account_mappings` — خرائط الحسابات المحاسبية
- **الهدف:** ربط مرن (فئة/مكوّن) → حساب GL ومركز كلفة، **بلا Hardcode**.
- **المفاتيح:** `id UUID PK`.
- **حقول:** `mapping_scope IN ('COMPONENT','PERSON_TYPE','PAYABLE','ROUNDING')`, `component_id UUID NULL REFERENCES payroll_components ON DELETE CASCADE`, `person_type VARCHAR(30) NULL`, `gl_account_id UUID NOT NULL REFERENCES accounts.chart_of_accounts ON DELETE RESTRICT`, `cost_center_id UUID NULL`, `is_active BOOLEAN DEFAULT TRUE`, `effective_from DATE`, `effective_to DATE NULL`, `notes`.
- **UNIQUE:** `uq_pam_component (component_id, person_type, effective_from) WHERE component_id IS NOT NULL`؛ `uq_pam_payable (person_type) WHERE mapping_scope='PAYABLE'`؛ صف واحد فعّال لـ `ROUNDING`.
- **CHECK:** `mapping_scope` ضمن القائمة؛ تناسق الحقول حسب النطاق (transactional).
- **الفهارس:** `(mapping_scope)`, `(component_id) WHERE NOT NULL`, `(person_type) WHERE NOT NULL`.
- **الحسابات المطلوب تعيينها (§10).**

### 4.11 `payroll_approval_history` — سجل الاعتماد/الانتقالات
- **الهدف:** أثر كامل لكل انتقال حالة على التشغيل (من/إلى، من نفّذ، متى، سبب).
- **المفاتيح:** `id UUID PK`, `run_id UUID NOT NULL REFERENCES payroll_runs ON DELETE CASCADE`.
- **حقول:** `from_status VARCHAR(30) NULL`, `to_status VARCHAR(30) NOT NULL`, `action VARCHAR(40) NOT NULL` (calculate/review/approve/post/void/cancel), `performed_by UUID NOT NULL REFERENCES student_affairs.users`, `performed_at TIMESTAMPTZ DEFAULT NOW()`, `reason TEXT NULL`, `snapshot_totals JSONB NULL`.
- **CHECK:** `to_status` ضمن حالات التشغيل.
- **الفهارس:** `(run_id, performed_at)`, `(action)`.
- **ملاحظة:** جدول append-only للتدقيق (لا version/updated_at). مكمّل لـ `financial_audit_log` لا بديل عنه.

### 4.12 `payroll_calendars` — تقويمات الرواتب (بنية محجوزة، D12)
- **الهدف:** تعريف إيقاعات صرف متعددة مستقلة عن الفترة المالية (شهري/محاضرين/يومي/صيفي/أكاديمي). **البنية محجوزة في 9.A** (يُبذر تقويم `MONTHLY` افتراضي فقط)، والتنفيذ الكامل للجدولة الآلية يؤجَّل إلى 9.B/9.D.
- **المفاتيح:** `id UUID PK`, `code VARCHAR(40)`.
- **الحالات:** `is_active BOOLEAN NOT NULL DEFAULT TRUE`.
- **حقول:** `calendar_type VARCHAR(20) NOT NULL` (`MONTHLY`/`LECTURER`/`DAILY`/`SUMMER`/`ACADEMIC`), `name_ar`, `name_en NULL`, `frequency VARCHAR(20) NULL` (`MONTHLY`/`ON_DEMAND`/... — محجوز), `notes TEXT NULL`.
- **UNIQUE:** `uq_payroll_calendars_code (LOWER(code))`؛ `uq_payroll_calendars_type (calendar_type) WHERE is_active` (تقويم فعّال واحد لكل نوع في 9.A).
- **CHECK:** `calendar_type` ضمن القائمة.
- **الفهارس:** `(calendar_type)`, `(is_active)`.
- **audit/version:** نعم.
- **قرار التنفيذ (D12):** **نحجز البنية فقط الآن** — الجدول + العمود `payroll_periods.payroll_calendar_id`/`calendar_type` موجودان لكن المنطق (توليد فترات آلي، قواعد تكرار) مؤجَّل. هذا يتجنّب هجرة مؤلمة لاحقاً دون تعقيد 9.A.

### 4.13 `payroll_run_scope_members` — أعضاء نطاق PERSON_LIST (D6)
- **الهدف:** تحديد قائمة الأشخاص صراحةً عندما يكون `scope_type='PERSON_LIST'`.
- **المفاتيح:** `id UUID PK`, `run_id UUID NOT NULL REFERENCES payroll_runs ON DELETE CASCADE`, `payroll_person_id UUID NOT NULL REFERENCES payroll_people ON DELETE RESTRICT`.
- **UNIQUE:** `uq_prsm_run_person (run_id, payroll_person_id)`.
- **FK/ON DELETE:** `run_id`=`CASCADE`؛ `payroll_person_id`=`RESTRICT`.
- **الفهارس:** `(run_id)`, `(payroll_person_id)`.

---

## 5) دورة الحياة والانتقالات (Workflow)

### 5.1 فترة الرواتب `payroll_periods`
`OPEN → PROCESSING → CLOSED`
- `OPEN`: يمكن إنشاء Runs. `PROCESSING`: يوجد Run نشط قيد المعالجة. `CLOSED`: لا Runs جديدة (بعد الترحيل النهائي). إغلاق الفترة يتطلب ألا يوجد Run غير نهائي (DRAFT/CALCULATED/REVIEWED/APPROVED).

### 5.2 تشغيل الرواتب `payroll_runs`
`DRAFT → CALCULATED → REVIEWED → APPROVED → POSTED → PAID` + `CANCELLED` / `VOID`

| الانتقال | من←إلى | الصلاحية | ملاحظات |
|---|---|---|---|
| create | ∅→DRAFT | `payroll_calculate` (أو prepare) | إنشاء التشغيل وتحديد النطاق/النوع. |
| calculate | DRAFT/CALCULATED→CALCULATED | `payroll_calculate` | يبني الأسطر و**يلتقط Snapshot**. **يُسمح بالحساب حتى لو كان الصافي سالباً** (D3). يُسمح بإعادة الحساب (Recalculate) ما دام DRAFT/CALCULATED (يعيد بناء الأسطر بالكامل). |
| review | CALCULATED→REVIEWED | `payroll_review` | مراجعة بشرية. **يُظهر Warning واضحاً لكل شخص صافيه سالب** (لا يمنع الانتقال) — D3. |
| approve | REVIEWED→APPROVED | `payroll_approve` | **يُمنع الاعتماد إذا كان صافي أي شخص سالباً** (409) — D3. **يُجمّد Snapshot نهائياً** (immutable). |
| post | APPROVED→POSTED | `payroll_post` | **يُمنع الترحيل إذا كان صافي أي شخص سالباً** (409) — D3. يُنشئ القيد المحاسبي `POSTED` (Payroll Payable). لا يُرحَّل مرتين. |
| pay | POSTED→PAID | (9.C) | خارج 9.A. |
| cancel | DRAFT/CALCULATED/REVIEWED→CANCELLED | `payroll_admin`/`approve` | إلغاء قبل الترحيل، بلا أثر محاسبي. |
| void | POSTED→VOID | `payroll_void` | يُنشئ قيداً عكسياً (لا حذف). |

- **متى يمكن التعديل؟** فقط في `DRAFT`/`CALCULATED` (وتعديل التعيينات/التعديلات اليدوية). بعد `REVIEWED` لا تعديل إلا بالرجوع للحساب (إن سُمح)، وبعد `APPROVED` **لا تعديل إطلاقاً**.
- **متى يثبت Snapshot؟** يُلتقط عند `CALCULATE`، ويصبح **غير قابل للتغيير عند `APPROVED`** (قرار D4).
- **إعادة CALCULATE؟** مسموحة ما دام `DRAFT`/`CALCULATED`؛ ممنوعة بعد `REVIEWED`.
- **بعد APPROVED؟** يُسمح فقط بـ POST أو (رجوع إداري موثّق إلى REVIEWED عبر `payroll_admin` مع سبب — اختياري، قرار قابل للحسم).
- **بعد POSTED؟** لا تعديل. التصحيح يتم عبر **VOID + Run جديد** ضمن سلسلة الإصدارات (D11): يُنشأ إصدار جديد `revision_number+1` مع `supersedes_run_id` = الإصدار المعكوس ونوع `CORRECTION`، ويُضبط `superseded_by_run_id` على الأصل. أو Run `SUPPLEMENTAL` مستقل للفروقات.
- **سلسلة الإصدارات (Versioning/Revision — D11):** `Version 1 (POSTED) → VOID → Version 2 (CORRECTION) → VOID → Version 3 …`. كل إصدار Run مستقل بقيده الخاص (`source_id` فريد) وقيد عكسي عند VOID؛ الربط عبر `root_run_id`/`supersedes_run_id`/`superseded_by_run_id` + سجل كامل في `payroll_approval_history`.
- **الفرق بين CANCELLED وVOID:** `CANCELLED` قبل الترحيل (لا قيد، لا أثر مالي). `VOID` بعد الترحيل (قيد عكسي إلزامي، أثر صافي = صفر).
- **تعدد Runs للفترة:** مسموح: REGULAR واحد لكل (فترة+نطاق) + `SUPPLEMENTAL`/`CORRECTION`/`FINAL_SETTLEMENT` متعددة.
- **أنواع Run:** `REGULAR` (الدورة الأساسية)، `SUPPLEMENTAL` (مستحقات إضافية/فروقات)، `CORRECTION` (تصحيح بعد VOID)، `FINAL_SETTLEMENT` (تسوية نهائية عند إنهاء الخدمة).

### 5.3 اختلاف الاحتساب حسب الفئة (وما يدخل في 9.A مقابل 9.B)

| الفئة | الأساس في 9.A | مصدر الكمية في 9.A | يؤجَّل إلى 9.B |
|---|---|---|---|
| TEACHING_STAFF | راتب شهري ثابت + بدلات (منصب/شهادة/نقل) | ثابت شهري | الحضور التفصيلي، خصم الغياب الفعلي |
| EXTERNAL_LECTURER | أجر بالمحاضرة `LECTURES_X_RATE` | **كمية مُدخلة يدوياً** (عدد المحاضرات) | ساعات المحاضرين الفعلية من الحضور |
| EMPLOYEE | راتب شهري ثابت + بدلات | ثابت شهري | التأخير/الإضافي الفعلي من البصمة |
| DAILY_WORKER | أجر يومي `DAYS_X_DAILY_RATE` | **عدد أيام مُدخل يدوياً** | الأيام الفعلية من الحضور/البصمة |
| SERVICE_WORKER | مبلغ خدمة مقطوع `FIXED_AMOUNT`/`SERVICE_FEE` | مبلغ مقطوع | ربط بعقود خدمة تفصيلية |

> **قاعدة 9.A:** الكميات (محاضرات/أيام/ساعات) تُدخل **يدوياً** ضمن التشغيل (بلا تكامل حضور)، والاحتساب Deterministic من Snapshot المعدلات. التكامل الآلي مع الحضور/البصمة/الساعات الفعلية = 9.B.

### 5.4 نطاق الرواتب (Payroll Scope — D6)

مفهوم **مستقل عن Person Type**، يحدد «أي مجموعة أشخاص يغطّيها التشغيل»:

| `scope_type` | التغطية | `scope_ref_id` |
|---|---|---|
| `ALL` | كل الأشخاص الفعّالين المؤهّلين | — |
| `COLLEGE` | كل الكلية (مكافئ ALL حالياً، محجوز للتوسع متعدد الكيانات) | — |
| `DEPARTMENT` | قسم محدد | `department_id` |
| `COST_CENTER` | مركز كلفة محدد | `cost_center_id` |
| `PERSON_LIST` | قائمة أشخاص صريحة | عبر `payroll_run_scope_members` (§4.13) |

- **لماذا نحتاجه؟** الاعتماد على Person Type وحده لا يكفي: قد نحتاج تشغيلاً لقسم واحد، أو لمركز كلفة، أو لمجموعة أشخاص مختارين (تسوية/إضافي)، مستقلاً عن الفئة. الفصل يجعل النطاق بُعداً أولياً قابلاً للدمج مع تضييق اختياري بالفئة (`scope_person_type`).
- **الأثر على Payroll Runs:** يحدد `scope_type` مجموعة الأشخاص التي يبنيها `calculate`؛ ويدخل في مفتاح تفرّد REGULAR ليمنع تشغيلين أساسيين متطابقي النطاق.
- **منع التداخل (طبقتان):**
  1. **مفتاح التفرّد الخشن:** `uq_payroll_runs_regular_scope (payroll_period_id, scope_type, COALESCE(scope_ref_id,'…'), COALESCE(scope_person_type,'ALL'))` لِـ REGULAR غير الملغى.
  2. **حارس على مستوى الشخص (الأقوى، يمنع التداخل الجزئي):** عند `calculate`/`post` يُرفض إدراج شخص في REGULAR إذا كان مشمولاً بالفعل في REGULAR آخر غير ملغى لنفس الفترة — بصرف النظر عن اختلاف النطاقات (مثلاً `ALL` مقابل `DEPARTMENT`). مدعوم بفحص Verify «شخص في أكثر من REGULAR لنفس الفترة».
- **جدول مستقل أم Enum؟** الأنواع الأربعة (`ALL/COLLEGE/DEPARTMENT/COST_CENTER`) = **Enum + `scope_ref_id`** فقط (لا جدول). فقط `PERSON_LIST` يحتاج **جدولاً** (`payroll_run_scope_members`) لتخزين القائمة الصريحة.

### 5.5 التأريخ الفعّال (Effective Dating — D13)

كل من: **العقد (`payroll_contracts`)، التكليف (`payroll_assignments`)، المكوّن (`payroll_components`)، التخصيص (`payroll_component_assignments`)، والخريطة المحاسبية (`payroll_account_mappings`)** يحمل `effective_from` و`effective_to (NULL=مفتوح)`. النظام **لا يعتمد على `created_at`** في الاحتساب.
- **الاستخدام أثناء Calculation:** يُختار **صف واحد سارٍ** لكل مصدر عند **التاريخ المرجعي للتشغيل** (`payroll_periods.period_end` افتراضياً)، بشرط `effective_from <= ref_date AND (effective_to IS NULL OR effective_to >= ref_date)` وأن يكون الصف فعّالاً (`is_active`/`status='ACTIVE'`). هذا يضمن أن تغييرات مستقبلية (بدل جديد يبدأ الشهر القادم) لا تؤثر على تشغيل الشهر الحالي، والعكس، ويجعل إعادة الحساب لفترة ماضية **قابلة لإعادة الإنتاج بدقة** من التواريخ الفعّالة المخزَّنة.
- **التعارضات:** تداخل صفّين ساريين لنفس المصدر/الشخص يُمنع عبر مفاتيح التفرّد المبنية على `effective_from` + تحقّق transactional.

---

## 6) نموذج الاحتساب (Calculation model)

### 6.1 الطرق (Calculation Methods) — تعداد ثابت، بلا صيغ نصية/eval

| الطريقة | المعادلة (بالمِلّي) | الاستخدام |
|---|---|---|
| `FIXED_AMOUNT` | `amount` | مبالغ ثابتة (بدلات/مبلغ خدمة) |
| `PERCENTAGE_OF_BASIC` | `floor(basic_millis × percentage / 100)` | بدل نسبي من الأساس |
| `QUANTITY_X_RATE` | `quantity × rate / 1000` | عام كمية×سعر |
| `DAYS_X_DAILY_RATE` | `days × daily_rate / 1000` | عمال يوميون |
| `HOURS_X_HOURLY_RATE` | `hours × hourly_rate / 1000` | أجر بالساعة |
| `LECTURES_X_RATE` | `lectures × lecture_rate / 1000` | محاضرون خارجيون |
| `MANUAL_AMOUNT` | `amount` مُدخل يدوياً مع سبب | تعديلات استثنائية |
| `CUSTOM_FORMULA` | **محجوزة — غير منفَّذة في 9.A** | خارطة طريق محرك الصيغ (D14) |

- **لا eval / لا JS ديناميكي / لا صيغ نصية.** الطريقة تُختار من enum ومدخلاتها أعمدة رقمية فقط.
- **Deterministic وقابل لإعادة الإنتاج:** نفس المدخلات (Snapshot) → نفس المخرجات دائماً؛ كل الحساب على `bigint` مِلّي.
- **حجز `CUSTOM_FORMULA` (D14):** القيمة مضافة إلى enum منذ الآن (لتجنّب هجرة قيد لاحقة)، لكن **محرك الاحتساب يرفضها صراحةً في 9.A** برسالة «طريقة الاحتساب بالصيغة المخصّصة غير مفعّلة بعد» ويمنع اعتماد/ترحيل أي تشغيل يستخدمها. لا يوجد أي تخزين/تنفيذ لصيغ نصية في 9.A — الحجز على مستوى enum فقط دون أي تعقيد تنفيذي.

### 6.2 سياسات القيم
- **التقريب:** لا تقريب — **اقتطاع (floor/truncation)** إلى 3 منازل (مِلّي)، مطابق لـ `money.ts`. أي فرق فلسي ناتج عن النِّسَب يُجمَّع ويُعالَج عبر «حساب فروقات تقريب الرواتب» (mapping ROUNDING) أو يُسنَد لآخر سطر، لضمان: `Σ(أسطر الشخص) = صافي الشخص` و`Σ(الأشخاص) = مبلغ القيد`.
- **العملة:** IQD فقط في 9.A (CHECK). تعدد العملات مؤجَّل.
- **القيم السالبة:** المكوّنات تُخزَّن كمقادير موجبة مع `component_type` يحدّد الإشارة (EARNING موجب، DEDUCTION سالب منطقياً). لا مبالغ سالبة في `amount`.
- **الحد الأدنى/الأقصى:** اختياري على مستوى المكوّن (مؤجَّل التفصيل)؛ في 9.A لا حدود إجبارية عدا `>= 0`.
- **صافي راتب سالب (سياسة متدرّجة — D3):** يُسمح به في `CALCULATED` (لا يُرفض الحساب)؛ يُظهر **Warning** واضحاً في `REVIEWED`؛ ويُمنع نهائياً في `APPROVED` و`POSTED` (409). أي لا يمكن اعتماد أو ترحيل تشغيل يحوي أي شخص بصافٍ سالب. (السلف/الأقساط التي تنتج ذلك مؤجَّلة إلى 9.B.)
- **المكونات الصفرية:** تُحسب لكنها لا تُنشئ سطر قيد محاسبي (تُستبعد من القيد)، وقد تظهر/تُخفى في القسيمة حسب `show_on_payslip`.
- **فروقات التقريب:** تُرحَّل إلى حساب مخصّص (قرار D8) لإبقاء القيد متوازناً بالضبط.

---

## 7) سياسة اللقطة (Snapshot Policy)

عند `CALCULATE` يُبنى Snapshot كامل مخزَّن في `payroll_run_people` + `payroll_run_lines` (وحقول `_snapshot`)، ولا يعتمد التشغيل بعدها على القيم الحية القابلة للتغيير. يحفظ Snapshot:
- بيانات الشخص (`person_name_snapshot`, `person_type_snapshot`).
- بيانات العقد (`contract_type_snapshot`, `base_rate_snapshot`, `payroll_contract_id`).
- المعدلات/الأسعار (`rate`, `percentage`) والكميات (`quantity`).
- المكونات (`component_code/name/type/method` snapshot).
- الحسابات المحاسبية (`gl_account_id` لكل سطر) ومراكز الكلفة (`cost_center_id`).
- نتائج الحساب (`amount`, `gross/deductions/net`).
- أسباب التعديلات (`payroll_run_adjustments.reason`).
- العملة (`currency_code`) وسياسة التقريب (`payroll_runs.snapshot_policy` JSONB).

- **قابل للتغيير:** ما دام `DRAFT`/`CALCULATED` (إعادة الحساب تعيد بناء Snapshot).
- **غير قابل للتغيير (immutable):** اعتباراً من `APPROVED` فصاعداً (وبالتأكيد بعد `POSTED`). أي تغيير بعدها يتطلب VOID + Run جديد.

---

## 8) السياسة المحاسبية (Accounting policy)

### 8.1 القيد عند POST
قيد واحد لكل Run، `entry_type='SALARY'`, `source_type='PAYROLL_RUN'`, `source_id=run.id`, متوازن، متعدد الأسطر، **مجمَّع حسب (الحساب + مركز الكلفة)**:

```
Dr مصروف رواتب التدريسيين           (بحسب person_type/component → mapping)
Dr مصروف رواتب الموظفين
Dr مصروف المحاضرين الخارجيين
Dr مصروف الأجور اليومية
Dr مصروف الخدمات
    Cr رواتب وأجور مستحقة (Payroll Payable)     = صافي المستحق
    Cr استقطاعات مستحقة (Deductions Payable)
    Cr ضرائب مستحقة (Tax Payable)
    Cr تقاعد/ضمان مستحق (Pension/Social Security Payable)
    [Cr/Dr فروقات تقريب الرواتب]                  (عند اللزوم فقط)
```
- إجمالي المدين (المصروفات) = إجمالي الاستحقاقات (gross). إجمالي الدائن = صافي المستحق + مجموع الاستقطاعات = gross. القيد متوازن حتماً.
- **قابلية التتبع:** `payroll_runs.journal_entry_id` + `source_type/source_id` + `uq_journal_entries_source` تمنع الترحيل المزدوج.
- **VOID:** عبر `createReversalEntry` (قيد عكسي `POSTED`, `is_reversal=TRUE`, `reverses_entry_id`) وتخزين `reversal_journal_entry_id` — **لا حذف** للقيد الأصلي.

### 8.2 حدود 9.A مقابل الدفع
- **9.A ينتهي عند `POSTED` وتكوين Payroll Payable** (التزام مستحق). ✅ (القرار المفضّل D1.)
- **الدفع الفعلي** (من الصندوق/البنك، تخفيض Payroll Payable) → **9.C**. لن نبني واجهة دفع في 9.A إلا إذا لزمت ضرورة معمارية (نكتفي بحقل `PAID` وواجهة تكامل مؤجَّلة).

---

## 9) الأمن والصلاحيات (Security & permissions)

### 9.1 الصلاحيات (نمط `X_CAPABILITIES`)
`payroll-access.ts` يعرّف `PAYROLL_CAPABILITIES`:
`payroll_view`, `payroll_manage_people`, `payroll_manage_contracts`, `payroll_manage_components`, `payroll_calculate`, `payroll_review`, `payroll_approve`, `payroll_post`, `payroll_void`, `payroll_reports`, `payroll_admin`.

### 9.2 فصل المهام (Segregation of Duties) وربط الأدوار الأربعة الموجودة
| الدور | القدرات |
|---|---|
| VIEWER (`accounts_viewer`) | `payroll_view`, `payroll_reports` |
| CLERK (`accounts_clerk`) | + `manage_people`, `manage_contracts`, `manage_components`, `payroll_calculate` (إدخال + حساب) |
| APPROVER (`accounts_approver`) | + `payroll_review`, `payroll_approve`, `payroll_post` (مراجعة + اعتماد + ترحيل) |
| ADMIN (`accounts_admin`) | + `payroll_void`, `payroll_admin` (إبطال + إداري) وكل ما سبق |

- **الفصل:** من يُدخل/يحسب (CLERK) ≠ من يراجع/يعتمد/يرحّل (APPROVER) ≠ من يبطل (ADMIN). (قرار D10 يفصّل إن رغبتم بفصل reviewer عن approver.)
- **Least Privilege:** عضوية `ACCOUNTS` وحدها بلا دور = VIEW_ONLY فقط.

### 9.3 الخصوصية والأمن (بيانات حساسة)
- منع IDOR: كل قراءة/كتابة عبر `requireAccountsAccess` + `assertPayrollCapability`؛ لا وصول لقسيمة شخص آخر بلا صلاحية.
- تقليل الحقول في list APIs (لا حسابات مصرفية ولا تفاصيل غير لازمة).
- تقنيع الحساب المصرفي (عرض آخر 4 خانات فقط)؛ تخزينه مقنّعاً/مختصراً وعدم إرجاعه كاملاً.
- عدم تسجيل الراتب أو الحساب المصرفي في logs.
- تدقيق عمليات العرض الحساسة (تصدير/طباعة قسيمة) إن توافق مع النظام.
- حماية ملفات الطباعة وCSV/Excel exports خلف الصلاحية.

---

## 10) الأقفال والتزامن (Locking & concurrency)

### 10.1 domains جديدة تُضاف إلى `AccountingLockDomain`
`PAYROLL_PERIOD`, `PAYROLL_RUN`, `PAYROLL_RUN_LINE`, `PAYROLL_PERSON`, `PAYROLL_CONTRACT`, `PAYROLL_ASSIGNMENT`, `PAYROLL_COMPONENT`, `PAYROLL_COMPONENT_ASSIGNMENT`, `PAYROLL_ACCOUNT_MAPPING`, `PAYROLL_CALENDAR` + مساعدات factory موازية.

### 10.2 الأقفال لكل حدث ومنع الازدواج
| الحدث | الأقفال |
|---|---|
| إنشاء Run للفترة | `PAYROLL_PERIOD(periodId)` + `PAYROLL_RUN` (منع REGULAR مزدوج عبر القيد الفريد) |
| Calculate/Recalculate | `PAYROLL_RUN(runId)` + `PAYROLL_PERSON(*)`/`PAYROLL_CONTRACT(*)` للأشخاص المشمولين |
| Approve | `PAYROLL_RUN(runId)` |
| Post | `PAYROLL_RUN(runId)` + `acquireJournalEntriesLock` + `documentSequenceLock('PAYROLL_RUN', fyId)` + `glAccountLock(...)` للحسابات المتأثرة |
| Void | `PAYROLL_RUN(runId)` + `acquireJournalEntriesLock` + `journalSourceLock('PAYROLL_RUN', runId)` |
| تعديل عقد أثناء Run قيد المعالجة | `PAYROLL_CONTRACT(contractId)` + رفض إن وُجد Run غير نهائي يشير للشخص |
| تعديل تخصيص مكوّن أثناء الحساب | `PAYROLL_COMPONENT_ASSIGNMENT(id)` + `PAYROLL_PERSON(personId)` |

- **يُمنع:** Double Calculation، Double Approval، Double Posting (حارس الحالة + الفهرس الفريد)، تغيير العقد أثناء Snapshot، تغيير المكوّن أثناء الحساب، Runان REGULAR متزامنان لنفس الفترة/النطاق.
- **ترتيب الأقفال الموحّد:** نعتمد ترتيب `acquireAccountingResourceLocks` (dedupe + sort) دائماً، وعند لمس القيود نأخذ `acquireJournalEntriesLock` أولاً ثم أقفال الموارد ثم `FOR UPDATE` على الصفوف — بنفس اصطلاح السندات لتفادي الـ deadlock.
- **التزامن المتفائل:** كل تحوّل حالة/تعديل يمرّر `version` + `updated_at` ويُفحص عبر `assertOptimistic` (غلاف على `assertCashSessionOptimisticConcurrency`).

---

## 11) تصميم محرك التحقق (Verify design)

`src/lib/accounts/verify-payroll.ts` + `src/scripts/verify-payroll.ts`، نتيجة `{ok, strict, mismatches[], warnings[], unexplained[], summary}`. السكربتات: `accounts:verify-payroll` و`accounts:verify-payroll:strict`.

**الفحوص (normal = فشل عند أي mismatch محاسبي/سلامة بيانات):**
1. Run `POSTED` بلا `journal_entry_id`.
2. أكثر من قيد أصلي (غير عكسي) لنفس Run (خرق `uq_journal_entries_source`).
3. القيد غير متوازن (`total_debit ≠ total_credit`).
4. `Σ(run_lines amounts)` ≠ إجماليات Run (earnings/deductions).
5. `gross − deductions ≠ net` (على مستوى الشخص وعلى مستوى Run).
6. شخص مكرر داخل نفس Run (خرق `uq_prp_run_person`).
7. عقد غير صالح ضمن Snapshot (عقد غير `ACTIVE`/خارج التواريخ وقت التشغيل).
8. Run `APPROVED`/`POSTED` ما زال قابلاً للتعديل (تعديلات لاحقة على أسطره).
9. Run `POSTED` مرتبط بفترة مالية مغلقة/مقفلة بطريقة غير صحيحة.
10. مكوّن (سطر) بلا GL mapping/`gl_account_id`، أو حساب غير قابل للترحيل/نوع خاطئ.
11. `Payroll Payable` (دائن) ≠ صافي المستحق المطلوب من الأسطر.
12. `VOID` بلا قيد عكسي (`reversal_journal_entry_id`).
13. قيد عكسي غير مرتبط بالأصلي (`reverses_entry_id`/`source`).
14. أرقام مستندات مكرّرة (Run/Adjustment).
15. حالات/انتقالات غير منطقية (مثل POSTED بلا approved_at، أو CALCULATED بلا أسطر).
16. **(D3)** Run `APPROVED`/`POSTED` يحوي شخصاً بصافٍ سالب (يجب ألا يحدث).
17. **(D6)** شخص مشمول في أكثر من REGULAR غير ملغى لنفس الفترة (تداخل نطاق).
18. **(D6)** `scope_type='PERSON_LIST'` بلا أعضاء في `payroll_run_scope_members`، أو `DEPARTMENT`/`COST_CENTER` بلا `scope_ref_id`.
19. **(D11)** سلسلة إصدارات مكسورة (`supersedes_run_id`/`superseded_by_run_id` غير متطابقين، أو إصدار POSTED غير معكوس رغم وجود إصدار لاحق).
20. **(D2)** أكثر من عقد أساسي `ACTIVE` للشخص نفسه (خرق `uq_payroll_contracts_one_active`).
21. **(D14)** سطر/مكوّن بطريقة `CUSTOM_FORMULA` داخل Run `APPROVED`/`POSTED` (يجب أن يكون قد رُفض).

**strict (إضافةً لما سبق):** أي `warning` (مثل مكوّن صفري غير معروض، عقد على وشك الانتهاء) أو سجل يتيم (orphan: run_line بلا run_person، تخصيص لشخص محذوف منطقياً) أو `unexplained` (نشاط GL على حساب Payroll Payable من مصدر غير متوقع) → فشل.

---

## 12) تصميم واجهات البرمجة (API design) — سطح فقط، بلا تنفيذ

الجذر: `app/api/accounts/payroll/*`. كل مسار: `requireAccountsAccess` → `assertPayrollCapability` → (للكتابة) `withTransaction` + أقفال + `writeFinancialAudit` → `jsonSuccess/jsonError` + `mapPgError`. الأخطاء: 401 (بلا توكن)، 403 (بلا صلاحية/عضوية)، 404 (كيان غير موجود)، 409 (تزامن/حالة/تفرّد)، 400 (تحقق مدخلات).

| المورد | Method | Path | Permission | تحقق/أخطاء رئيسية |
|---|---|---|---|---|
| people | GET | `/payroll/people` | `payroll_view` | ترقيم/فلترة؛ تقليل الحقول (خصوصية) |
| people | POST | `/payroll/people` | `payroll_manage_people` | تفرّد code/national_id → 409 |
| people | GET/PATCH | `/payroll/people/[id]` | view / manage_people | 404؛ optimistic (409) |
| contracts | GET/POST | `/payroll/contracts` | view / manage_contracts | **عقد أساسي فعّال واحد لكل شخص** (409)؛ 400 تواريخ |
| contracts | POST | `/payroll/contracts/[id]/{activate,suspend,terminate}` | manage_contracts | حالة/عقد فعّال قائم (409)؛ optimistic |
| assignments (D2) | GET/POST | `/payroll/assignments` | view / manage_contracts | مرتبط بعقد أساسي (409/404)؛ تعدد مسموح؛ 400 تواريخ |
| assignments (D2) | POST | `/payroll/assignments/[id]/{activate,suspend,end}` | manage_contracts | حالة (409)؛ optimistic |
| components | GET/POST | `/payroll/components` | view / manage_components | تفرّد code (409) |
| components | GET/PATCH | `/payroll/components/[id]` | view / manage_components | 404؛ optimistic |
| assignments | GET/POST | `/payroll/assignments` | view / manage_components | تناسق الطريقة/القيمة (400)؛ تفرّد (409) |
| account-mappings | GET/POST | `/payroll/account-mappings` | payroll_admin | صحة GL (409)؛ تفرّد (409) |
| periods | GET/POST | `/payroll/periods` | view / payroll_admin | تفرّد fiscal_period (409) |
| periods | POST | `/payroll/periods/[id]/{close,reopen}` | payroll_admin | وجود Run غير نهائي (409) |
| runs | GET/POST | `/payroll/runs` | view / payroll_calculate | REGULAR مزدوج (409) |
| runs | GET | `/payroll/runs/[id]` | view | 404 |
| runs | POST | `/payroll/runs/[id]/calculate` | payroll_calculate | حالة (409)؛ صافي سالب (400/409)؛ optimistic |
| runs | POST | `/payroll/runs/[id]/review` | payroll_review | حالة (409) |
| runs | POST | `/payroll/runs/[id]/approve` | payroll_approve | حالة (409)؛ تجميد Snapshot |
| runs | POST | `/payroll/runs/[id]/post` | payroll_post | فترة OPEN، توازن، idempotent (created:false)؛ 409 |
| runs | POST | `/payroll/runs/[id]/void` | payroll_void | POSTED فقط؛ reason إلزامي؛ 409 |
| runs | POST | `/payroll/runs/[id]/cancel` | payroll_approve/admin | قبل الترحيل؛ 409 |
| adjustments | GET/POST | `/payroll/runs/[id]/adjustments` | payroll_calculate | حالة Run (409)؛ reason (400) |
| print | GET | `/payroll/runs/[id]/print` (+ per-person payslip) | view (+ خصوصية) | 403/404 |
| reports | GET | `/payroll/reports/*` | payroll_reports | فلاتر؛ خصوصية |

- **Idempotency/التزامن:** POST يعيد `created:false` عند إعادة الترحيل (idempotent)؛ كل تحوّل حالة يتطلب `version`+`updated_at`.

---

## 13) تصميم الواجهة (UI design)

الصفحات (بنمط `app/accounts/**` عربي RTL، `_lib.tsx`، `ConfirmDialog`, `StatusBadge`, صفحات طباعة منفصلة):
- `/accounts/payroll` — لوحة عامة (فترات/تشغيلات حديثة/إجماليات).
- `/accounts/payroll/people` + `/people/[id]` — الأشخاص وتفاصيلهم.
- `/accounts/payroll/contracts` — عقود التوظيف الأساسية (+ تكاليف التعويض/Assignments لكل عقد ضمن صفحة العقد/الشخص).
- `/accounts/payroll/components` — المكونات (الكتالوج).
- `/accounts/payroll/periods` — فترات الرواتب.
- `/accounts/payroll/runs` + `/runs/[id]` — التشغيلات وتفاصيلها.
- `/accounts/payroll/reports` — التقارير.
- (مكوّن تنقّل فرعي `PayrollNav.tsx` + استبدال صفحة `/accounts/payroll` الفارغة الحالية.)

**صفحة Payroll Run `/runs/[id]` تعرض:** الفترة، النوع، **النطاق (`scope_type`+المرجع)**، **رقم الإصدار وسلسلة الإصدارات (D11)**، الحالة، عدد الأشخاص، إجمالي الاستحقاقات، إجمالي الاستقطاعات، صافي المستحق، **تنبيه واضح لأي صافٍ سالب (D3)**، أزرار الانتقال (calculate/review/approve/post/void) حسب الصلاحية والحالة، تفاصيل كل شخص، تفاصيل المكونات لكل شخص، سجل الاعتماد (`payroll_approval_history`)، القيد المحاسبي المرتبط (رابط للـ JE)، والطباعة (كشف + قسيمة فردية).

---

## 14) خطة الاختبار (Test plan)

`src/scripts/test-payroll.ts` (نمط tsx، ≥ 70 تأكيداً) يغطّي:
1. CRUD للأشخاص/العقود/التكاليف/المكونات/التخصيصات/الخرائط مع الصلاحيات.
2. العقود: **عقد أساسي فعّال واحد لكل شخص** (رفض الثاني 409)، عقد مفتوح، إيقاف/إنهاء؛ **التكاليف (Assignments): تعدّد مسموح فوق العقد** (D2) مع effective dating (D13).
3. المكونات وطرق الاحتساب السبع (قيم متوقعة دقيقة بالمِلّي) + رفض `CUSTOM_FORMULA` (D14).
4. التقريب/الاقتطاع وفروق التقريب (توازن مضمون).
5. إعادة الحساب (Recalculate) قبل REVIEWED؛ ومنعها بعده.
6. Snapshot: ثبات القيم بعد APPROVED رغم تغيّر العقد/المكوّن.
7. Workflow الكامل والانتقالات الممنوعة (409) + **صافي سالب: يُسمح في CALCULATED، Warning في REVIEWED، يُمنع في APPROVED/POSTED** (D3).
7.1. **النطاق (D6):** ALL/DEPARTMENT/COST_CENTER/PERSON_LIST؛ منع REGULAR مزدوج؛ حارس التداخل الجزئي على مستوى الشخص.
7.2. **الإصدارات (D11):** V1→VOID→V2(CORRECTION)→V3 مع صحة `root/supersedes/superseded_by` والقيود/العكوس.
7.3. **Effective Dating (D13):** اختيار الصف الساري عند التاريخ المرجعي؛ تغيير مستقبلي لا يؤثر على تشغيل حالي.
8. الصلاحيات/Least Privilege/SoD + IDOR (403).
9. Double Calculate / Double Approve / Double Post (منع).
10. Locks والتزامن المتفائل (version/updated_at → 409).
11. Fault injection (تراجع كامل عبر خطاف اختبار على غرار supplier-payments).
12. القيد المحاسبي: توازن، تجميع، `source_type/source_id`، عدم الترحيل المزدوج.
13. Reversal عند VOID وربطه بالأصلي.
14. Verify normal/strict ينجحان بعد البذر والاختبارات.
15. Seed idempotency.
16. **Regression:** `test:cash-vouchers`, `test:bank-vouchers`, `test:supplier-payables`, `test:supplier-payments-expenses`, `test:purchasing`, `test:fixed-assets` تبقى خضراء.

---

## 15) خطة البذر (Seed plan)

`src/scripts/seed-accounts-payroll-demo.ts` — Idempotent (محروس بأكواد `DEMO-PR-*`)، لا يمسّ بيانات حقيقية، موصول من `seed:accounts-demo`. يبذر:
- أشخاص DEMO لكل فئة: تدريسي، محاضر خارجي، موظف، عامل أجور يومية، عامل خدمات.
- **عقد توظيف أساسي واحد فعّال** لكل شخص (شهري ثابت/بالمحاضرة/يومي/مقطوع/مفتوح ومحدّد) + **تكاليف Assignments** نموذجية (بدل رئاسة قسم، عضوية لجنة، محاضرات إضافية).
- مكونات استحقاق واستقطاع أساسية + تخصيصاتها (بعضها مرتبط بتكليف) + account mappings على حسابات GL موجودة (أو حسابات DEMO).
- **تقويم `MONTHLY` افتراضي** (D12) + فترة رواتب DEMO مرتبطة بفترة مالية مفتوحة.
- Run تجريبي `REGULAR` بنطاق `ALL` (`revision_number=1`) قابل للحساب (DRAFT → CALCULATED) لعرض النتائج.

---

## 16) النطاق المؤجَّل (Deferred scope)

**لا يدخل في 9.A** (ينتقل إلى 9.B/9.C/9.D):
- الحضور التفصيلي وأجهزة البصمة، ساعات المحاضرين الفعلية، الأجور اليومية الفعلية (→ 9.B).
- استيراد Excel للكميات/الأشخاص (→ 9.B).
- السلف والقروض وأقساطها (→ 9.B).
- الدفع من البنك/الصندوق وملفات التحويل المصرفي (→ 9.C).
- الضرائب الحكومية المتقدمة والتقاعد/الضمان المتقدم والتسويات السنوية (→ 9.D).
- Payroll Closing المتقدم وبوابة الموظف/قسيمة الراتب الذاتية (→ 9.D).
- تعدد العملات، طرق إهلاك/حساب متقدمة، حدود دنيا/عليا معقّدة.

---

## 17) ترقيم الهجرات المقترح (بعد آخر Migration فعلي = 093)

| الهجرة | المحتوى |
|---|---|
| `094_payroll_foundation.sql` | `payroll_people`, `payroll_contracts` (عقد أساسي واحد فعّال)، **`payroll_assignments`** (تكاليف التعويض)، `payroll_components` (+ `CUSTOM_FORMULA` محجوزة)، `payroll_component_assignments` (+ `payroll_assignment_id`)، `payroll_account_mappings`، **`payroll_calendars`** (بنية محجوزة + تقويم MONTHLY) + أنواع تسلسل `PAYROLL_RUN(PAY)`, `PAYROLL_ADJUSTMENT(PAJ)` في `document_sequence_types` وبذر `document_sequences` لكل سنة مالية. |
| `095_payroll_periods_runs.sql` | `payroll_periods` (+ `calendar_type`/`payroll_calendar_id`)، `payroll_runs` (+ حقول النطاق D6 والإصدار D11)، **`payroll_run_scope_members`**، `payroll_run_people`, `payroll_run_lines`, `payroll_run_adjustments`, `payroll_approval_history` + الفهارس والقيود. |

> **ترقيم الهجرات لم يتغيّر** (لا يزال 094 و095)؛ التعديلات وسّعت **محتوى** الهجرتين فقط بإضافة جداول/أعمدة، دون هجرات إضافية.
> (احتياطي `096_payroll_hardening.sql` لأي قيود/فهارس تحسينية إن لزم، على غرار `086`.)

---

## 18) الـ Commits المقترحة للتنفيذ (بعد الاعتماد)

بنفس نمط 8.A (commits انتقائية لملفات الحسابات فقط، بلا push، بلا ملفات خارج الحسابات):
1. `feat(accounts): payroll foundation schema + sequences 9A` (هجرة 094 + calendars/assignments + locks/sequences/access/audit hooks).
2. `feat(accounts): payroll people, contracts, assignments, components services 9A` (عقد أساسي واحد + تكاليف التعويض + effective dating).
3. `feat(accounts): payroll periods, runs (scope+revision), calculation engine 9A` (هجرة 095 + snapshot + calculate + negative-net gating).
4. `feat(accounts): payroll posting + reversal accounting 9A` (post/void + JE).
5. `feat(accounts): payroll APIs 9A`.
6. `feat(accounts): payroll UI + reports + print 9A`.
7. `test(accounts): payroll verify + acceptance tests + seed 9A`.
8. `docs(accounts): finalize payroll 9A documentation`.

---

## 19) قرارات تحتاج اعتمادكم (D1–D14)

| # | القرار | التوصية |
|---|---|---|
| D1 | حدود 9.A: هل تنتهي عند `POSTED` وتكوين Payroll Payable، والدفع إلى 9.C؟ | **نعم** (كما طلبتم). لا واجهة دفع في 9.A. |
| D2 | العقود مقابل التكاليف (Contracts vs Assignments) | **عقد توظيف أساسي واحد فعّال لكل شخص** (لكل الفئات، مفروض بفهرس فريد `WHERE status='ACTIVE'`) + **عدد غير محدود من `payroll_assignments`** (مهام/مسؤوليات/بدلات/محاضرات/لجان) فوق العقد. رئاسة/مقرر قسم/لجنة/محاضرات إضافية = تكاليف لا عقود. |
| D3 | سياسة صافي الراتب السالب (متدرّجة) | يُسمح في `CALCULATED`، **Warning** في `REVIEWED`، **يُمنع** في `APPROVED` و`POSTED`. |
| D4 | نقطة تجميد Snapshot | التقاط عند `CALCULATE`، **تجميد نهائي عند `APPROVED`** (إعادة الحساب مسموحة حتى REVIEWED). |
| D5 | هوية الشخص | `payroll_people` مستقل + `hr_person_id UUID NULL` **بلا FK** + `user_id` (FK اختياري لـ users). موافقة على عدم الربط الصلب بـ HR. |
| D6 | نطاق الرواتب + تعدد Runs | مفهوم **Payroll Scope** مستقل عن Person Type: `ALL/COLLEGE/DEPARTMENT/COST_CENTER/PERSON_LIST` (Enum + `scope_ref_id`؛ جدول `payroll_run_scope_members` لـ PERSON_LIST فقط). REGULAR واحد لكل (فترة+نطاق) + حارس على مستوى الشخص يمنع التداخل الجزئي. |
| D7 | إلزام مركز الكلفة على مصروف الرواتب | إلزامي إذا كان حساب المصروف `requires_cost_center=true` (نتبع سياسة النظام الحالية)؛ مركز الكلفة يُشتق من القسم/العقد/التكليف. |
| D8 | حساب فروقات تقريب الرواتب | إنشاء mapping `ROUNDING` مخصّص لاستيعاب فروق النِّسَب الفلسية (موصى به). |
| D9 | كتالوج المكونات | بذر كتالوج أساسي (الأكواد المذكورة) **قابل للتوسعة** من الواجهة، لا مغلق. |
| D10 | الأدوار | إعادة استخدام الأدوار الأربعة (viewer/clerk/approver/admin) مع SoD: CLERK=إدخال+حساب، APPROVER=مراجعة+اعتماد+ترحيل، ADMIN=إبطال. التوصية: **الفصل هو الأصل، واستثناء `accounts_admin` عند الضرورة مع Audit وسبب**. |
| D11 | إصدارات كشف الرواتب (Versioning/Revision) | دعم `revision_number` + `root_run_id`/`supersedes_run_id`/`superseded_by_run_id` منذ البداية؛ سلسلة `V1→VOID→V2→CORRECTION→V3`؛ كل إصدار بقيده وعكسه، مربوط بالـ Audit. |
| D12 | تقويم الرواتب (Payroll Calendar) | **حجز البنية فقط** (`payroll_calendars` + `calendar_type`)، بذر تقويم `MONTHLY`؛ التنفيذ الآلي للجدولة يؤجَّل إلى 9.B/9.D. |
| D13 | التأريخ الفعّال (Effective Dating) | `effective_from/to` على العقد والتكليف والمكوّن والتخصيص والخريطة؛ الاحتساب يختار الصف الساري عند التاريخ المرجعي للتشغيل (لا `created_at`). |
| D14 | خارطة طريق محرك الصيغ | إضافة `CUSTOM_FORMULA` إلى enum **محجوزة وغير منفَّذة في 9.A** (المحرك يرفضها)؛ لا صيغ نصية/eval الآن. |

---

## 20) البنية المستقبلية المحجوزة — Payroll Batch (Reserved Future Architecture)

**الغرض:** توثيق أن التصميم الحالي **لا يمنع** إضافة مستوى أعلى من `Payroll Run` مستقبلاً يُسمّى **`Payroll Batch`**، **دون كسر البنية**. لا يُنشأ الآن أي جدول أو API أو Migration أو عمود لهذا الغرض — هذا **حجز مفاهيمي فقط**.

- **المفهوم:** `Payroll Batch` سيكون حاوية تجميعية أعلى من `Payroll Run` تربط عدة تشغيلات (مثلاً: كل تشغيلات فترة واحدة عبر نطاقات/تقويمات متعددة — شهري + محاضرين + يومي) تحت عملية اعتماد/ترحيل/تقرير موحّدة، مع الإبقاء على استقلالية كل `Run` وقيده المحاسبي المنفصل.
- **لماذا التصميم الحالي يسمح به دون كسر؟**
  - `payroll_runs` كيان مستقل بذاته (رقم/حالة/قيد/`source_id` فريد)، فإضافة أب `payroll_batch_id UUID NULL` مستقبلاً = **عمود اختياري (nullable) غير هدّام**، لا يؤثر على التشغيلات القائمة (تبقى `batch_id = NULL`).
  - كل التجميع المحاسبي يتم على مستوى `Run` (قيد لكل Run)، فالـ Batch سيكون طبقة تنظيمية/تقريرية فوقها دون تغيير سياسة القيد الواحد لكل Run.
  - سلسلة الإصدارات (D11)، النطاق (D6)، والتقويم (D12) كلها على مستوى `Run` وتتعايش مع Batch دون تعارض.
  - مفاتيح التفرّد والأقفال الحالية مبنية على `Run`/الفترة/النطاق، فإضافة Batch لا يخرق أياً منها.
- **ما يؤجَّل بالكامل:** جدول `payroll_batches`، حالات/انتقالات الـ Batch، اعتماد/ترحيل جماعي، تقارير الـ Batch، وأي API/UI — كلها **خارج 9.A** وتُصمَّم عند الحاجة الفعلية.

---

## 21) مبدأ معماري رسمي — Zero Hardcoded Payroll Logic

**مبدأ إلزامي** يحكم كل تنفيذ لوحدة الرواتب (9.A وما بعدها):

- **لا** قواعد رواتب مبنية على `if/else` مرتبطة **بأنواع الأشخاص** (لا `if (person_type === 'EXTERNAL_LECTURER') …`).
- **لا** اعتماد على **أسماء/أكواد المكونات داخل الكود** (لا `if (component.code === 'BASIC_SALARY') …` كمنطق حساب).
- **كل السلوك يأتي حصراً من البيانات القابلة للتهيئة:**
  - **Configuration** (إعدادات/سياسات مخزَّنة).
  - **Components** (كتالوج المكونات + خصائصها: النوع/طريقة الحساب/الخاضعية…).
  - **Assignments** (التكاليف ومصادرها).
  - **Account Mappings** (خرائط الحسابات ومراكز الكلفة).
  - **Calculation Methods** (تعداد ثابت محدود المدخلات — بلا صيغ نصية/eval).
  - **Effective Dating** (اختيار الصف الساري زمنياً).
- **القاعدة الحاكمة:** لا يُسمح بإدخال أي منطق خاص بفئة معيّنة داخل الكود **إلا إذا كان معرّفاً كسياسة قابلة للتهيئة** (Policy مخزَّنة في البيانات، لا شرط مكتوب في الكود). أي سلوك فئوي = بيانات (Component/Assignment/Mapping/Method/Config)، لا فرع برمجي.
- **أثر المبدأ:** محرك الاحتساب Deterministic ومقوده البيانات (data-driven)؛ إضافة فئة/بدل/استقطاع جديد لا يتطلب تعديل كود؛ Verify يمكنه فحص الاتساق من البيانات وحدها؛ يقلّل الـ Dead Code والفروع الخاصة.

---

## 🔒 Architecture Frozen

**تم تجميد المعمارية (Architecture Frozen)** لخطة 9.A اعتباراً من هذه النسخة، بعد اعتماد الاتجاه العام والتعديلات D2/D3/D6 والقرارات D11–D14 وإضافة مبدأي §20 (Reserved Payroll Batch) و§21 (Zero Hardcoded Payroll Logic).

- لا يوجد أي تغيير معماري مفتوح.
- أي تعديل معماري لاحق يتطلب **Unfreeze** صريحاً وموثّقاً.
- الوثيقة جاهزة للانتقال إلى **9.A.1** (بدء التنفيذ) بعد إشارتكم.

---

*نهاية خطة 9.A.0 — تصميم فقط (Architecture Frozen). محدّثة بالتعديلات D2/D3/D6، القرارات D11–D14، ومبدأي Reserved Payroll Batch وZero Hardcoded Payroll Logic. جاهزة لـ 9.A.1.*
