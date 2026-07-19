# Payroll 9.A.2.1 — Periods, Runs, Scope & Access (Implementation)

المرجع المعماري الملزم: `docs/payroll-9a2-architecture-plan.md` (Architecture Ready for Implementation).
نقطة الانطلاق: `6a76453` — `fix(accounts): harden payroll foundation acceptance 9A1`.

## 1. النطاق (Scope)

طبقة تنظيمية فقط: الفترات، التشغيلات، النطاق، الصلاحيات، التسلسلات، الأقفال، التدقيق، البذرة، التحقق، الاختبارات.
**لا** محرك احتساب، **لا** لقطات/تجزئة، **لا** `payroll_run_people`/`payroll_run_lines`/`payroll_run_issues`،
**لا** اعتماد/ترحيل/دفعات، **لا** حضور/ساعات محاضرين، **لا** `VOID`، **لا** `CUSTOM_FORMULA`، **لا** تنفيذ فعلي للاحتساب.

المؤجَّل:
- **9.A.2.2**: جداول الاحتساب التفصيلية (Migration 096) — `payroll_run_people` / `payroll_run_lines` / `payroll_run_issues`.
- **9.A.2.3**: محرك الاحتساب + Snapshot/Hash + تجميد النطاق عند Calculate + فحص Blocking Issues عند إغلاق الفترة.

## 2. Migration 095 — `db/migrations/095_payroll_periods_runs.sql`

يتضمّن فقط طبقة 9.A.2.1 (بلا جداول احتساب):

1. أنواع تسلسل المستندات: `PAYROLL_PERIOD` (بادئة `PYPR`)، `PAYROLL_RUN` (بادئة `PYR`) — وتسجيلها لكل سنة مالية. `PAYROLL_ADJUSTMENT` مؤجّلة.
2. عمود `calculation_base_type` على `accounts.payroll_components`.
3. جدول `accounts.payroll_periods`.
4. جدول `accounts.payroll_runs`.
5. جدول `accounts.payroll_run_scope_members`.
6. الفهارس والقيود وقيود المفاتيح الأجنبية لهذه الطبقة.

لا تعديل على `094_payroll_foundation.sql` (مُثبَت بفحص `git diff 6a76453 -- db/migrations/094_payroll_foundation.sql` = فارغ).

## 3. الأعمدة المضافة إلى `payroll_components`

`calculation_base_type VARCHAR(25) NOT NULL DEFAULT 'NONE'` مع
`CHECK (calculation_base_type IN ('NONE','CONTRACT_BASIC','GROSS_EARNINGS','SELECTED_COMPONENTS','COMPONENT_REFERENCE'))`.

- المنفّذ في 9.A.2.1: `NONE`, `CONTRACT_BASIC` فقط.
- المحجوز (يُرفض خدمياً): `GROSS_EARNINGS`, `SELECTED_COMPONENTS`, `COMPONENT_REFERENCE`.
- قواعد التحقق (`payrollCalculationBaseType`):
  - `PERCENTAGE_OF_BASIC` يتطلب `CONTRACT_BASIC`.
  - بقية الطرق تُلزم بـ `NONE` (لا اعتماد على `CONTRACT_BASIC` في هذه المرحلة).
  - `CUSTOM_FORMULA` تبقى محجوزة ومرفوضة.
- بلا `base_component_id` وبلا جدول اعتماديات الآن.
- APIs/UI للمكوّنات تعرض القيمتين المنفّذتين فقط (`NONE`, `CONTRACT_BASIC`).

## 4. الجداول الجديدة

### `accounts.payroll_periods`
`id` (UUID PK)، `period_code` (فريد، `PYPR-YYYY-######`)، `payroll_calendar_id` (FK RESTRICT)، `name_ar`، `name_en?`،
`start_date`، `end_date`، `calculation_date`، `payment_due_date?`، `status` (`OPEN`/`PROCESSING`/`CLOSED`/`CANCELLED`)،
`currency_code`، `fiscal_year_id` (FK RESTRICT، إلزامي)، `fiscal_period_id?` (FK RESTRICT)، `transition_reason?`،
أختام الحياة `opened_at/by`، `closed_at/by`، `cancelled_at/by`، `reopened_at/by`، `version` (DEFAULT 1)، حقول التدقيق.

