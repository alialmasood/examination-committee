# Payroll 9.A.2.2 — Calculation Snapshot Schema

**الحالة:** جاهز لـ Acceptance Review
**Baseline السابق:** `7673aed` (9.A.2.1 Accepted)
**المرجع الملزم:** `docs/payroll-9a2-architecture-plan.md`
**النطاق:** مخطط بيانات لقطة الاحتساب فقط — **بلا محرك Calculate/Recalculate**.

---

## 1. Scope

### مسموح
- Migration `096_payroll_run_calculation.sql`
- جداول: `payroll_run_people` · `payroll_run_lines` · `payroll_run_issues`
- Hash/canonicalize helpers
- خدمات داخلية Persist/Validate داخل Transaction
- Verify normal/strict
- Tests + cleanup بملكية اختبار
- هذا التوثيق

### ممنوع (مؤجّل)
- Calculate / Recalculate endpoints أو محرك
- Scope Resolution النهائي
- إنشاء Lines تلقائيًا
- تغيير Run إلى `CALCULATING` / `CALCULATED` بواسطة محرك
- Formula Engine / تنفيذ `CUSTOM_FORMULA`
- Attendance / Lecturer Hours
- Approval / Posting / Journal / Payments
- تعديل Migrations `094` أو `095`
- بدء 9.A.2.3
- Push

---

## 2. Migration 096

الملف: `db/migrations/096_payroll_run_calculation.sql`

لا يلمس `094` ولا `095`. أي تغيير لاحق على اللقطة عبر Migration `097+`.

---

## 3. الجداول

### 3.1 `accounts.payroll_run_people`

لقطة الشخص داخل التشغيل.

| حقل | ملاحظات |
|-----|---------|
| `payroll_contract_id` | **NULL مسموح** (وفق المعمارية المجمدة) — غياب العقد ⇒ ERROR لاحقًا عند المحرك |
| `payroll_period_id` | مُنزَّل من الـ Run لحارس الشخص (D16) |
| `calculation_status` | `PENDING` \| `CALCULATED` \| `ERROR` \| `EXCLUDED` (**ليست** `SKIPPED`) |
| `net_amount` | قد يكون سالبًا |
| `gross/deductions/basic/employer_*` | ≥ 0 |
| `snapshot_json` / `snapshot_hash` | JSONB + SHA-256 hex بطول 64 (**NOT NULL**) |
| `superseded` | يحرّر حارس الفترة عند إلغاء Run (مستقبلًا) |

**قيود فريدة:**
- `UNIQUE (payroll_run_id, payroll_person_id)`
- فهرس جزئي حيّ: `(payroll_period_id, payroll_person_id) WHERE superseded = FALSE`

### 3.2 `accounts.payroll_run_lines`

سطر مكوّن لكل شخص تشغيل.

| حقل | قيم |
|-----|-----|
| `line_source` | `GENERATED` \| `MANUAL_OVERRIDE` |
| `quantity_source` | `MANUAL` \| `ASSIGNMENT` (منفّذان معماريًا) + محجوز: `IMPORTED` \| `ATTENDANCE` \| `LECTURE_HOURS` |
| `calculation_method` | **ممنوع** `CUSTOM_FORMULA` (CHECK + خدمة) |

**Uniqueness — هوية المصدر (بدون sequence):**

```text
UNIQUE (
  payroll_run_person_id,
  payroll_component_id,
  COALESCE(payroll_assignment_id, sentinel),
  COALESCE(payroll_component_assignment_id, sentinel)
)
```

- عدة أسطر لنفس المكوّن من تكليفات/إسنادات مختلفة **مسموحة**.
- `sequence` للعرض/الترتيب فقط — **لا** يدخل المفتاح حتى لا يخفي التكرار.

### 3.3 `accounts.payroll_run_issues`

| Severity | `is_blocking` |
|----------|----------------|
| `ERROR` | يجب `TRUE` |
| `WARNING` | يجب `FALSE` |

`issue_code`: uppercase مُطبَّع `^[A-Z][A-Z0-9_]{1,59}$`.
لا تخزين Stack/SQL/Request Body. لا Audit لكل Issue في هذه المرحلة.

---

## 4. FK / Delete policies

| العلاقة | السياسة |
|---------|---------|
| People/Lines/Issues → **Run** | `ON DELETE CASCADE` |
| People → Person / Contract | `ON DELETE RESTRICT` |
| Lines → Component / Assignment / PCA | `ON DELETE RESTRICT` |
| Lines/Issues → Run Person | FK مركّب `(person_id, run_id)` → `payroll_run_people(id, payroll_run_id)` لضمان تطابق `run_id` |

**تبرير CASCADE من Run:** لا يوجد Delete API عام للتشغيل في 9.A.2.1؛ استبدال نتائج الاحتساب يتم داخل Transaction عند Recalculate (9.A.2.3). الحذف التشغيلي للـ Run غير معرّض كمسار منتج.

---

## 5. Snapshot JSON schema

النوع: `PayrollPersonSnapshotJson` في `payroll-snapshot-types.ts`.

يشمل على الأقل:
- هوية الشخص + لقطة العقد (أو `null`)
- لقطات التكليفات + مراجع إسناد المكوّنات
- العملة + `calculation_date` (`YYYY-MM-DD`)
- `source_versions` (version + `updated_at` للمصادر ذات المعنى المالي)
- بيانات نطاق مبسّطة (`scope`)

