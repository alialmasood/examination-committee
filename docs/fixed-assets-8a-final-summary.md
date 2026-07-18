# المرحلة 8.A — الأصول الثابتة: الملخص الهندسي النهائي

> **Baseline المعتمد:** `575cc09` — `fix(accounts): prevent supplier invoice void after asset capitalization 8A`
> **الحالة:** مغلقة ومعتمدة اعتمادًا نهائيًا (Stable Baseline).

نظام الحسابات — Next.js + PostgreSQL (schema `accounts`). العملة IQD، وكل المبالغ بالميلي
(millis، دقة 3 منازل) عبر money helpers دون float. هذه الوثيقة ملخّص التنفيذ الفعلي النهائي؛
للتفاصيل الموسّعة راجع `docs/fixed-assets-8a-execution-plan.md`.

## 1) الهدف

سجل أصول ثابتة متكامل داخل نظام الحسابات يغطّي دورة حياة الأصل من الاقتناء حتى الاستبعاد،
مع قيود محاسبية متوازنة ومرحّلة، ومسار تدقيق، وصلاحيات أقل امتياز، وتكامل مع المشتريات
لرسملة الأصول من فواتير الموردين، وأدوات تحقق وبذر واختبار قابلة للتشغيل.

## 2) البنية

- **قاعدة البيانات (Migrations):**
  - `092_fixed_assets_foundation.sql` — `asset_categories`, `asset_locations`, `fixed_assets`,
    `asset_capitalization_sources` + توسعة جداول المشتريات (`is_fixed_asset`, `asset_category_id`,
    `capitalized_quantity`) وقيود `UNIQUE` لمنع الرسملة المزدوجة.
  - `093_fixed_assets_movements_depreciation_disposals.sql` — `asset_movements`,
    `asset_custody_history`, `depreciation_runs`, `depreciation_run_lines`, `asset_disposals`
    + أنواع تسلسل المستندات (`FIXED_ASSET`, `ASSET_MOVEMENT`, `DEPRECIATION_RUN`, `ASSET_DISPOSAL`).
- **الخدمات (`src/lib/accounts/`):** `fixed-assets.ts`, `asset-categories.ts`, `asset-locations.ts`,
  `asset-movements.ts`, `asset-depreciation.ts`, `asset-disposals.ts`, `fixed-assets-from-purchasing.ts`,
  `fixed-assets-gl.ts`, `fixed-assets-access.ts`, `fixed-assets-faults.ts`, `verify-fixed-assets.ts`.
- **واجهات البرمجة (`app/api/accounts/fixed-assets/*`):** مسارات التصنيفات، المواقع، الأصول
  (CRUD + تفعيل/إيقاف/إعادة تفعيل/إلغاء)، الرسملة من المشتريات (candidates/create)، الحركات
  (post/void)، سجل العهدة، دورات الإهلاك (calculate/post/void)، الاستبعادات (post/void)، والخيارات.
- **الواجهة (`app/accounts/fixed-assets/*`):** لوحة/قوائم، صفحات تفصيل، نماذج، وصفحات طباعة (RTL/عربية).
- **الأدوات (`src/scripts/`):** `verify-fixed-assets.ts`, `test-fixed-assets.ts`, `seed-accounts-fixed-assets-demo.ts`.

## 3) دورة حياة الأصل

الحالات: `DRAFT | ACTIVE | SUSPENDED | FULLY_DEPRECIATED | DISPOSED | CANCELLED`.

- `DRAFT → ACTIVE`: `activateFixedAsset` (يطبّق حد الرسملة، ويُنشئ قيد الاقتناء لغير المشتريات).
- `DRAFT → CANCELLED`: `cancelFixedAsset` (ممنوع إن كان للأصل قيد اقتناء مرحّل).
- `ACTIVE ↔ SUSPENDED`: `suspendFixedAsset` / `reactivateFixedAsset`.
- `ACTIVE → FULLY_DEPRECIATED`: تلقائيًا عند بلوغ مجمع الإهلاك المبلغ القابل للإهلاك (الفترة الأخيرة).
- `ACTIVE/SUSPENDED/FULLY_DEPRECIATED → DISPOSED`: `postAssetDisposal`.
- التعديل (`updateFixedAssetDraft`) مسموح في `DRAFT` فقط. SOLD/LOST تنهار إلى `DISPOSED` مع `disposal_type`.

