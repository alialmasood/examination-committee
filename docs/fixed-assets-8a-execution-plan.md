# خطة تنفيذ المرحلة 8.A — الأصول الثابتة (Fixed Assets)

نظام الحسابات في الكلية — Next.js + PostgreSQL (schema `accounts`). العملة IQD، وكل الحسابات
بالميلي (millis، دقة 3 منازل) دون float. هذه الوثيقة تصف نطاق المرحلة وحدودها المحاسبية
والسياسات المطبَّقة فعلاً في الخدمات القائمة، وأدوات التحقق والبذر والاختبار.

## 1) النطاق (Scope)

- تصنيفات الأصول (`asset_categories`) وربطها بحسابات GL.
- مواقع الأصول (`asset_locations`) بهرمية (مبنى → طابق → غرفة/مختبر/مكتب/مستودع) مع منع الدورات.
- الأصول الثابتة (`fixed_assets`): دورة حياة كاملة (مسودّة → تفعيل → إيقاف/إعادة تفعيل → إهلاك كامل → استبعاد/إلغاء).
- الرسملة من المشتريات (`asset_capitalization_sources`): إنشاء أصول من سطور فواتير الموردين.
- الحركات والعهدة (`asset_movements`, `asset_custody_history`).
- الإهلاك الدوري (`depreciation_runs`, `depreciation_run_lines`) — القسط الثابت.
- الاستبعاد (`asset_disposals`): بيع/إتلاف/تلف/فقد/تبرع خارج.

## 2) الحدود المحاسبية (Accounting boundaries)

- كل قيود الأصول الثابتة تمرّ عبر `postFixedAssetJournalEntry` (وضع `strict`): السطور متوازنة إلزامياً
  (مجموع المدين = مجموع الدائن) قبل الترحيل.
- القيود تُرحَّل مباشرة (`POSTED`) مع `source_type` يميّز المصدر:
  `FIXED_ASSET_ACQUISITION` (اقتناء/افتتاحي)، `DEPRECIATION_RUN` (إهلاك)، `ASSET_DISPOSAL` (استبعاد).
- الإلغاء يتم بقيد عكسي (`createReversalEntry`, `is_reversal=TRUE`) لا بحذف القيد الأصلي.
- التزامن: كل عملية تأخذ أقفالاً استشارية على مستوى المعاملة (`pg_advisory_xact_lock`) مرتّبة
  ومُزالة التكرار عبر `acquireAccountingResourceLocks`، بالإضافة إلى التحكم التفاؤلي (version + updated_at).

## 3) إعداد حسابات GL للتصنيف (Category GL setup)

لكل تصنيف الحسابات التالية (تُتحقَّق أنواعها عند الإنشاء/التعديل):

| الحساب | النوع المطلوب | ملاحظة |
|---|---|---|
| `asset_gl_account_id` | ASSET | تفصيلي، قابل للترحيل، فعّال |
| `accumulated_depreciation_gl_account_id` | ASSET **برصيد طبيعي دائن (CREDIT)** | لا يوجد نوع CONTRA_ASSET؛ يُعرض كحساب مقابل للأصل (contra-asset presentation) |
| `depreciation_expense_gl_account_id` | EXPENSE | مصروف الإهلاك |
| `gain_gl_account_id` | REVENUE | اختياري — أرباح بيع الأصول |
| `loss_gl_account_id` | EXPENSE | اختياري — خسائر الاستبعاد |

> مجمع الإهلاك مخزَّن كحساب من نوع ASSET برصيد طبيعي **دائن**، وهذا هو التمثيل المعتمد للـ contra-asset
> في هذا النظام (راجع `fixed-assets-gl.ts`).

## 4) دورة حياة الأصل وآلة الحالات (Asset lifecycle & status machine)

الحالات: `DRAFT | ACTIVE | SUSPENDED | FULLY_DEPRECIATED | DISPOSED | CANCELLED`.