### `accounts.payroll_runs`
`id` (UUID PK)، `run_number` (فريد، `PYR-YYYY-######`)، `payroll_period_id` (FK RESTRICT)، `payroll_calendar_id` (FK RESTRICT)،
`run_type` (`REGULAR`/`CORRECTION`/`SUPPLEMENTAL`/`TERMINATION`/`MANUAL`)، `scope_type` (`ALL`/`COLLEGE`/`DEPARTMENT`/`COST_CENTER`/`PERSON_LIST`)،
`scope_ref_id?`، `status` (`DRAFT`/`CALCULATING`/`CALCULATED`/`CANCELLED` — لا `VOID`)، `currency_code`، `calculation_date`،
سلسلة الإصدارات (محجوزة): `revision_number` (DEFAULT 1)، `root_run_id?`، `supersedes_run_id?`، `superseded_by_run_id?`، `revision_reason?`،
إجماليات صفرية: `people_count`, `gross_total`, `deduction_total`, `employer_contribution_total`, `net_total`, `warning_count`, `error_count`, `snapshot_hash?`،
Idempotency محجوزة: `calculation_request_id?`, `last_calculation_request_id?`, `calculation_attempt_number` (DEFAULT 0)،
أختام: `calculated_at/by`, `cancelled_at/by`, `cancellation_reason?`، `version` (DEFAULT 1)، حقول التدقيق.

### `accounts.payroll_run_scope_members`
`id` (UUID PK)، `payroll_run_id` (FK **CASCADE** — سجلّ تابع تماماً)، `payroll_person_id` (FK RESTRICT)، `created_by`، `created_at`.

## 5. القيود والفهارس

**Periods**: `uq_payroll_periods_code`؛ `ck_payroll_periods_dates` (`end>=start`)، `ck_payroll_periods_calcdate` (`calc>=start`)،
`ck_payroll_periods_due` (`due IS NULL OR due>=end`)، `ck_payroll_periods_version` (`version>=1`).
فهارس: `idx_payroll_periods_calendar`, `_status`, `_range` (calendar/start/end/status لخدمة حارس التداخل)، `_fiscal_year`.

**Runs**: `uq_payroll_runs_number`؛ `ck_payroll_runs_totals_nonneg`، `ck_payroll_runs_revision` (`>=1`)،
`ck_payroll_runs_attempt` (`>=0`)، `ck_payroll_runs_version` (`>=1`)، `ck_payroll_runs_scope_ref` (شكل النطاق)،
`ck_payroll_runs_supersedes_self` / `ck_payroll_runs_superseded_self` (منع الإشارة الذاتية).
فهرس فريد جزئي: `uq_payroll_runs_one_live_regular` — تشغيل REGULAR حيّ واحد لكل (فترة + توقيع نطاق) عبر `COALESCE(scope_ref_id, ZERO_UUID)` حيث `status IN ('DRAFT','CALCULATING','CALCULATED')`.
فهارس: `_period`, `_calendar`, `_status`, `_type`.

**Scope members**: `uq_run_scope_member (payroll_run_id, payroll_person_id)`؛ فهرسان على الـ run والـ person.

## 6. دورة الحياة (Lifecycle)