## 4) القيود المحاسبية

- كل القيود تمرّ عبر `postFixedAssetJournalEntry` (وضع strict): متوازنة إلزاميًا قبل الترحيل، وتُرحَّل
  مباشرة (`POSTED`) مع `source_type` مميّز: `FIXED_ASSET_ACQUISITION` / `DEPRECIATION_RUN` / `ASSET_DISPOSAL`.
- الإلغاء يتم بقيد عكسي (`is_reversal=TRUE`) لا بحذف القيد الأصلي.
- مجمع الإهلاك: حساب من نوع ASSET برصيد طبيعي **دائن** (تمثيل contra-asset).

## 5) سياسة الرسملة

- إنشاء `DRAFT` مسموح تحت الحد؛ التفعيل يتطلب بلوغ التكلفة `capitalization_threshold` للتصنيف.
- التجاوز يتطلب مجتمعًا: `override_capitalization_threshold=true` + سبب + صلاحية `fixed_assets.threshold_override`.
- أخطاء التحقق: أقل من الحد بلا تجاوز → 409؛ تجاوز بلا صلاحية → 403؛ تجاوز بلا سبب → 400.
- معادلات التكلفة: `capitalized = acquisition + additional`، `depreciable = capitalized − salvage ≥ 0`.

## 6) سياسة الإهلاك

- القسط الثابت (STRAIGHT_LINE) فقط: القسط الشهري = `depreciable_amount ÷ useful_life_months`.
- سياسة الشهر: يُحتسب شهر كامل إذا `available_for_use_date ≤ بداية الفترة`، وإلا يُؤجَّل لأول فترة كاملة
  (لا إهلاك جزئي لأول شهر).
- الفترة الأخيرة: إن كان القسط ≥ المتبقي يؤخذ المتبقي كاملًا (`isFinal`) لبلوغ المبلغ القابل للإهلاك بالضبط.
- الأهلية: `ACTIVE` + قسط ثابت + عمر موجب + غير مستهلك بالكامل + لا دورة (DRAFT/POSTED) لنفس الفترة.
- القيد: Dr مصروف الإهلاك / Cr مجمع الإهلاك، مُجمَّعًا حسب (حساب المصروف + مركز الكلفة). الإبطال يعيد
  المجمع بقيد عكسي.

## 7) سياسة الاستبعاد

- NBV = `capitalized_cost − accumulated_depreciation`؛ الربح/الخسارة = `proceeds − NBV`.
- القيد: Cr حساب الأصل، Dr مجمع الإهلاك، Dr النقدية/البنك (البيع فقط)، وDr خسارة **أو** Cr ربح حصرًا.
- قواعد: لا يجتمع ربح وخسارة؛ عند الصفر لا يُستخدم أيّهما؛ البيع بمتحصلات موجبة يتطلب حساب متحصلات
  (`proceeds_gl_account_id`). الإبطال يعيد الأصل بقيد عكسي.

## 8) تكامل المشتريات

- سطر فاتورة المورد يُعلَّم أصلًا عبر `is_fixed_asset=TRUE` + `asset_category_id`.
- عند ترحيل الفاتورة يُدَّان حساب الأصل مباشرة (Dr Asset / Cr ذمم دائنة) — الأصل رُسمِل فعلًا في GL.
- `createAssetsFromPurchasing` ينشئ سجلات `DRAFT` بنوع `PURCHASE`، **بلا قيد اقتناء ثانٍ** عند التفعيل
  (تفادي الازدواج). حارس الرسملة المزدوجة عبر قفل مصدر الرسملة + `FOR UPDATE` + `UNIQUE`.