- `DRAFT → ACTIVE`: `activateFixedAsset` (يطبّق حد الرسملة، ويُنشئ قيد الاقتناء لغير المشتريات).
- `DRAFT → CANCELLED`: `cancelFixedAsset` (ممنوع إن كان للأصل قيد اقتناء مرحّل).
- `ACTIVE → SUSPENDED → ACTIVE`: `suspendFixedAsset` / `reactivateFixedAsset`.
- `ACTIVE → FULLY_DEPRECIATED`: تلقائياً عند بلوغ مجمع الإهلاك المبلغ القابل للإهلاك (الفترة الأخيرة).
- `ACTIVE/SUSPENDED/FULLY_DEPRECIATED → DISPOSED`: `postAssetDisposal`.
- التعديل (`updateFixedAssetDraft`) مسموح في `DRAFT` فقط.

> ملاحظة: SOLD/LOST لا تُمثَّل كحالات مستقلة؛ تنهار إلى `DISPOSED` مع `disposal_type`
> (SALE/SCRAP/DAMAGE/LOSS/DONATION_OUT).

## 5) تكامل المشتريات (Purchasing integration)

- سطر فاتورة المورد يُعلَّم أصلاً ثابتاً عبر `is_fixed_asset=TRUE` + `asset_category_id` (FIXED_ASSET_CANDIDATE).
- عند **ترحيل فاتورة المورد** يُدَّان حساب الأصل مباشرة (Dr Asset / Cr ذمم دائنة) — أي أن الأصل رُسمِل فعلاً في GL.
- `createAssetsFromPurchasing` ينشئ سجلات `fixed_assets` بحالة `DRAFT` و`acquisition_type='PURCHASE'`.
- **لا قيد اقتناء ثانٍ عند التفعيل** لأصول الشراء (الشرط `acquisition_type !== 'PURCHASE'` في `activateFixedAsset`)
  — تفادياً للازدواج المحاسبي.
- حارس الرسملة المزدوجة: المتاح للرسملة = الكمية المفوترة − مجموع الكميات المرسملة سابقاً؛ مع قفل استشاري
  على مصدر الرسملة و`FOR UPDATE` على سطر الفاتورة وصفوف المصادر، وقيد `UNIQUE(supplier_invoice_line_id, fixed_asset_id)`.
- تقسيم التكلفة بدون float: `perUnit = floor(line_total / totalUnits)` والباقي يُضاف لآخر وحدة، فيساوي مجموع
  تكاليف الأصول قيمة السطر تماماً.

## 6) سياسة حد الرسملة والتجاوز (Capitalization threshold + override)

- يُسمح بإنشاء `DRAFT` تحت الحد. التفعيل (`ACTIVE`) يتطلب أن تبلغ التكلفة المرسملة `capitalization_threshold` للتصنيف.
- التجاوز يتطلب مجتمعاً: `override_capitalization_threshold=true` + سبب (`override_threshold_reason`)
  + صلاحية `fixed_assets.threshold_override` (`hasOverrideCapability`).
- أخطاء التحقق: أقل من الحد بلا تجاوز → 409؛ تجاوز بلا صلاحية → 403؛ تجاوز بلا سبب → 400.

## 7) الحركة والعهدة (Movement & custody)

- الحركات (`LOCATION | CUSTODY | DEPARTMENT | MIXED`) لا أثر محاسبي (GL).
- الحركة تُنشأ لأصل `ACTIVE`/`SUSPENDED` فقط، ويجب تحديد وجهة واحدة على الأقل.
- الترحيل (`POST`) يحدّث الموقع/القسم/العهدة الحالية للأصل، ويسجّل `from_*` ويكتب سجل العهدة.
- الإلغاء (`VOID`) يعيد القيم السابقة (`from_*`) ويفتح سجل عهدة يعيد الوضع.

## 8) سياسة الإهلاك (Depreciation policy)

- الطريقة: القسط الثابت (STRAIGHT_LINE) فقط. القسط الشهري = `depreciable_amount ÷ useful_life_months`.
- **سياسة الشهر الجزئي (المطبَّقة في `computeMonthlyDepreciationMillis` + شرط الأهلية):**
  الأصل مؤهَّل للإهلاك في الفترة إذا كان `available_for_use_date ≤ بداية الفترة` (أي يُحتسب شهر كامل عندها،
  ولا يُحتسب إهلاك جزئي للشهر الأول؛ الأصول الجاهزة بعد بداية الفترة تُؤجَّل لأول فترة كاملة تليها).