### الفترة
- **Create** → `OPEN` (`opened_at/by`). التقويم فعّال وساري عند البداية؛ العملة تطابق التقويم؛ السنة المالية إلزامية غير مغلقة؛ منع التداخل.
- **Update** → فقط وهي `OPEN`؛ الحقول الحسّاسة (التقويم/التواريخ/العملة/السنة/الفترة المالية) تُمنع بوجود تشغيلات غير ملغاة، مع إعادة فحص التداخل تحت قفل التقويم.
- **Close** → يتطلب: لا `CALCULATING`، لا `DRAFT` غير ملغى؛ يضبط `CLOSED` + `closed_at/by`. (فحص Blocking Issues مؤجَّل إلى 9.A.2.3.)
- **Reopen** → `accounts_admin` فقط، سبب إلزامي، تدقيق؛ `CLOSED → OPEN`.
- **Cancel** → سبب إلزامي؛ يُمنع مع `CALCULATING`؛ سياسة 9.A.2.1: ألغِ كل التشغيلات غير الملغاة أولاً؛ نهائية.

### التشغيل
- **Create** → `DRAFT` (فقط ضمن فترة `OPEN`)؛ يرث التقويم/العملة/تاريخ الاحتساب من الفترة؛ منع التكرار الحيّ المكافئ.
- **Update** → فقط وهو `DRAFT` (النوع/النطاق/المرجع)؛ يُرفض تغيير النطاق بعيداً عن `PERSON_LIST` مع وجود أعضاء؛ إعادة فحص التكرار.
- **Cancel** → `accounts_admin` فقط، سبب إلزامي؛ من `DRAFT` أو `CALCULATED`؛ يُمنع أثناء `CALCULATING`.

### أعضاء النطاق (PERSON_LIST فقط)
`add` / `remove` / `replace` — فقط والتشغيل `DRAFT` ونطاقه `PERSON_LIST`؛ الشخص `ACTIVE`؛ كل عملية ترفع `version` التشغيل (تزامن متفائل). لا تجميد نهائي هنا (يقع عند Calculate في 9.A.2.3).

## 7. منع التداخل والتكرار

- **تداخل الفترات**: حارس خدمي `assertNoOverlap` تحت قفل `PAYROLL_CALENDAR` (بلا `btree_gist`، بلا `CREATE EXTENSION`)، للحالات `OPEN`/`PROCESSING`/`CLOSED`. `CANCELLED` لا تمنع. أكثر من `OPEN` غير متداخل مسموح (تحذير في strict).
- **تكرار التشغيل الحيّ**: حارس خدمي `assertNoDuplicateActiveRun` تحت قفل `PAYROLL_PERIOD` لكل الأنواع + فهرس REGULAR الجزئي كخط دفاع أخير ضد السباق. الحماية النهائية «شخص واحد لكل فترة» مؤجّلة إلى 096 مع `payroll_run_people`.

## 8. APIs

Periods: `GET/POST /periods`، `GET/PATCH /periods/[id]`، `POST /periods/[id]/{close,reopen,cancel}`.
Runs: `GET/POST /runs`، `GET/PATCH /runs/[id]`، `POST /runs/[id]/cancel`.
Scope: `GET/POST/PUT /runs/[id]/scope-members`، `DELETE /runs/[id]/scope-members/[personId]`.
كلها: Pagination/Filters، فحص القدرات، `version` في PATCH/الانتقالات/الاستبدال، حماية IDOR، `mapPgError` لتنظيف الأخطاء، سبب إلزامي في `cancel`/`reopen`، لا حذف فعلي، لا endpoint احتساب.
تحديث `options` لإضافة `fiscal_years`/`fiscal_periods`/`active_people` و enums الجديدة و `calculation_base_type` (المنفّذ فقط).

## 9. UI

`/accounts/payroll/periods` (قائمة + إنشاء)، `/accounts/payroll/periods/[id]` (تفاصيل + دورة حياة)،
`/accounts/payroll/runs` (قائمة)، `/accounts/payroll/runs/new` (إنشاء)، `/accounts/payroll/runs/[id]` (تفاصيل + نطاق + إلغاء).
التشغيل يعرض إجماليات صفرية مع رسالة: «محرك الاحتساب سيُفعّل في المرحلة التالية». الأزرار: Edit/Manage Scope/Cancel (لا Calculate/Approve/Post/Pay). إخفاء حسب الصلاحية، `ConfirmDialog` بسبب إلزامي، عربية أساساً. تحديث UI المكوّنات لإظهار أساس الاحتساب المنفّذ فقط.