- **منع إلغاء الفاتورة بعد الرسملة (`voidSupplierInvoice`):** يُمنع الإلغاء ما لم تكن كل الأصول المرتبطة
  `CANCELLED` وبلا أي نشاط (حركة/عهدة/إهلاك/استبعاد). أصل `DRAFT` يجب إلغاؤه أولًا؛ أي أصل
  `ACTIVE/SUSPENDED/FULLY_DEPRECIATED/DISPOSED` يمنع الإلغاء نهائيًا (409). الفحص داخل المعاملة بعد
  الأقفال (`supplierInvoiceLock` + `assetCapitalizationSourceLock` + `fixedAssetLock`).

## 9) أهم القرارات المعمارية

- **مبالغ بالميلي دون float** عبر money helpers في كل الحسابات وتقسيم التكلفة.
- **مجمع الإهلاك كـ ASSET برصيد دائن** بدل نوع CONTRA_ASSET مستقل (تمثيل معتمد في `fixed-assets-gl.ts`).
- **الإلغاء بقيود عكسية** لا بالحذف — للحفاظ على مسار التدقيق.
- **أقفال استشارية مرتّبة ومُزالة التكرار** (`acquireAccountingResourceLocks`) + تحكم تفاؤلي
  (version + updated_at) لمنع الجمود والكتابة المتزامنة.
- **ترتيب أقفال موحّد بين VOID والرسملة** (صف الفاتورة `FOR UPDATE` ثم الأقفال الاستشارية) مع إعادة قراءة
  حالة الفاتورة بعد القفل — لإغلاق سباق TOCTOU وتفادي الجمود.
- **أقل امتياز**: عضوية `ACCOUNTS` وحدها = `VIEW_ONLY`؛ الصلاحيات عبر الأدوار (VIEWER/CLERK/APPROVER/ADMIN).
- **حقن أعطال** (`fixed-assets-faults.ts`) لإثبات التراجع الكامل (ذرّية المعاملات).
- **SOLD/LOST مدمجة في DISPOSED** مع `disposal_type` بدل حالات مستقلة.

## 10) القيود المؤجَّلة

- طرق إهلاك متعددة (متناقص/وحدات إنتاج) — الحالي: قسط ثابت فقط.
- الإهلاك الجزئي لأول شهر (الحالي: شهر كامل عند الجاهزية ≤ بداية الفترة، وإلا يُؤجَّل).
- تكامل سند قبض/دفع مستقل لمتحصلات الاستبعاد (الحالي: توجيه مباشر إلى حساب نقدية/بنك).
- IFRS 16 (الإيجارات) وإعادة التقييم (revaluation) وانخفاض القيمة (impairment).
- FIFO/ربط مخزون تفصيلي للأصول.

## 11) أوامر التحقق والاختبار (Verify / Tests)

```bash
# اختبارات القبول (≥ 70 تأكيدًا؛ الحالي 84)
npm run test:fixed-assets

# التحقق من اتساق البيانات
npm run accounts:verify-fixed-assets          # عادي — يفشل عند أي mismatch
npm run accounts:verify-fixed-assets:strict   # صارم — يفشل أيضًا على التحذيرات وغير المفسَّر

# البذرة التجريبية (idempotent) — موصولة داخل seed:accounts-demo
npx tsx src/scripts/seed-accounts-fixed-assets-demo.ts
```

سكربتات `package.json` ذات الصلة:

- `"test:fixed-assets": "tsx src/scripts/test-fixed-assets.ts"`
- `"accounts:verify-fixed-assets": "tsx src/scripts/verify-fixed-assets.ts"`
- `"accounts:verify-fixed-assets:strict": "tsx src/scripts/verify-fixed-assets.ts --strict"`

### فحوص الانحدار ذات الصلة (Regression)

```bash
npm run test:supplier-payables
npm run test:supplier-payments-expenses
npm run test:purchasing
npm run accounts:verify-supplier-payables            # + -- --strict
npm run accounts:verify-purchasing                   # + :strict
```