- **معالجة التقريب والفترة الأخيرة:** `remaining = depreciable − accumulated`؛ فإن كان القسط الشهري ≥ المتبقي
  يؤخذ المتبقي كاملاً (`isFinal=true`) لضمان بلوغ مجمع الإهلاك المبلغ القابل للإهلاك بالضبط دون كسور تائهة.
- الأهلية: `status='ACTIVE'`، طريقة قسط ثابت، `useful_life_months` موجب، لم يُستهلك بالكامل، ولا دورة (DRAFT/POSTED)
  لنفس الفترة (منع التكرار).
- القيد المُرحَّل: Dr مصروف الإهلاك / Cr مجمع الإهلاك، مُجمَّعاً حسب (حساب المصروف + مركز الكلفة)، مع الحفاظ على
  مركز كلفة الأصل في سطور القيد.
- عند بلوغ الاستهلاك الكامل تتحول الحالة إلى `FULLY_DEPRECIATED`. الإلغاء (`VOID`) يعيد مجمع الإهلاك ويصدر قيداً عكسياً.

## 9) محاسبة الاستبعاد (Disposal accounting)

القيمة الدفترية (NBV) = `capitalized_cost − accumulated_depreciation`؛ الربح/الخسارة = `proceeds − NBV`.

قيد الاستبعاد:
- Cr حساب الأصل (التكلفة المرسملة)
- Dr مجمع الإهلاك (المتراكم)
- Dr النقدية/البنك (المتحصلات — للبيع فقط، عبر `proceeds_gl_account_id`)
- Dr خسارة الاستبعاد (إن كانت NBV > المتحصلات) — حصراً
- Cr ربح بيع الأصول (إن كانت المتحصلات > NBV) — حصراً

قواعد: لا يجتمع ربح وخسارة معاً؛ عند صفر الربح/الخسارة لا يُستخدم أيّ منهما. البيع يتطلب حساب متحصلات
(نقدية/بنك) عند وجود متحصلات موجبة. الإلغاء (`VOID`) يعيد الأصل ويصدر قيداً عكسياً.

> ملاحظة: متحصلات البيع تُوجَّه إلى حساب GL (نقدية/بنك) مباشرة عبر `proceeds_gl_account_id`؛
> تكامل سند القبض/الدفع المستقل مؤجَّل (انظر §14).

## 10) الأقفال وترتيبها (Locks & ordering)

- نطاقات الأقفال: `FIXED_ASSET`, `ASSET_CATEGORY`, `ASSET_LOCATION`, `ASSET_MOVEMENT`,
  `DEPRECIATION_RUN`, `ASSET_DISPOSAL`, `ASSET_CAPITALIZATION_SOURCE`, `GL_ACCOUNT`, وأقفال المشتريات ذات الصلة.
- تُطلب عبر `acquireAccountingResourceLocks` التي ترتّب المفاتيح وتزيل التكرار لتفادي الجمود (deadlock).
- تحكم تفاؤلي إضافي على كل الكيانات (version + updated_at) لمنع الكتابة فوق تعديلات متزامنة.

## 11) الصلاحيات — أقل امتياز (Permissions, Least Privilege)

عضوية `ACCOUNTS` وحدها → `VIEW_ONLY` فقط (لا ترقية ضمنية). الأدوار (`user_system_roles`):

| الدور | صلاحيات أساسية |
|---|---|
| VIEWER | عرض التصنيفات/المواقع/الأصول/الحركات/الإهلاك/الاستبعاد |
| CLERK | + إدارة التصنيفات/المواقع، تحضير الأصول/الرسملة من المشتريات، تحضير الحركات/الإهلاك/الاستبعاد |
| APPROVER | + تفعيل/إيقاف الأصول، ترحيل الحركات/الإهلاك/الاستبعاد |
| ADMIN | + إلغاء الأصول، تجاوز حد الرسملة، إبطال (VOID) الحركات/الإهلاك/الاستبعاد |