## 10. الصلاحيات (Capabilities)

الجديدة في `payroll-access.ts`: `payroll_view_runs`, `payroll_manage_periods`, `payroll_create_runs`, `payroll_calculate` (محجوزة، بلا endpoint)، `payroll_cancel_runs`.
التوزيع:
- `accounts_viewer` → `view` + `view_runs`.
- `accounts_clerk` → عرض + إدارة الأشخاص/العقود/التكليفات + `manage_periods` + `create_runs`.
- `accounts_approver` → عرض + `view_runs`.
- `accounts_admin` → الكل (+ `calculate` + `cancel_runs` + `admin`).
- العضوية المجرّدة → VIEW_ONLY (`view` + `view_runs`). لا cancel لغير admin، لا calculate لـ clerk.

## 11. الأقفال (Locks)

الجديدة: `PAYROLL_CALENDAR`, `PAYROLL_PERIOD`, `PAYROLL_RUN`.
الترتيب الحتمي الموحّد:
`Calendar → Period → Run → Person → Contract → Assignment → Component → Component Assignment → Mapping`.
سيناريوهات ممنوعة ومختبَرة: فترتان متداخلتان متزامناً، تعديل/إغلاق فترة أثناء إنشاء Run، إلغاء Run أثناء تحديث النطاق، تعديل نطاق من طلبين متزامنين، إنشاء Runين متطابقين متزامناً.

## 12. التدقيق (Audit)

`accounts.financial_audit_log` عبر `writeFinancialAudit` داخل المعاملة:
- Period: `created`, `updated`, `closed`, `reopened`, `cancelled`.
- Run: `created`, `updated`, `cancelled`.
- Scope: `scope_member_added`, `scope_member_removed`, `scope_members_replaced`.
يتضمّن actor/entity/before-after وسبب الأفعال الحساسة، بلا request body خام وبلا بيانات حساسة.

## 13. البذرة (Seed DEMO)

`npm run seed:accounts-payroll-periods-demo` (يعتمد على `seed:accounts-payroll-demo`):
سنة مالية DEMO (`DEMO-FY-2025`, ACTIVE)، فترة DEMO شهرية (`DEMO-MONTHLY`)، فترة محاضرين DEMO (`DEMO-LECTURER`)،
Run DRAFT بنطاق `ALL`، Run DRAFT بنطاق `PERSON_LIST` + أعضاء من أشخاص DEMO. لا `run_people`/`lines`/`issues`/مخرجات احتساب.
Idempotent (تشغيل مرتين بلا تكرار)، لا يلمس بيانات غير DEMO، لا يربط عشوائياً بتقويم/سنة حقيقية.

## 14. التحقق (Verify)

`npm run accounts:verify-payroll-periods-runs` و `:strict` (`src/lib/accounts/verify-payroll-periods-runs.ts`).
Periods: تداخل، تواريخ، `version<1`، عملة مخالفة للتقويم، سنة/فترة مالية يتيمة أو غير متطابقة، تكرار الكود، CLOSED مع DRAFT/CALCULATING، CANCELLED مع CALCULATING.
Runs: عدم تطابق التقويم/العملة/تاريخ الاحتساب، حالة/version/revision/attempt غير صالح، تكرار الرقم، روابط إصدار ذاتية، سلسلة إصدار مخالفة، تشغيلات حيّة مكافئة مكرّرة، CANCELLED بلا سبب، PERSON_LIST بلا أعضاء (تحذير)، عضو نطاق لغير PERSON_LIST، شكل مرجع النطاق، أعضاء يتامى، تسلسلات مفقودة (تحذير).
strict: أكثر من OPEN لنفس التقويم؛ حقول احتساب غير صفرية في DRAFT؛ وجود calculation_request/محاولات قبل تفعيل المحرك.

## 15. الاختبارات