قواعد التمثيل:
- Decimals كسلاسل ثابتة بثلاث منازل
- Arrays بترتيب حتمي يحدده المُنشئ
- لا بيانات مصرفية / ملاحظات شخصية زائدة
- لا يُولَّد تلقائيًا في 9.A.2.2 — Fixtures/Tests فقط

---

## 6. Hashing

الملف: `src/lib/accounts/payroll-snapshot-hash.ts`

- `canonicalizePayrollSnapshot()` — ترتيب مفاتيح Objects؛ Arrays كما هي؛ استبعاد `created_at`/`updated_at`/`created_by`/`updated_by`/`version` التشغيلية
- `hashPayrollSnapshot()` — SHA-256 hex بطول 64
- لا ربط بمحرك Calculate ولا تحديث حالة Run

---

## 7. Internal services

الملف: `src/lib/accounts/payroll-run-snapshots.ts`

| دالة | دور |
|------|-----|
| `insertRunPersonSnapshot` | إدراج لقطة شخص |
| `insertRunLine` | إدراج سطر |
| `insertRunIssue` | إدراج مشكلة |
| `clearRunCalculationArtifacts` | حذف آثار اللقطة لـ Run |
| `loadRunCalculationArtifacts` | قراءة للتحقق/الاختبار |

قواعد:
- Transaction مطلوبة + قفل Run
- ترفض `CANCELLED`
- **لا** تغيّر `payroll_runs.status`
- **لا** تحسب مبالغ ولا تحل Scope ولا تختار Contract/Component
- **لا** Public CRUD APIs لـ people/lines/issues

ترتيب الأقفال المستخدم: **Run** (ثم تحققات قراءة لـ Person/Contract عند الحاجة دون توسيع ترتيب جديد).

---

## 8. Verify

```bash
npm run accounts:verify-payroll-snapshot-schema
npm run accounts:verify-payroll-snapshot-schema:strict
```

**Normal:** mismatches فقط تفشل.
**Strict:** يرقّي warnings + unexplained أيضًا.

أمثلة الكشف:
- تكرار شخص / حارس فترة حيّ
- عملة/فترة تخالف Run
- hash غير صالح / مفاتيح حسّاسة في JSON
- `CUSTOM_FORMULA` / مصدر كمية محجوز
- ERROR غير blocking / WARNING blocking
- تشغيل `CALCULATED` بلا people
- تحذير: آثار لقطة تحت `DRAFT` (ليست ناتج محرك)

---

## 9. Tests

```bash
npm run test:payroll-snapshot-schema
```

- Ownership token + cleanup في `finally`
- تشغيل مرتين بلا تراكم
- انحدار verify لـ 9.A.2.1 و 9.A.1 داخل الـ Suite

**لا Seed DEMO دائم** لهذه المرحلة — لتجنب تلويث DRAFT/strict. Fixtures داخل الاختبارات فقط.

---

## 10. Deferred — Calculation Engine (9.A.2.3+)

- Pipeline الكامل (Validate → Scope → Freeze → Lines → Aggregate → CALCULATED)
- Recalculate Transaction + Immutable بعد CALCULATED
- Enforcement كامل للحدود غير القابلة للتغيير
- تحديث `payroll_runs.snapshot_hash` / totals من المحرك
- Public read APIs / UI لعرض الأسطر

---

## 11. الملفات

| ملف | دور |
|-----|-----|
| `db/migrations/096_payroll_run_calculation.sql` | المخطط |
| `src/lib/accounts/payroll-snapshot-types.ts` | أنواع/Enums |
| `src/lib/accounts/payroll-snapshot-hash.ts` | Canonicalize + Hash |
| `src/lib/accounts/payroll-run-snapshots.ts` | Persist داخلي |
| `src/lib/accounts/verify-payroll-snapshot-schema.ts` | Verify |
| `src/scripts/verify-payroll-snapshot-schema.ts` | CLI |
| `src/scripts/test-payroll-snapshot-schema.ts` | Tests |
| `docs/payroll-9a22-snapshot-schema.md` | هذا المستند |

---

## 12. Known limitations

- لا محرك احتساب؛ صفوف DRAFT ذات لقطة = Fixtures/اختبار فقط.
- `quantity_source` المحجوز: Service يرفضه؛ DB CHECK يسمح للمستقبل؛ Verify يكشف Raw SQL.
- Mutation على Run `CALCULATED`/`CANCELLED` مرفوضة في خدمات اللقطة (Recalculate في 9.A.2.3).
- لا UI ولا mutation endpoints عامة للقطة.
- حقول `college_id_snapshot` مضافة لدعم النطاق الجامعي دون ربط محرك.

---

## 13. قرارات مجمّدة من الوثيقة (لا تُغيَّر هنا)

- حالات الشخص: `PENDING|CALCULATED|ERROR|EXCLUDED`
- `payroll_contract_id` قابل لـ NULL
- حارس الشخص عبر الفترة (`superseded`)
- منع `CUSTOM_FORMULA` في الأسطر
- ERROR ⇒ blocking؛ WARNING ⇒ non-blocking

## 14. Hardening 9A22

- **H1**: `CALCULATED` requires contract.
- **H2**: Hash recompute on relevant changes.
- **H4**: Cancel sets `superseded`.
- **H5**: Reserved qty rejected in service.
- **H7**: No mutate `CALCULATED` / `CANCELLED`.
- **H6**: Sensitive keys rejected.
- No change to migration `096`.