`assertFixedAssetsCapability` يرمي 403 عند غياب الصلاحية؛ مستخدم خارج `ACCOUNTS` بلا أي صلاحية (يشمل حماية IDOR).

## 12) واجهات البرمجة (APIs)

مسارات تحت `app/api/accounts/fixed-assets/*` (تصنيفات، مواقع، أصول، تفعيل/إيقاف/إلغاء، رسملة من المشتريات،
حركات، دورات إهلاك، استبعادات) — تُطبِّق فحوص الصلاحية ثم تستدعي خدمات `src/lib/accounts/*`.

## 13) مسارات الواجهة (UI routes)

- `/accounts/fixed-assets` — لوحة/قائمة الأصول.
- `/accounts/fixed-assets/assets/[id]` — تفاصيل الأصل.
- تصنيفات/مواقع/دورات إهلاك/استبعادات ضمن الأقسام الفرعية للأصول الثابتة.

## 14) التحقق والبذر والاختبار (Verify / Seed / Test)

- **التحقق العادي:** `npm run accounts:verify-fixed-assets` (يفشل عند أي mismatch).
- **التحقق الصارم:** `npm run accounts:verify-fixed-assets:strict` (يفشل أيضاً على التحذيرات وغير المفسَّر).
  المنطق في `src/lib/accounts/verify-fixed-assets.ts` والمشغّل في `src/scripts/verify-fixed-assets.ts`.
- **البذر (DEMO):** `src/scripts/seed-accounts-fixed-assets-demo.ts` — `seedFixedAssetsDemo(...)` idempotent
  (محروس بالرمز والعلامة)، يُوصَل من `seed:accounts-demo`، ويمكن تشغيله مباشرة عبر `tsx`.
- **الاختبارات:** `npm run test:fixed-assets` — `src/scripts/test-fixed-assets.ts` (≥ 70 تأكيداً).

## 15) معايير القبول (Acceptance criteria)

- كل عمليات دورة الحياة والإهلاك والاستبعاد والرسملة تعمل بقيود متوازنة ومصادر مؤكَّدة.
- التحقق العادي والصارم يمرّان بعد تشغيل الاختبارات والبذر.
- الأعطال المحقونة (`fixed-assets-faults.ts`) تُثبت التراجع الكامل (لا قيود يتيمة، لا تغيّر في المجمّع).
- الصلاحيات تلتزم مبدأ أقل امتياز؛ سجلات التدقيق تُكتب للعمليات الحساسة.

## 16) الميزات المؤجَّلة (Deferred features)

- SOLD/LOST كحالات مستقلة (مُدمجة في DISPOSED + `disposal_type`).
- طرق إهلاك متعددة (متناقص/وحدات إنتاج) — الحالي: قسط ثابت فقط.
- IFRS 16 (عقود الإيجار) وإعادة التقييم (revaluation) وانخفاض القيمة (impairment).
- FIFO/ربط مخزون تفصيلي للأصول.
- تكامل سند قبض/دفع مستقل لمتحصلات الاستبعاد (الحالي: توجيه مباشر إلى حساب نقدية/بنك عبر `proceeds_gl_account_id`).
- الإهلاك الجزئي لأول شهر (الحالي: شهر كامل عند الجاهزية ≤ بداية الفترة، وإلا يُؤجَّل).

## ملاحظة للأب — سكربتات npm المتوقعة

مضافة/متوقعة في `package.json`:

- `"test:fixed-assets": "tsx src/scripts/test-fixed-assets.ts"`
- `"accounts:verify-fixed-assets": "tsx src/scripts/verify-fixed-assets.ts"`
- `"accounts:verify-fixed-assets:strict": "tsx src/scripts/verify-fixed-assets.ts --strict"`
- بذرة العرض تُوصَل داخل `seed:accounts-demo` باستدعاء `seedFixedAssetsDemo(...)`.