`npm run test:payroll-periods-runs` — **44 حالة ناجحة / 0 فاشلة**.
تغطّي: الترحيل (base_type default/CHECK/رفض المحجوز/version)، الفترات (إنشاء/تداخل عادي ومتزامن/CANCELLED لا تمنع/multi-OPEN/تعديل/إغلاق/إعادة فتح/إلغاء/تزامن متفائل)،
التشغيلات (كل الأنواع/قواعد النطاق/منع التكرار الحيّ عادي ومتزامن/فترة غير OPEN/تعديل DRAFT فقط/إلغاء بسبب+تزامن/supersedes ذاتي)،
أعضاء النطاق (add/remove/replace/تكرار/غير فعّال/غير PERSON_LIST/غير DRAFT/تزامن متفائل)،
التسلسلات (ترقيم متزامن بلا تكرار للفترات والتشغيلات)، الصلاحيات (viewer/clerk/approver/bare/admin)، التدقيق، البذرة، التحقق عادي/صارم، وانحدار 9.A.1.

انحدار 9.A.1: `npm run test:payroll-foundation` — **61 حالة ناجحة / 0 فاشلة** (بعد تحديث حالتين لتواكب قاعدة `PERCENTAGE_OF_BASIC ⇒ CONTRACT_BASIC` وتوسّع VIEW_ONLY ليشمل `view_runs`).

## 16. الملفات المتغيّرة

Migration: `db/migrations/095_payroll_periods_runs.sql`.
مكتبة الخدمات: `payroll-periods.ts`, `payroll-runs.ts`, `payroll-run-scope.ts`, `verify-payroll-periods-runs.ts`؛
تحديث: `payroll-validation.ts`, `payroll-access.ts`, `payroll-locks.ts`, `accounting-locks.ts`, `document-sequences.ts`, `audit.ts`, `auth.ts`, `payroll-components.ts`.
APIs: `app/api/accounts/payroll/periods/**`, `.../runs/**`, تحديث `.../options/route.ts`.
UI: `app/accounts/payroll/periods/**`, `.../runs/**`, `_lib.tsx`, `PayrollNav.tsx`, تحديث `components/page.tsx`.
Scripts: `seed-accounts-payroll-periods-demo.ts`, `verify-payroll-periods-runs.ts`, `test-payroll-periods-runs.ts`؛ تحديث `seed-accounts-payroll-demo.ts`, `test-payroll-foundation.ts`, `package.json`.
Docs: هذا الملف.

## 17. الأوامر والنتائج

- Migration validation: 095 مطبّقة ومسجّلة في `platform.schema_migrations`؛ الجداول والعمود موجودة.
- `test:payroll-periods-runs`: 44/44 ناجح.
- `test:payroll-foundation` (انحدار): 61/61 ناجح.
- `accounts:verify-payroll-periods-runs` (عادي/صارم): ok=true، 0 mismatches/warnings/unexplained.
- Seed مرتين: idempotent (التشغيل الثاني بلا تغييرات).
- `tsc --noEmit`: نجاح.
- ESLint على ملفات Payroll: نظيف (0 errors).
- `npm run build`: نجاح.
- `git diff 6a76453 -- db/migrations/094_payroll_foundation.sql`: فارغ (بلا تعديل على 094).

## 18. القيود المعروفة / المؤجَّل

- «شخص واحد لكل فترة» النهائي يتطلب `payroll_run_people` (096/9.A.2.2).
- فحص Blocking Issues عند إغلاق الفترة يتطلب `payroll_run_issues` (9.A.2.3).
- سلسلة الإصدارات (`root/supersedes/superseded_by`) وحقول Idempotency والاحتساب موجودة كبنية محجوزة بقيم صفرية، تُفعّل مع المحرك.
- `PROCESSING` كحالة فترة موجودة في المخطط لكنها لا تُضبط تلقائياً في 9.A.2.1 (تُدار عند الاحتساب لاحقاً).
- `calculation_base_type` المحجوز الثلاثي و `CUSTOM_FORMULA` مرفوضة خدمياً حتى تُفعّل.
