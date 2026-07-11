# Release Notes — accounting-engine-v1  
## مذكرة إصدار Baseline محرك الحسابات

### كلية الشرق التقنية التخصصية — منصة systimit / نظام الحسابات

| الحقل | القيمة |
|--------|--------|
| **اسم الإصدار** | Accounting Engine v1 |
| **الوسم (Tag)** | `accounting-engine-v1` |
| **رسالة الـ Commit** | `baseline: accounting engine v1` |
| **رقم الـ Commit** | *(يُملأ بعد إنشاء الـ commit — انظر نهاية الملف أو `git rev-parse accounting-engine-v1`)* |
| **تاريخ الإصدار** | 12 تموز 2026 |
| **الحالة** | Baseline مستقر — جاهز لبدء المرحلة 3 (الصناديق) |
| **النطاق** | المراحل 0–2 من نظام الحسابات + الوثائق الرسمية للبوابة إلى المرحلة 3 |

---

## 1. ما تم إنجازه

### المرحلة 0 — النواة المالية
- سنوات مالية، فترات، مراكز كلفة، تسلسل مستندات، `financial_audit_log`
- إعدادات `/accounts/settings`
- Helpers: auth، with-transaction، audit، fiscal، cost-centers، document-sequences

### المرحلة 1 — دليل الحسابات
- أنواع الحسابات + شجرة الدليل
- `source` (SYSTEM/USER) و`sort_order`
- Seed آمن لشجرة الكلية (`seed:accounts-chart`)
- واجهة `/accounts/chart-of-accounts`

### المرحلة 2 — محرك القيود المزدوجة
- `journal_entries` + `journal_entry_lines` مع `version`
- دورة الحياة: DRAFT → … → POSTED / العكس REVERSAL
- ترقيم `JV-{سنة}-{######}`
- واجهة `/accounts/entries` ودفتر اليومية `/accounts/reports/journal`
- عدم كسر مبدأ: لا تعديل قيد مرحّل؛ العكس قيد جديد

### بوابة المرحلة 3 (تصميم فقط — بلا تنفيذ)
- مواصفة الصناديق v1.1 بعد Design Review
- معايير قبول المرحلة 3
- اعتماد حزمة الوثائق الرسمية

---

## 2. الـ Migrations المنفذة (محرك الحسابات)

| Migration | الوصف |
|-----------|--------|
| **058** | Accounting Core — سنوات، فترات، مراكز كلفة، تسلسل، تدقيق |
| **059** | Chart Of Accounts — أنواع + دليل الحسابات |
| **060** | Chart Enhancements — `source` + `sort_order` |
| **061** | Journal Engine — رؤوس وسطور القيود، الدورة، العكس، `version` |

> Migrations أنظمة أخرى (HR / Correction / …) **خارج** نطاق وسم هذا الـ Baseline إن وُجدت في الشجرة غير مُرحَّلة ضمن هذا الإصدار.

---

## 3. الوحدات المكتملة

| الوحدة | المسار / المكوّن | الحالة |
|--------|------------------|--------|
| الإعدادات المالية | `/accounts/settings` | مكتملة |
| دليل الحسابات | `/accounts/chart-of-accounts` | مكتملة |
| القيود المحاسبية | `/accounts/entries` + APIs journal-entries | مكتملة |
| دفتر اليومية | `/accounts/reports/journal` | مكتملة (أساسي) |
| الصناديق | تصميم + قبول فقط | **لم يبدأ التنفيذ** |
| البنوك / السندات / الجهات / الافتتاحي | Roadmap | لاحقاً |

---

## 4. الوثائق الرسمية المعتمدة

| الوثيقة | المسار |
|---------|--------|
| ERP Architecture 2.0 | `docs/accounts-erp-architecture.md` |
| Cash Management Design Specification v1.1 | `docs/cash-management-design-specification.md` |
| Cash Management Design Review 1.0 | `docs/cash-management-design-review.md` |
| Cash Management Acceptance Criteria 1.0 | `docs/cash-management-acceptance-criteria.md` |
| هذه المذكرة | `docs/releases/accounting-engine-v1.md` |

---

## 5. المتطلبات المتبقية (بعد هذا الـ Baseline)

| البند | الملاحظة |
|-------|----------|
| المرحلة 3 — الصناديق | التنفيذ وفق المواصفة v1.1 ومعايير القبول؛ ابدأ بـ **3.A** |
| تهيئة حسابات فروقات الجرد | مطلوبة قبل 3.C في بيئة الكلية |
| المراحل 4+ | بنوك، جهات، افتتاحي، سندات… حسب Roadmap المعمارية |
| Shared Services | إشعارات، مرفقات، Approval، Timeline — حسب الحاجة لاحقاً |
| أعمال غير محاسبية في الشجرة | Correction / HR / Teachers Portal وغيرها تبقى خارج هذا الوسم حتى تُفرَز في إصداراتها |

---

## 6. تحقق الجودة عند الإصدار

| الفحص | النتيجة عند الـ Baseline |
|--------|---------------------------|
| `npx tsc --noEmit` | ناجح |
| `npm run build` | ناجح |
| ESLint لمسارات محرك الحسابات (`app/accounts`, `app/api/accounts`, `src/lib/accounts`) | نظيف (0 errors) |
| ESLint على كامل المستودع | ديون سابقة / WIP خارج نطاق هذا الوسم — غير مُدرجة في الـ commit |
| ملفات مؤقتة ضمن نطاق الحسابات | لا يوجد |
| تنفيذ مرحلة 3 | **لا** — تصميم فقط |

---

## 7. Git

| البند | القيمة |
|-------|--------|
| **Tag** | `accounting-engine-v1` |
| **Commit message** | `baseline: accounting engine v1` |
| **Commit SHA** | `COMMIT_SHA_PLACEHOLDER` |
| **Push** | **لم يُنفَّذ** (محلي فقط حسب الطلب) |

للتحقق محلياً:

```bash
git rev-parse accounting-engine-v1
git show accounting-engine-v1 --stat
```

---

## 8. الخطوة التالية

المشروع على **Baseline مستقرة** لمحرك الحسابات.  
الخطوة التالية المسموحة: أمر تنفيذ صريح للدفعة **3.A** من المرحلة 3 (الصناديق) وفق الوثائق المعتمدة أعلاه.

— نهاية مذكرة الإصدار accounting-engine-v1 —
